-- Reconcile the explicitly approved 73-item My Restaurant catalog.
-- Existing item IDs and quantities are deliberately never updated.

do $catalog$
declare
  v_owner record;
  v_item record;
  v_item_id uuid;
  v_match_count integer;
  v_existing_aliases text[];
  v_approved_aliases text[];
  v_merged_aliases text[];
begin
  if exists (
    select 1
    from public.mr_items
    group by user_id, regexp_replace(lower(btrim(name)), '[^a-z0-9]+', '', 'g')
    having count(*) > 1
  ) then
    raise exception 'MR catalog contains duplicate normalized item names; reconcile them manually first';
  end if;

  for v_owner in
    select distinct user_id from public.mr_items order by user_id
  loop
    for v_item in
      select *
      from (values
        ('Candy Cane Chair', 'Furnitures'),
        ('Candy Cane Table', 'Furnitures'),
        ('Dominus Infernus Table', 'Furnitures'),
        ('Dominus Infernus Chair', 'Furnitures'),
        ('Inverted Royal Table', 'Furnitures'),
        ('Inverted Royal Chair', 'Furnitures'),
        ('Corrupted Royal Table', 'Furnitures'),
        ('Corrupted Royal Chair', 'Furnitures'),
        ('Royal Table', 'Furnitures'),
        ('Royal Chair', 'Furnitures'),
        ('Santa''s Sleigh', 'Furnitures'),
        ('Big Inverted Tip Jar', 'Appliances'),
        ('Big Tip Jar', 'Appliances'),
        ('Candy Bowl', 'Appliances'),
        ('Candy Machine', 'Appliances'),
        ('Coffee Machine', 'Appliances'),
        ('Dessert Bar', 'Appliances'),
        ('Energy Drink Machine', 'Appliances'),
        ('Golden Tip Jar', 'Appliances'),
        ('Hyper Ice Cream Machine', 'Appliances'),
        ('Hyper Order Stand', 'Appliances'),
        ('Hyper Tip Jar', 'Appliances'),
        ('Infernus Head', 'Appliances'),
        ('Inverted Piggy Bank', 'Appliances'),
        ('Infernus Vase', 'Appliances'),
        ('Luxury Silverware Tray', 'Appliances'),
        ('Popcorn Machine', 'Appliances'),
        ('Soda Machine', 'Appliances'),
        ('Snowglobe Tip Jar', 'Appliances'),
        ('Tip Jar', 'Appliances'),
        ('Volcano Dishwasher', 'Appliances'),
        ('Volcano Stove', 'Appliances'),
        ('Purple Arcade Machine - BIG Paintball Edition', 'Appliances'),
        ('BIG Heart Tile', 'Decorations'),
        ('Lightning Tile', 'Decorations'),
        ('Alter Ego Display Case', 'Decorations'),
        ('Black Hole', 'Decorations'),
        ('Balloon Machine', 'Decorations'),
        ('Christmas Tree', 'Decorations'),
        ('Cardboard Eternal Statue', 'Decorations'),
        ('Infernus Dominus Relic', 'Decorations'),
        ('Diamond Play Button', 'Decorations'),
        ('Eternal Statue', 'Decorations'),
        ('Fourth of July Balloons', 'Decorations'),
        ('Firework Display', 'Decorations'),
        ('Flamingo Float', 'Decorations'),
        ('Gold Play Button', 'Decorations'),
        ('Golden Christmas Tree', 'Decorations'),
        ('Golden Sombrero Cactus', 'Decorations'),
        ('Geode', 'Decorations'),
        ('Golden Fireworks Display', 'Decorations'),
        ('Giant Pineapple', 'Decorations'),
        ('Giant Candy Cane', 'Decorations'),
        ('Gingerbread Well', 'Decorations'),
        ('Haunted Coffin', 'Decorations'),
        ('Haunted Well', 'Decorations'),
        ('Inverted Well', 'Decorations'),
        ('Jetski', 'Decorations'),
        ('Luxury Sign', 'Decorations'),
        ('Level 999 Trophy', 'Decorations'),
        ('Moai Statue', 'Decorations'),
        ('Money Hedge', 'Decorations'),
        ('Melted Popsicle', 'Decorations'),
        ('Market Crash Cactus', 'Decorations'),
        ('Pinata', 'Decorations'),
        ('Party Jetski', 'Decorations'),
        ('Sombrero Cactus', 'Decorations'),
        ('Santa''s Golden Cookies', 'Decorations'),
        ('Terrarium', 'Decorations'),
        ('Whale', 'Decorations'),
        ('Disco Ball', 'Decorations'),
        ('Haunted Statue', 'Decorations'),
        ('Santa''s Cookies', 'Decorations')
      ) as approved(name, category)
    loop
      v_approved_aliases := case
        when v_item.name = 'Santa''s Golden Cookies'
          then array['Santan''s Golden Cookies']::text[]
        else '{}'::text[]
      end;

      select count(*)::integer
      into v_match_count
      from public.mr_items existing
      where existing.user_id = v_owner.user_id
        and (
          regexp_replace(lower(btrim(existing.name)), '[^a-z0-9]+', '', 'g')
            = regexp_replace(lower(btrim(v_item.name)), '[^a-z0-9]+', '', 'g')
          or (
            v_item.name = 'Santa''s Golden Cookies'
            and lower(btrim(existing.name)) = lower('Santan''s Golden Cookies')
          )
        );

      if v_match_count > 1 then
        raise exception 'Multiple MR rows match canonical item % for user %', v_item.name, v_owner.user_id;
      elsif v_match_count = 1 then
        select existing.id, existing.aliases
        into v_item_id, v_existing_aliases
        from public.mr_items existing
        where existing.user_id = v_owner.user_id
          and (
            regexp_replace(lower(btrim(existing.name)), '[^a-z0-9]+', '', 'g')
              = regexp_replace(lower(btrim(v_item.name)), '[^a-z0-9]+', '', 'g')
            or (
              v_item.name = 'Santa''s Golden Cookies'
              and lower(btrim(existing.name)) = lower('Santan''s Golden Cookies')
            )
          )
        limit 1;

        select coalesce(array_agg(alias order by lower(alias), alias), '{}'::text[])
        into v_merged_aliases
        from (
          select distinct btrim(value) as alias
          from unnest(coalesce(v_existing_aliases, '{}'::text[]) || v_approved_aliases) as value
          where nullif(btrim(value), '') is not null
        ) merged;

        update public.mr_items
        set name = v_item.name,
            category = v_item.category,
            unit = 'units',
            aliases = v_merged_aliases,
            is_archived = false,
            updated_at = now()
        where id = v_item_id
          and user_id = v_owner.user_id
          and (
            name is distinct from v_item.name
            or category is distinct from v_item.category
            or unit is distinct from 'units'
            or aliases is distinct from v_merged_aliases
            or is_archived is distinct from false
          );
      else
        insert into public.mr_items (user_id, name, category, unit, aliases, is_archived)
        values (v_owner.user_id, v_item.name, v_item.category, 'units', v_approved_aliases, false);
      end if;
    end loop;
  end loop;
