-- Phase 2 catalog management for the unified RAR + MR website.
-- Catalog metadata is intentionally isolated from inventory balances and history.

create or replace function public.tracker_normalize_catalog_name(p_value text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $function$
  select regexp_replace(lower(btrim(coalesce(p_value, ''))), '[^a-z0-9]+', '', 'g')
$function$;

revoke all on function public.tracker_normalize_catalog_name(text) from public, anon;
grant execute on function public.tracker_normalize_catalog_name(text) to authenticated;

alter table public.rar_items
  add column if not exists category text not null default 'General',
  add column if not exists aliases text[] not null default '{}'::text[];

do $constraints$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'rar_items_category_valid' and conrelid = 'public.rar_items'::regclass
  ) then
    alter table public.rar_items add constraint rar_items_category_valid
      check (char_length(btrim(category)) between 1 and 80);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'rar_items_aliases_limit' and conrelid = 'public.rar_items'::regclass
  ) then
    alter table public.rar_items add constraint rar_items_aliases_limit
      check (cardinality(aliases) <= 50);
  end if;
end
$constraints$;

create unique index if not exists rar_items_user_normalized_name_unique
  on public.rar_items (user_id, public.tracker_normalize_catalog_name(name));

update public.rar_items
set category = 'Appliances',
    gem_value_min = 2700,
    gem_value_max = 3000,
    updated_at = now()
where name = 'Basketball Tip Jar'
  and (
    category is distinct from 'Appliances'
    or gem_value_min is distinct from 2700
    or gem_value_max is distinct from 3000
  );