end
$catalog$;

create unique index if not exists mr_items_user_normalized_name_unique
  on public.mr_items (
    user_id,
    (regexp_replace(lower(btrim(name)), '[^a-z0-9]+', '', 'g'))
  );

do $families$
declare
  v_owner record;
  v_family record;
  v_family_id uuid;
  v_match_count integer;
  v_table_item_id uuid;
  v_chair_item_id uuid;
begin
  for v_owner in
    select distinct user_id from public.mr_items order by user_id
  loop
    for v_family in
      select *
      from (values
        ('Candy Cane', 'Candy Cane Table', 'Candy Cane Chair', 'Candy Cane Set', 4),
        ('Dominus Infernus', 'Dominus Infernus Table', 'Dominus Infernus Chair', 'Dominus Infernus Set', 4),
        ('Inverted Royal', 'Inverted Royal Table', 'Inverted Royal Chair', 'Inverted Royal Set', 4),
        ('Corrupted Royal', 'Corrupted Royal Table', 'Corrupted Royal Chair', 'Corrupted Royal Set', 4),
        ('Royal', 'Royal Table', 'Royal Chair', 'Royal Set', 4)
      ) as approved(name, table_name, chair_name, set_alias, chairs_per_set)
    loop
      select id into v_table_item_id
      from public.mr_items
      where user_id = v_owner.user_id and name = v_family.table_name and is_archived = false;
      if not found then
        raise exception 'Missing MR table component % for user %', v_family.table_name, v_owner.user_id;
      end if;

      select id into v_chair_item_id
      from public.mr_items
      where user_id = v_owner.user_id and name = v_family.chair_name and is_archived = false;
      if not found then
        raise exception 'Missing MR chair component % for user %', v_family.chair_name, v_owner.user_id;
      end if;

      select count(*)::integer
      into v_match_count
      from public.mr_set_families existing
      where existing.user_id = v_owner.user_id
        and regexp_replace(lower(btrim(existing.name)), '[^a-z0-9]+', '', 'g')
          = regexp_replace(lower(btrim(v_family.name)), '[^a-z0-9]+', '', 'g');

      if v_match_count > 1 then
        raise exception 'Multiple MR set families match % for user %', v_family.name, v_owner.user_id;
      elsif v_match_count = 1 then
        select id into v_family_id
        from public.mr_set_families existing
        where existing.user_id = v_owner.user_id
          and regexp_replace(lower(btrim(existing.name)), '[^a-z0-9]+', '', 'g')
            = regexp_replace(lower(btrim(v_family.name)), '[^a-z0-9]+', '', 'g')
        limit 1;

        update public.mr_set_families
        set name = v_family.name,
            aliases = array[v_family.set_alias]::text[],
            table_item_id = v_table_item_id,
            chair_item_id = v_chair_item_id,
            chairs_per_set = v_family.chairs_per_set,
            active = true,
            updated_at = now()
        where id = v_family_id
          and user_id = v_owner.user_id;
      else
        insert into public.mr_set_families (
          user_id, name, aliases, table_item_id, chair_item_id, chairs_per_set, active
        ) values (
          v_owner.user_id, v_family.name, array[v_family.set_alias]::text[],
          v_table_item_id, v_chair_item_id, v_family.chairs_per_set, true
        );
      end if;
    end loop;
  end loop;
end
$families$;

create unique index if not exists mr_set_families_user_normalized_name_unique
  on public.mr_set_families (
    user_id,
    (regexp_replace(lower(btrim(name)), '[^a-z0-9]+', '', 'g'))
  );

do $verify$
declare
  v_owner record;
begin
  for v_owner in
    select distinct user_id from public.mr_items order by user_id
  loop
    if (select count(*) from public.mr_items where user_id = v_owner.user_id and is_archived = false) <> 73 then
      raise exception 'MR catalog reconciliation did not produce exactly 73 active items for user %', v_owner.user_id;
    end if;
    if (select count(*) from public.mr_items where user_id = v_owner.user_id and is_archived = false and category = 'Furnitures') <> 11 then
      raise exception 'MR catalog reconciliation did not produce 11 Furnitures for user %', v_owner.user_id;
    end if;
    if (select count(*) from public.mr_items where user_id = v_owner.user_id and is_archived = false and category = 'Appliances') <> 22 then
      raise exception 'MR catalog reconciliation did not produce 22 Appliances for user %', v_owner.user_id;
    end if;
    if (select count(*) from public.mr_items where user_id = v_owner.user_id and is_archived = false and category = 'Decorations') <> 40 then
      raise exception 'MR catalog reconciliation did not produce 40 Decorations for user %', v_owner.user_id;
    end if;
    if (select count(*) from public.mr_set_families where user_id = v_owner.user_id and active = true) <> 5 then
      raise exception 'MR catalog reconciliation did not produce exactly 5 active set families for user %', v_owner.user_id;
    end if;
  end loop;
end
$verify$;