create or replace function public.rar_upsert_catalog_item(
  p_item_id uuid,
  p_name text,
  p_category text,
  p_aliases text[],
  p_gem_value_min numeric,
  p_gem_value_max numeric,
  p_is_farm_item boolean,
  p_active boolean
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_item_id uuid;
  v_aliases text[];
  v_keys text[];
begin
  if v_uid is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if char_length(btrim(coalesce(p_name, ''))) not between 1 and 120 then
    raise exception 'Item name is required and must be 120 characters or fewer';
  end if;
  if char_length(btrim(coalesce(p_category, ''))) not between 1 and 80 then
    raise exception 'Category is required and must be 80 characters or fewer';
  end if;
  if coalesce(cardinality(p_aliases), 0) > 50
    or exists (select 1 from unnest(coalesce(p_aliases, '{}'::text[])) alias where nullif(btrim(alias), '') is null) then
    raise exception 'Aliases must contain at most 50 non-empty values';
  end if;
  if (p_gem_value_min is not null and (
      p_gem_value_min::text in ('NaN', 'Infinity', '-Infinity') or p_gem_value_min < 0
    )) or (p_gem_value_max is not null and (
      p_gem_value_max::text in ('NaN', 'Infinity', '-Infinity') or p_gem_value_max < 0
    )) or (p_gem_value_min is not null and p_gem_value_max is not null and p_gem_value_min > p_gem_value_max) then
    raise exception 'Gem value range is invalid';
  end if;

  select coalesce(array_agg(value order by lower(value), value), '{}'::text[])
  into v_aliases
  from (
    select distinct btrim(alias) as value
    from unnest(coalesce(p_aliases, '{}'::text[])) alias
  ) cleaned;
  select array_agg(distinct public.tracker_normalize_catalog_name(value))
  into v_keys
  from unnest(array_prepend(btrim(p_name), v_aliases)) value;
  if '' = any(v_keys) then
    raise exception 'Item name and aliases must contain letters or numbers';
  end if;
  if cardinality(v_keys) <> cardinality(v_aliases) + 1 then
    raise exception 'Item name and aliases must be unique' using errcode = '23505';
  end if;
  if exists (
    select 1
    from public.rar_items existing
    where existing.user_id = v_uid
      and (p_item_id is null or existing.id <> p_item_id)
      and (
        public.tracker_normalize_catalog_name(existing.name) = any(v_keys)
        or exists (
          select 1 from unnest(existing.aliases) existing_alias
          where public.tracker_normalize_catalog_name(existing_alias) = any(v_keys)
        )
      )
  ) then
    raise exception 'An RAR item name or alias already exists' using errcode = '23505';
  end if;

  if p_item_id is null then
    insert into public.rar_items (
      user_id, name, kind, stock, gem_value_min, gem_value_max,
      is_farm_item, active, category, aliases
    ) values (
      v_uid, btrim(p_name), 'item', 0, p_gem_value_min,
      coalesce(p_gem_value_max, p_gem_value_min), coalesce(p_is_farm_item, false),
      coalesce(p_active, true), btrim(p_category), v_aliases
    ) returning id into v_item_id;
  else
    update public.rar_items set
      name = btrim(p_name),
      category = btrim(p_category),
      aliases = v_aliases,
      gem_value_min = p_gem_value_min,
      gem_value_max = coalesce(p_gem_value_max, p_gem_value_min),
      is_farm_item = coalesce(p_is_farm_item, false),
      active = coalesce(p_active, true),
      updated_at = now()
    where id = p_item_id and user_id = v_uid and kind = 'item'
    returning id into v_item_id;
    if not found then raise exception 'RAR catalog item was not found'; end if;
  end if;
  return v_item_id;
end
$function$;

revoke all on function public.rar_upsert_catalog_item(
  uuid, text, text, text[], numeric, numeric, boolean, boolean
) from public, anon;
grant execute on function public.rar_upsert_catalog_item(
  uuid, text, text, text[], numeric, numeric, boolean, boolean
) to authenticated;

create or replace function public.mr_save_catalog_item(
  p_item_id uuid,
  p_name text,
  p_category text,
  p_unit text,
  p_aliases text[],
  p_notes text,
  p_image_url text,
  p_low_stock_threshold numeric,
  p_is_archived boolean
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_item_id uuid;
  v_aliases text[];
  v_keys text[];
begin
  if v_uid is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if char_length(btrim(coalesce(p_name, ''))) not between 1 and 120 then
    raise exception 'Item name is required and must be 120 characters or fewer';
  end if;
  if p_category not in ('Furnitures', 'Appliances', 'Decorations') then
    raise exception 'MR category must be Furnitures, Appliances, or Decorations';
  end if;
  if char_length(btrim(coalesce(p_unit, ''))) not between 1 and 24 then
    raise exception 'Unit is required and must be 24 characters or fewer';
  end if;
  if p_low_stock_threshold is null or p_low_stock_threshold::text in ('NaN', 'Infinity', '-Infinity')
    or p_low_stock_threshold < 0 then
    raise exception 'Low-stock threshold must be a non-negative number';
  end if;
  if coalesce(cardinality(p_aliases), 0) > 50
    or exists (select 1 from unnest(coalesce(p_aliases, '{}'::text[])) alias where nullif(btrim(alias), '') is null) then
    raise exception 'Aliases must contain at most 50 non-empty values';
  end if;

  select coalesce(array_agg(value order by lower(value), value), '{}'::text[])
  into v_aliases
  from (
    select distinct btrim(alias) as value
    from unnest(coalesce(p_aliases, '{}'::text[])) alias
  ) cleaned;
  select array_agg(distinct public.tracker_normalize_catalog_name(value))
  into v_keys
  from unnest(array_prepend(btrim(p_name), v_aliases)) value;
  if '' = any(v_keys) then
    raise exception 'Item name and aliases must contain letters or numbers';
  end if;
  if cardinality(v_keys) <> cardinality(v_aliases) + 1 then
    raise exception 'Item name and aliases must be unique' using errcode = '23505';
  end if;
  if exists (
    select 1
    from public.mr_items existing
    where existing.user_id = v_uid
      and (p_item_id is null or existing.id <> p_item_id)
      and (
        public.tracker_normalize_catalog_name(existing.name) = any(v_keys)
        or exists (
          select 1 from unnest(existing.aliases) existing_alias
          where public.tracker_normalize_catalog_name(existing_alias) = any(v_keys)
        )
      )
  ) then
    raise exception 'An MR item name or alias already exists' using errcode = '23505';
  end if;
  if exists (
    select 1
    from public.mr_set_families family
    where family.user_id = v_uid
      and (
        public.tracker_normalize_catalog_name(family.name) = any(v_keys)
        or exists (
          select 1 from unnest(family.aliases) family_alias
          where public.tracker_normalize_catalog_name(family_alias) = any(v_keys)
        )
      )
  ) then
    raise exception 'An MR item or set-family name or alias already exists' using errcode = '23505';
  end if;
  if coalesce(p_is_archived, false) and p_item_id is not null and exists (
    select 1 from public.mr_set_families family
    where family.user_id = v_uid and family.active = true
      and p_item_id in (family.table_item_id, family.chair_item_id)
  ) then
    raise exception 'Deactivate the linked furniture set before archiving this component';
  end if;

  if p_item_id is null then
    insert into public.mr_items (
      user_id, name, category, unit, aliases, notes, image_url,
      low_stock_threshold, current_quantity, is_archived
    ) values (
      v_uid, btrim(p_name), p_category, btrim(p_unit), v_aliases,
      nullif(btrim(coalesce(p_notes, '')), ''), nullif(btrim(coalesce(p_image_url, '')), ''),
      p_low_stock_threshold, 0, coalesce(p_is_archived, false)
    ) returning id into v_item_id;
  else
    update public.mr_items set
      name = btrim(p_name),
      category = p_category,
      unit = btrim(p_unit),
      aliases = v_aliases,
      notes = nullif(btrim(coalesce(p_notes, '')), ''),
      image_url = nullif(btrim(coalesce(p_image_url, '')), ''),
      low_stock_threshold = p_low_stock_threshold,
      is_archived = coalesce(p_is_archived, false),
      updated_at = now()
    where id = p_item_id and user_id = v_uid
    returning id into v_item_id;
    if not found then raise exception 'MR catalog item was not found'; end if;
  end if;
  return v_item_id;
end
$function$;

revoke all on function public.mr_save_catalog_item(
  uuid, text, text, text, text[], text, text, numeric, boolean
) from public, anon;
grant execute on function public.mr_save_catalog_item(
  uuid, text, text, text, text[], text, text, numeric, boolean
) to authenticated;

-- Keep the Phase 1 RPC compatible while routing it through the stricter Phase 2 checks.
create or replace function public.mr_upsert_catalog_item(
  p_name text,
  p_category text default 'General',
  p_unit text default 'units',
  p_aliases text[] default '{}'::text[],
  p_notes text default null,
  p_image_url text default null,
  p_low_stock_threshold numeric default 5,
  p_item_id uuid default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_archived boolean := false;
begin
  if p_item_id is not null then
    select is_archived into v_archived
    from public.mr_items
    where id = p_item_id and user_id = auth.uid();
    if not found then raise exception 'MR catalog item was not found'; end if;
  end if;

  return public.mr_save_catalog_item(
    p_item_id, p_name, p_category, p_unit, p_aliases, p_notes,
    p_image_url, p_low_stock_threshold, v_archived
  );
end
$function$;

revoke all on function public.mr_upsert_catalog_item(
  text, text, text, text[], text, text, numeric, uuid
) from public, anon;
grant execute on function public.mr_upsert_catalog_item(
  text, text, text, text[], text, text, numeric, uuid
) to authenticated;

create or replace function public.mr_upsert_set_family(
  p_family_id uuid,
  p_name text,
  p_aliases text[],
  p_table_item_id uuid,
  p_chair_item_id uuid,
  p_chairs_per_set integer,
  p_active boolean
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_family_id uuid;
  v_aliases text[];
  v_keys text[];
  v_table_name text;
  v_chair_name text;
begin
  if v_uid is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if char_length(btrim(coalesce(p_name, ''))) not between 1 and 120 then
    raise exception 'Set family name is required and must be 120 characters or fewer';
  end if;
  if p_table_item_id is null or p_chair_item_id is null or p_table_item_id = p_chair_item_id then
    raise exception 'A set requires distinct table and chair components';
  end if;
  if p_chairs_per_set <> 4 then raise exception 'MR furniture sets require exactly four chairs'; end if;
  if coalesce(cardinality(p_aliases), 0) > 50
    or exists (select 1 from unnest(coalesce(p_aliases, '{}'::text[])) alias where nullif(btrim(alias), '') is null) then
    raise exception 'Aliases must contain at most 50 non-empty values';
  end if;

  select name into v_table_name from public.mr_items
  where id = p_table_item_id and user_id = v_uid and is_archived = false and category = 'Furnitures';
  if not found then raise exception 'The selected table is not an active Furniture item'; end if;
  select name into v_chair_name from public.mr_items
  where id = p_chair_item_id and user_id = v_uid and is_archived = false and category = 'Furnitures';
  if not found then raise exception 'The selected chair is not an active Furniture item'; end if;
  if public.tracker_normalize_catalog_name(v_table_name)
       <> public.tracker_normalize_catalog_name(btrim(p_name) || ' Table')
    or public.tracker_normalize_catalog_name(v_chair_name)
       <> public.tracker_normalize_catalog_name(btrim(p_name) || ' Chair') then
    raise exception 'Set components must be the matching family Table and Chair';
  end if;

  select coalesce(array_agg(value order by lower(value), value), '{}'::text[])
  into v_aliases
  from (
    select distinct btrim(alias) as value
    from unnest(coalesce(p_aliases, '{}'::text[])) alias
  ) cleaned;
  select array_agg(distinct public.tracker_normalize_catalog_name(value))
  into v_keys
  from unnest(array_prepend(btrim(p_name), v_aliases)) value;
  if '' = any(v_keys) then
    raise exception 'Set family name and aliases must contain letters or numbers';
  end if;
  if cardinality(v_keys) <> cardinality(v_aliases) + 1 then
    raise exception 'Set family name and aliases must be unique' using errcode = '23505';
  end if;
  if exists (
    select 1 from public.mr_items item
    where item.user_id = v_uid and (
      public.tracker_normalize_catalog_name(item.name) = any(v_keys)
      or exists (
        select 1 from unnest(item.aliases) item_alias
        where public.tracker_normalize_catalog_name(item_alias) = any(v_keys)
      )
    )
  ) or exists (
    select 1 from public.mr_set_families family
    where family.user_id = v_uid
      and (p_family_id is null or family.id <> p_family_id)
      and (
        public.tracker_normalize_catalog_name(family.name) = any(v_keys)
        or exists (
          select 1 from unnest(family.aliases) family_alias
          where public.tracker_normalize_catalog_name(family_alias) = any(v_keys)
        )
      )
  ) then
    raise exception 'An MR item or set-family name or alias already exists' using errcode = '23505';
  end if;

  if p_family_id is null then
    insert into public.mr_set_families (
      user_id, name, aliases, table_item_id, chair_item_id, chairs_per_set, active
    ) values (
      v_uid, btrim(p_name), v_aliases, p_table_item_id, p_chair_item_id, 4,
      coalesce(p_active, true)
    ) returning id into v_family_id;
  else
    update public.mr_set_families set
      name = btrim(p_name),
      aliases = v_aliases,
      table_item_id = p_table_item_id,
      chair_item_id = p_chair_item_id,
      chairs_per_set = 4,
      active = coalesce(p_active, true),
      updated_at = now()
    where id = p_family_id and user_id = v_uid
    returning id into v_family_id;
    if not found then raise exception 'MR set family was not found'; end if;
  end if;
  return v_family_id;
end
$function$;

revoke all on function public.mr_upsert_set_family(
  uuid, text, text[], uuid, uuid, integer, boolean
) from public, anon;
grant execute on function public.mr_upsert_set_family(
  uuid, text, text[], uuid, uuid, integer, boolean
) to authenticated;

grant select, insert, update on public.rar_items, public.mr_items, public.mr_set_families to authenticated;
