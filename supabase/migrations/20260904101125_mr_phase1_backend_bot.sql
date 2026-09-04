-- Phase 1 My Restaurant backend and Discord support.
-- This migration is additive. It does not seed or alter MR catalog business rows.

create or replace function public.tracker_normalize_platform(p_name text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $function$
  select case regexp_replace(lower(btrim(coalesce(p_name, ''))), '[^a-z0-9]+', '', 'g')
    when 'eldorado' then 'Eldorado'
    when 'zeusx' then 'ZeusX'
    when 'gameflip' then 'Gameflip'
    when 'playerauctions' then 'PlayerAuctions'
    when 'g2g' then 'G2G'
    when 'itemku' then 'Itemku'
    when 'paypal' then 'PayPal'
    when 'tng' then 'TNG'
    when 'tngewallet' then 'TNG'
    when 'touchngo' then 'TNG'
    when 'touchngoewallet' then 'TNG'
    when 'direct' then 'Direct'
    else null
  end
$function$;

create or replace function public.mr_add_stock_bundle(
  p_items jsonb,
  p_event_at timestamp with time zone default now(),
  p_notes text default null,
  p_request_id uuid default null
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_line record;
  v_balance numeric;
  v_count integer := 0;
  v_locked integer := 0;
begin
  if v_uid is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_request_id is null then raise exception 'A deterministic request ID is required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text || ':mr:add:' || p_request_id::text, 0));
  if exists (select 1 from public.mr_inventory_events where user_id = v_uid and request_id = p_request_id) then
    return -1;
  end if;

  select count(*)::integer into v_count from public.mr_expand_inventory_lines(p_items, false);
  for v_line in
    select i.id from public.mr_items i
    join public.mr_expand_inventory_lines(p_items, false) x on x.item_id = i.id
    where i.user_id = v_uid and i.is_archived = false
    order by i.id for update of i
  loop v_locked := v_locked + 1; end loop;
  if v_count = 0 or v_locked <> v_count then raise exception 'One or more MR items are invalid or archived'; end if;

  for v_line in select * from public.mr_expand_inventory_lines(p_items, false) order by item_id loop
    update public.mr_items
    set current_quantity = current_quantity + v_line.quantity, updated_at = now()
    where id = v_line.item_id and user_id = v_uid
    returning current_quantity into v_balance;
    insert into public.mr_inventory_events (
      user_id, event_at, item_id, event_type, quantity_delta, balance_after, notes, request_id
    ) values (
      v_uid, coalesce(p_event_at, now()), v_line.item_id, 'manual_add', v_line.quantity,
      v_balance, p_notes, p_request_id
    );
  end loop;
  return v_count;
end
$function$;

create or replace function public.mr_record_purchase_bundle(
  p_items jsonb,
  p_cash_amount numeric,
  p_cash_currency text,
  p_event_at timestamp with time zone default now(),
  p_notes text default null,
  p_request_id uuid default null
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_currency text := upper(btrim(p_cash_currency));
  v_line record;
  v_balance numeric;
  v_count integer := 0;
  v_locked integer := 0;
  v_first boolean := true;
begin
  if v_uid is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_request_id is null then raise exception 'A deterministic request ID is required'; end if;
  if p_cash_amount is null or p_cash_amount::text in ('NaN', 'Infinity', '-Infinity') or p_cash_amount < 0 then
    raise exception 'Purchase cost must be a non-negative number';
  end if;
  if v_currency not in ('USD', 'MYR', 'PHP', 'IDR') then raise exception 'Unsupported currency'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text || ':mr:purchase:' || p_request_id::text, 0));
  if exists (select 1 from public.mr_inventory_events where user_id = v_uid and request_id = p_request_id) then
    return -1;
  end if;

  select count(*)::integer into v_count from public.mr_expand_inventory_lines(p_items, false);
  for v_line in
    select i.id from public.mr_items i
    join public.mr_expand_inventory_lines(p_items, false) x on x.item_id = i.id
    where i.user_id = v_uid and i.is_archived = false
    order by i.id for update of i
  loop v_locked := v_locked + 1; end loop;
  if v_count = 0 or v_locked <> v_count then raise exception 'One or more MR items are invalid or archived'; end if;

  for v_line in select * from public.mr_expand_inventory_lines(p_items, false) order by item_id loop
    update public.mr_items
    set current_quantity = current_quantity + v_line.quantity, updated_at = now()
    where id = v_line.item_id and user_id = v_uid
    returning current_quantity into v_balance;
    insert into public.mr_inventory_events (
      user_id, event_at, item_id, event_type, quantity_delta, balance_after,
      cash_amount, cash_currency, notes, request_id
    ) values (
      v_uid, coalesce(p_event_at, now()), v_line.item_id, 'supplier_purchase', v_line.quantity,
      v_balance, case when v_first then p_cash_amount else null end,
      case when v_first then v_currency else null end, p_notes, p_request_id
    );
    v_first := false;
  end loop;
  return v_count;
end
$function$;

create or replace function public.mr_reconcile_stock_batch(
  p_counts jsonb,
  p_event_at timestamp with time zone default now(),
  p_notes text default null,
  p_request_id uuid default null
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_line record;
  v_before numeric;
  v_count integer := 0;
  v_locked integer := 0;
begin
  if v_uid is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_request_id is null then raise exception 'A deterministic request ID is required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text || ':mr:stock:' || p_request_id::text, 0));
  if exists (select 1 from public.mr_inventory_events where user_id = v_uid and request_id = p_request_id) then
    return -1;
  end if;

  select count(*)::integer into v_count from public.mr_expand_inventory_lines(p_counts, true);
  for v_line in
    select i.id from public.mr_items i
    join public.mr_expand_inventory_lines(p_counts, true) x on x.item_id = i.id
    where i.user_id = v_uid and i.is_archived = false
    order by i.id for update of i
  loop v_locked := v_locked + 1; end loop;
  if v_count = 0 or v_locked <> v_count then raise exception 'One or more MR items are invalid or archived'; end if;

  for v_line in select * from public.mr_expand_inventory_lines(p_counts, true) order by item_id loop
    select current_quantity into v_before from public.mr_items
    where id = v_line.item_id and user_id = v_uid;
    update public.mr_items set current_quantity = v_line.quantity, updated_at = now()
    where id = v_line.item_id and user_id = v_uid;
    insert into public.mr_inventory_events (
      user_id, event_at, item_id, event_type, quantity_delta, balance_after, notes, request_id
    ) values (
      v_uid, coalesce(p_event_at, now()), v_line.item_id, 'reconcile',
      v_line.quantity - v_before, v_line.quantity, p_notes, p_request_id
    );
  end loop;
  return v_count;
end
$function$;

create or replace function public.mr_record_trade(
  p_event_at timestamp with time zone,
  p_give_items jsonb,
  p_receive_items jsonb,
  p_notes text default null,
  p_request_id uuid default null
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_line record;
  v_balance numeric;
  v_expected integer;
  v_locked integer := 0;
begin
  if v_uid is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_request_id is null then raise exception 'A deterministic request ID is required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text || ':mr:trade:' || p_request_id::text, 0));
  if exists (select 1 from public.mr_inventory_events where user_id = v_uid and request_id = p_request_id) then
    return -1;
  end if;

  if exists (
    select 1 from public.mr_expand_inventory_lines(p_give_items, false) give_line
    join public.mr_expand_inventory_lines(p_receive_items, false) receive_line using (item_id)
  ) then raise exception 'An MR item cannot appear in both GIVE and RECEIVE'; end if;

  select count(*)::integer into v_expected from (
    select item_id from public.mr_expand_inventory_lines(p_give_items, false)
    union
    select item_id from public.mr_expand_inventory_lines(p_receive_items, false)
  ) lines;
  for v_line in
    select i.id from public.mr_items i
    join (
      select item_id from public.mr_expand_inventory_lines(p_give_items, false)
      union
      select item_id from public.mr_expand_inventory_lines(p_receive_items, false)
    ) lines on lines.item_id = i.id
    where i.user_id = v_uid and i.is_archived = false
    order by i.id for update of i
  loop v_locked := v_locked + 1; end loop;
  if v_expected = 0 or v_locked <> v_expected then raise exception 'One or more MR items are invalid or archived'; end if;

  select i.name into v_line
  from public.mr_items i
  join public.mr_expand_inventory_lines(p_give_items, false) x on x.item_id = i.id
  where i.user_id = v_uid and i.current_quantity < x.quantity
  order by i.name limit 1;
  if found then raise exception 'Insufficient stock for %', v_line.name; end if;

  for v_line in select * from public.mr_expand_inventory_lines(p_give_items, false) order by item_id loop
    update public.mr_items
    set current_quantity = current_quantity - v_line.quantity, updated_at = now()
    where id = v_line.item_id and user_id = v_uid and current_quantity >= v_line.quantity
    returning current_quantity into v_balance;
    if not found then raise exception 'Insufficient stock for an MR trade item'; end if;
    insert into public.mr_inventory_events (
      user_id, event_at, item_id, event_type, quantity_delta, balance_after, notes, request_id
    ) values (
      v_uid, coalesce(p_event_at, now()), v_line.item_id, 'trade', -v_line.quantity,
      v_balance, p_notes, p_request_id
    );
  end loop;
  for v_line in select * from public.mr_expand_inventory_lines(p_receive_items, false) order by item_id loop
    update public.mr_items
    set current_quantity = current_quantity + v_line.quantity, updated_at = now()
    where id = v_line.item_id and user_id = v_uid
    returning current_quantity into v_balance;
    insert into public.mr_inventory_events (
      user_id, event_at, item_id, event_type, quantity_delta, balance_after, notes, request_id
    ) values (
      v_uid, coalesce(p_event_at, now()), v_line.item_id, 'trade', v_line.quantity,
      v_balance, p_notes, p_request_id
    );
  end loop;
  return v_expected;
end
$function$;

-- Normalize only the two new identities. Existing platform names remain unchanged.
update public.rar_platforms
set name = public.tracker_normalize_platform(name)
where public.tracker_normalize_platform(name) in ('PayPal', 'TNG')
  and name <> public.tracker_normalize_platform(name);

create unique index if not exists rar_platforms_user_canonical_name_unique
  on public.rar_platforms (user_id, public.tracker_normalize_platform(name))
  where public.tracker_normalize_platform(name) is not null;

insert into public.rar_platforms (user_id, name, default_fee_pct, active)
select users.user_id, platform.name, null, true
from (
  select user_id from public.rar_platforms
  union
  select user_id from public.rar_items
  union
  select user_id from public.mr_items
) users
cross join (values ('PayPal'::text), ('TNG'::text)) as platform(name)
where not exists (
  select 1
  from public.rar_platforms existing
  where existing.user_id = users.user_id
    and public.tracker_normalize_platform(existing.name) = platform.name
);

alter table public.mr_items
  add column if not exists aliases text[] not null default '{}'::text[];

create table if not exists public.mr_set_families (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  aliases text[] not null default '{}'::text[],
  table_item_id uuid not null,
  chair_item_id uuid not null,
  chairs_per_set integer not null default 4 check (chairs_per_set > 0),
  active boolean not null default true,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  unique (id, user_id),
  unique (user_id, name),
  constraint mr_set_families_distinct_components check (table_item_id <> chair_item_id),
  constraint mr_set_families_table_item_user_fkey
    foreign key (table_item_id, user_id) references public.mr_items(id, user_id) on delete restrict,
  constraint mr_set_families_chair_item_user_fkey
    foreign key (chair_item_id, user_id) references public.mr_items(id, user_id) on delete restrict
);

create table if not exists public.mr_sales (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  sold_at timestamp with time zone not null default now(),
  platform text not null check (char_length(btrim(platform)) between 1 and 80),
  net_credit numeric not null check (
    net_credit::text not in ('NaN', 'Infinity', '-Infinity') and net_credit >= 0
  ),
  platform_fee numeric not null default 0 check (
    platform_fee::text not in ('NaN', 'Infinity', '-Infinity') and platform_fee >= 0
  ),
  currency text not null check (currency in ('USD', 'MYR', 'PHP', 'IDR')),
  classification text not null default 'normal'
    check (classification in ('normal', 'break_even', 'unknown_price', 'other')),
  inventory_applied boolean not null default true check (inventory_applied = true),
  notes text check (notes is null or char_length(notes) <= 2000),
  request_id uuid not null,
  created_at timestamp with time zone not null default now(),
  unique (id, user_id),
  unique (user_id, request_id)
);

create table if not exists public.mr_sale_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  sale_id uuid not null,
  item_id uuid not null,
  quantity numeric not null check (
    quantity::text not in ('NaN', 'Infinity', '-Infinity') and quantity > 0
  ),
  unit_gross_price numeric check (
    unit_gross_price is null or (
      unit_gross_price::text not in ('NaN', 'Infinity', '-Infinity') and unit_gross_price >= 0
    )
  ),
  created_at timestamp with time zone not null default now(),
  constraint mr_sale_items_sale_user_fkey
    foreign key (sale_id, user_id) references public.mr_sales(id, user_id) on delete restrict,
  constraint mr_sale_items_item_user_fkey
    foreign key (item_id, user_id) references public.mr_items(id, user_id) on delete restrict,
  unique (sale_id, item_id)
);

create table if not exists public.mr_inventory_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_at timestamp with time zone not null default now(),
  item_id uuid not null,
  event_type text not null check (
    event_type in ('sale', 'supplier_purchase', 'trade', 'manual_add', 'reconcile')
  ),
  quantity_delta numeric not null check (
    quantity_delta::text not in ('NaN', 'Infinity', '-Infinity')
  ),
  balance_after numeric not null check (
    balance_after::text not in ('NaN', 'Infinity', '-Infinity') and balance_after >= 0
  ),
  related_sale_id uuid,
  cash_amount numeric,
  cash_currency text,
  notes text check (notes is null or char_length(notes) <= 2000),
  request_id uuid not null,
  created_at timestamp with time zone not null default now(),
  constraint mr_inventory_events_item_user_fkey
    foreign key (item_id, user_id) references public.mr_items(id, user_id) on delete restrict,
  constraint mr_inventory_events_sale_user_fkey
    foreign key (related_sale_id, user_id) references public.mr_sales(id, user_id) on delete restrict,
  constraint mr_inventory_events_cash_valid check (
    (cash_amount is null and cash_currency is null)
    or (
      cash_amount is not null
      and cash_amount::text not in ('NaN', 'Infinity', '-Infinity')
      and cash_amount >= 0
      and cash_currency in ('USD', 'MYR', 'PHP', 'IDR')
    )
  ),
  unique (user_id, request_id, item_id)
);

create table if not exists public.mr_item_prices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  item_id uuid not null,
  amount numeric not null check (
    amount::text not in ('NaN', 'Infinity', '-Infinity') and amount >= 0
  ),
  currency text not null check (currency in ('USD', 'MYR', 'PHP', 'IDR')),
  price_type text not null default 'reference'
    check (price_type in ('reference', 'sale', 'acquisition')),
  notes text check (notes is null or char_length(notes) <= 1000),
  active boolean not null default true,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint mr_item_prices_item_user_fkey
    foreign key (item_id, user_id) references public.mr_items(id, user_id) on delete cascade
);

create index if not exists mr_set_families_user_id_idx on public.mr_set_families (user_id);
create index if not exists mr_set_families_table_item_id_idx on public.mr_set_families (table_item_id);
create index if not exists mr_set_families_chair_item_id_idx on public.mr_set_families (chair_item_id);
create index if not exists mr_sales_user_sold_at_idx on public.mr_sales (user_id, sold_at desc);
create index if not exists mr_sale_items_user_id_idx on public.mr_sale_items (user_id);
create index if not exists mr_sale_items_item_id_idx on public.mr_sale_items (item_id);
create index if not exists mr_inventory_events_user_event_at_idx on public.mr_inventory_events (user_id, event_at desc);
create index if not exists mr_inventory_events_item_id_idx on public.mr_inventory_events (item_id);
create index if not exists mr_inventory_events_related_sale_id_idx on public.mr_inventory_events (related_sale_id);
create index if not exists mr_item_prices_user_id_idx on public.mr_item_prices (user_id);
create index if not exists mr_item_prices_item_id_idx on public.mr_item_prices (item_id);

alter table public.mr_set_families enable row level security;
alter table public.mr_sales enable row level security;
alter table public.mr_sale_items enable row level security;
alter table public.mr_inventory_events enable row level security;
alter table public.mr_item_prices enable row level security;

drop policy if exists "Users manage their MR set families" on public.mr_set_families;
create policy "Users manage their MR set families" on public.mr_set_families
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users view their MR sales" on public.mr_sales;
create policy "Users view their MR sales" on public.mr_sales
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "Users insert their MR sales" on public.mr_sales;
create policy "Users insert their MR sales" on public.mr_sales
  for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists "Users view their MR sale items" on public.mr_sale_items;
create policy "Users view their MR sale items" on public.mr_sale_items
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "Users insert their MR sale items" on public.mr_sale_items;
create policy "Users insert their MR sale items" on public.mr_sale_items
  for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists "Users view their MR inventory events" on public.mr_inventory_events;
create policy "Users view their MR inventory events" on public.mr_inventory_events
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "Users insert their MR inventory events" on public.mr_inventory_events;
create policy "Users insert their MR inventory events" on public.mr_inventory_events
  for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists "Users manage their MR item prices" on public.mr_item_prices;
create policy "Users manage their MR item prices" on public.mr_item_prices
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users update their MR items" on public.mr_items;
create policy "Users update their MR items" on public.mr_items
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
drop policy if exists "Users insert their MR items" on public.mr_items;
create policy "Users insert their MR items" on public.mr_items
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

revoke all on public.mr_set_families, public.mr_sales, public.mr_sale_items,
  public.mr_inventory_events, public.mr_item_prices from anon;
grant select, insert, update, delete on public.mr_set_families, public.mr_item_prices to authenticated;
grant select, insert on public.mr_sales, public.mr_sale_items, public.mr_inventory_events to authenticated;
grant select, insert, update on public.mr_items to authenticated;

create or replace function public.mr_expand_inventory_lines(
  p_payload jsonb,
  p_allow_zero boolean default false
)
returns table (item_id uuid, quantity numeric)
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_count integer;
  v_valid boolean;
  v_found integer;
begin
  if v_uid is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'array'
    or jsonb_array_length(p_payload) not between 1 and 50 then
    raise exception 'Inventory payload must contain between 1 and 50 lines';
  end if;

  select count(*)::integer, coalesce(bool_and(
    ((x.item_id is not null)::integer + (x.set_family_id is not null)::integer) = 1
    and ((x.quantity is not null)::integer + (x.counted_stock is not null)::integer) = 1
    and coalesce(x.quantity, x.counted_stock)::text not in ('NaN', 'Infinity', '-Infinity')
    and case when p_allow_zero
      then coalesce(x.quantity, x.counted_stock) >= 0
      else coalesce(x.quantity, x.counted_stock) > 0
    end
  ), false)
  into v_count, v_valid
  from jsonb_to_recordset(p_payload) as x(
    item_id uuid, set_family_id uuid, quantity numeric, counted_stock numeric
  );
  if v_count = 0 or not v_valid then
    raise exception 'Inventory payload is invalid';
  end if;

  select count(*)::integer into v_found
  from jsonb_to_recordset(p_payload) as x(
    item_id uuid, set_family_id uuid, quantity numeric, counted_stock numeric
  )
  left join public.mr_items i
    on i.id = x.item_id and i.user_id = v_uid and i.is_archived = false
  left join public.mr_set_families f
    on f.id = x.set_family_id and f.user_id = v_uid and f.active = true
  left join public.mr_items table_item
    on table_item.id = f.table_item_id and table_item.user_id = v_uid and table_item.is_archived = false
  left join public.mr_items chair_item
    on chair_item.id = f.chair_item_id and chair_item.user_id = v_uid and chair_item.is_archived = false
  where (x.item_id is not null and i.id is not null)
     or (x.set_family_id is not null and f.id is not null and table_item.id is not null and chair_item.id is not null);
  if v_found <> v_count then
    raise exception 'One or more MR items or set families are invalid or archived';
  end if;

  return query
  with raw as (
    select x.item_id, x.set_family_id, coalesce(x.quantity, x.counted_stock) as quantity
    from jsonb_to_recordset(p_payload) as x(
      item_id uuid, set_family_id uuid, quantity numeric, counted_stock numeric
    )
  ), expanded as (
    select raw.item_id, raw.quantity from raw where raw.item_id is not null
    union all
    select f.table_item_id, raw.quantity
    from raw join public.mr_set_families f
      on f.id = raw.set_family_id and f.user_id = v_uid and f.active = true
    union all
    select f.chair_item_id, raw.quantity * f.chairs_per_set
    from raw join public.mr_set_families f
      on f.id = raw.set_family_id and f.user_id = v_uid and f.active = true
  )
  select expanded.item_id, sum(expanded.quantity)
  from expanded
  group by expanded.item_id;
end
$function$;

revoke all on function public.mr_expand_inventory_lines(jsonb, boolean) from public, anon;
grant execute on function public.mr_expand_inventory_lines(jsonb, boolean) to authenticated;

-- Keep the RAR sale contract intact while accepting canonical platform aliases.
create or replace function public.rar_record_sale(
  p_sold_at timestamp with time zone,
  p_platform text,
  p_net_credit numeric,
  p_platform_fee numeric,
  p_currency text,
  p_classification text,
  p_notes text,
  p_items jsonb,
  p_inventory_applied boolean default true,
  p_request_id uuid default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_sale_id uuid;
  v_platform text;
  v_currency text := upper(btrim(p_currency));
  v_classification text := coalesce(p_classification, 'normal');
  v_inventory_applied boolean := coalesce(p_inventory_applied, true);
  v_line_count integer;
  v_distinct_count integer;
  v_locked_count integer := 0;
  v_valid boolean;
  v_short_name text;
  v_balance numeric;
  v_line record;
begin
  if v_uid is null then
    raise exception 'Authentication required';
  end if;

  if p_request_id is not null then
    perform pg_advisory_xact_lock(hashtextextended(v_uid::text || ':sale:' || p_request_id::text, 0));
    select id into v_sale_id
    from public.rar_sales
    where user_id = v_uid and request_id = p_request_id;
    if found then return v_sale_id; end if;
  end if;

  if p_net_credit is null
    or p_platform_fee is null
    or p_net_credit::text in ('NaN', 'Infinity', '-Infinity')
    or p_platform_fee::text in ('NaN', 'Infinity', '-Infinity')
    or p_net_credit < 0
    or p_platform_fee < 0 then
    raise exception 'Net credit and platform fee must be non-negative numbers';
  end if;
  if v_currency not in ('USD', 'MYR', 'PHP', 'IDR') then raise exception 'Unsupported currency'; end if;
  if v_classification not in ('normal', 'break_even', 'unknown_price', 'other') then
    raise exception 'Invalid sale classification';
  end if;

  select name into v_platform
  from public.rar_platforms
  where user_id = v_uid and active = true
    and public.tracker_normalize_platform(name) = public.tracker_normalize_platform(p_platform)
  limit 1;
  if not found then raise exception 'Invalid or inactive sales platform'; end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Sale items must be a JSON array';
  end if;
  select count(*)::integer, count(distinct x.item_id)::integer, coalesce(bool_and(
    x.item_id is not null
    and x.quantity is not null
    and x.quantity::text not in ('NaN', 'Infinity', '-Infinity')
    and x.quantity > 0
    and (x.unit_gross_price is null or (
      x.unit_gross_price::text not in ('NaN', 'Infinity', '-Infinity') and x.unit_gross_price >= 0
    ))
  ), false)
  into v_line_count, v_distinct_count, v_valid
  from jsonb_to_recordset(p_items) as x(item_id uuid, quantity numeric, unit_gross_price numeric);
  if v_line_count = 0 or v_line_count <> v_distinct_count or not v_valid then
    raise exception 'Sale bundle is empty, invalid, or contains duplicate items';
  end if;

  insert into public.rar_sales (
    user_id, sold_at, platform, net_credit, platform_fee, currency,
    classification, inventory_applied, notes, request_id
  ) values (
    v_uid, coalesce(p_sold_at, now()), v_platform, p_net_credit, p_platform_fee,
    v_currency, v_classification, v_inventory_applied, p_notes, p_request_id
  ) returning id into v_sale_id;

  for v_line in
    select i.id
    from public.rar_items i
    join jsonb_to_recordset(p_items) as x(item_id uuid, quantity numeric, unit_gross_price numeric)
      on x.item_id = i.id
    where i.user_id = v_uid
    order by i.id
    for update of i
  loop
    v_locked_count := v_locked_count + 1;
  end loop;
  if v_locked_count <> v_line_count or exists (
    select 1
    from public.rar_items i
    join jsonb_to_recordset(p_items) as x(item_id uuid, quantity numeric, unit_gross_price numeric)
      on x.item_id = i.id
    where i.user_id = v_uid and i.active = false
  ) then
    raise exception 'One or more sale items are invalid or inactive';
  end if;

  if v_inventory_applied then
    select i.name into v_short_name
    from public.rar_items i
    join jsonb_to_recordset(p_items) as x(item_id uuid, quantity numeric, unit_gross_price numeric)
      on x.item_id = i.id
    where i.user_id = v_uid and i.stock < x.quantity
    order by i.name
    limit 1;
    if found then raise exception 'Insufficient stock for %', v_short_name; end if;
  end if;

  for v_line in
    select *
    from jsonb_to_recordset(p_items) as x(item_id uuid, quantity numeric, unit_gross_price numeric)
    order by item_id
  loop
    insert into public.rar_sale_items (user_id, sale_id, item_id, quantity, unit_gross_price)
    values (v_uid, v_sale_id, v_line.item_id, v_line.quantity, v_line.unit_gross_price);
    if v_inventory_applied then
      update public.rar_items
      set stock = stock - v_line.quantity, updated_at = now()
      where id = v_line.item_id and user_id = v_uid and stock >= v_line.quantity
      returning stock into v_balance;
      if not found then raise exception 'Insufficient stock for a sale item'; end if;
      insert into public.rar_inventory_events (
        user_id, event_at, item_id, event_type, quantity_delta,
        related_sale_id, notes, request_id, balance_after
      ) values (
        v_uid, coalesce(p_sold_at, now()), v_line.item_id, 'sale', -v_line.quantity,
        v_sale_id, p_notes, p_request_id, v_balance
      );
    end if;
  end loop;
  return v_sale_id;
end
$function$;

create or replace view public.mr_set_stock_summary
with (security_invoker = true)
as
select
  family.user_id,
  family.id as family_id,
  family.name,
  table_item.current_quantity as tables,
  chair_item.current_quantity as chairs,
  family.chairs_per_set,
  least(table_item.current_quantity, floor(chair_item.current_quantity / family.chairs_per_set)) as completed_sets,
  table_item.current_quantity
    - least(table_item.current_quantity, floor(chair_item.current_quantity / family.chairs_per_set)) as excess_tables,
  chair_item.current_quantity
    - (least(table_item.current_quantity, floor(chair_item.current_quantity / family.chairs_per_set))
      * family.chairs_per_set) as excess_chairs
from public.mr_set_families family
join public.mr_items table_item
  on table_item.id = family.table_item_id and table_item.user_id = family.user_id
join public.mr_items chair_item
  on chair_item.id = family.chair_item_id and chair_item.user_id = family.user_id
where family.active = true and table_item.is_archived = false and chair_item.is_archived = false;

revoke all on public.mr_set_stock_summary from anon;
grant select on public.mr_set_stock_summary to authenticated;

revoke all on function public.tracker_normalize_platform(text) from public, anon;
grant execute on function public.tracker_normalize_platform(text) to authenticated;
revoke all on function public.mr_add_stock_bundle(jsonb, timestamp with time zone, text, uuid) from public, anon;
grant execute on function public.mr_add_stock_bundle(jsonb, timestamp with time zone, text, uuid) to authenticated;
revoke all on function public.mr_record_purchase_bundle(
  jsonb, numeric, text, timestamp with time zone, text, uuid
) from public, anon;
grant execute on function public.mr_record_purchase_bundle(
  jsonb, numeric, text, timestamp with time zone, text, uuid
) to authenticated;
revoke all on function public.mr_reconcile_stock_batch(jsonb, timestamp with time zone, text, uuid) from public, anon;
grant execute on function public.mr_reconcile_stock_batch(jsonb, timestamp with time zone, text, uuid) to authenticated;
revoke all on function public.mr_record_trade(
  timestamp with time zone, jsonb, jsonb, text, uuid
) from public, anon;
grant execute on function public.mr_record_trade(
  timestamp with time zone, jsonb, jsonb, text, uuid
) to authenticated;

create or replace function public.mr_record_sale(
  p_sold_at timestamp with time zone,
  p_platform text,
  p_net_credit numeric,
  p_platform_fee numeric,
  p_currency text,
  p_classification text,
  p_notes text,
  p_items jsonb,
  p_inventory_applied boolean default true,
  p_request_id uuid default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_sale_id uuid;
  v_platform text;
  v_currency text := upper(btrim(p_currency));
  v_classification text := coalesce(p_classification, 'normal');
  v_line_count integer;
  v_locked_count integer := 0;
  v_short_name text;
  v_balance numeric;
  v_line record;
begin
  if v_uid is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_request_id is null then raise exception 'A deterministic request ID is required'; end if;
  if coalesce(p_inventory_applied, true) is false then raise exception 'MR sales must update inventory'; end if;

  perform pg_advisory_xact_lock(hashtextextended(v_uid::text || ':mr:sale:' || p_request_id::text, 0));
  select id into v_sale_id from public.mr_sales
  where user_id = v_uid and request_id = p_request_id;
  if found then return v_sale_id; end if;

  if p_net_credit is null or p_platform_fee is null
    or p_net_credit::text in ('NaN', 'Infinity', '-Infinity')
    or p_platform_fee::text in ('NaN', 'Infinity', '-Infinity')
    or p_net_credit < 0 or p_platform_fee < 0 then
    raise exception 'Net credit and platform fee must be non-negative numbers';
  end if;
  if v_currency not in ('USD', 'MYR', 'PHP', 'IDR') then raise exception 'Unsupported currency'; end if;
  if v_classification not in ('normal', 'break_even', 'unknown_price', 'other') then
    raise exception 'Invalid sale classification';
  end if;

  select name into v_platform from public.rar_platforms
  where user_id = v_uid and active = true
    and public.tracker_normalize_platform(name) = public.tracker_normalize_platform(p_platform)
  limit 1;
  if not found then raise exception 'Invalid or inactive sales platform'; end if;

  select count(*)::integer into v_line_count
  from public.mr_expand_inventory_lines(p_items, false);

  for v_line in
    select i.id
    from public.mr_items i
    join public.mr_expand_inventory_lines(p_items, false) x on x.item_id = i.id
    where i.user_id = v_uid and i.is_archived = false
    order by i.id
    for update of i
  loop
    v_locked_count := v_locked_count + 1;
  end loop;
  if v_line_count = 0 or v_locked_count <> v_line_count then
    raise exception 'One or more MR sale items are invalid or archived';
  end if;

  select i.name into v_short_name
  from public.mr_items i
  join public.mr_expand_inventory_lines(p_items, false) x on x.item_id = i.id
  where i.user_id = v_uid and i.current_quantity < x.quantity
  order by i.name limit 1;
  if found then raise exception 'Insufficient stock for %', v_short_name; end if;

  insert into public.mr_sales (
    user_id, sold_at, platform, net_credit, platform_fee, currency,
    classification, inventory_applied, notes, request_id
  ) values (
    v_uid, coalesce(p_sold_at, now()), v_platform, p_net_credit, p_platform_fee,
    v_currency, v_classification, true, p_notes, p_request_id
  ) returning id into v_sale_id;

  for v_line in
    select * from public.mr_expand_inventory_lines(p_items, false) order by item_id
  loop
    update public.mr_items
    set current_quantity = current_quantity - v_line.quantity, updated_at = now()
    where id = v_line.item_id and user_id = v_uid and current_quantity >= v_line.quantity
    returning current_quantity into v_balance;
    if not found then raise exception 'Insufficient stock for an MR sale item'; end if;

    insert into public.mr_sale_items (user_id, sale_id, item_id, quantity)
    values (v_uid, v_sale_id, v_line.item_id, v_line.quantity);
    insert into public.mr_inventory_events (
      user_id, event_at, item_id, event_type, quantity_delta, balance_after,
      related_sale_id, notes, request_id
    ) values (
      v_uid, coalesce(p_sold_at, now()), v_line.item_id, 'sale', -v_line.quantity, v_balance,
      v_sale_id, p_notes, p_request_id
    );
  end loop;
  return v_sale_id;
end
$function$;

revoke all on function public.mr_record_sale(
  timestamp with time zone, text, numeric, numeric, text, text, text, jsonb, boolean, uuid
) from public, anon;
grant execute on function public.mr_record_sale(
  timestamp with time zone, text, numeric, numeric, text, text, text, jsonb, boolean, uuid
) to authenticated;

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
  v_uid uuid := auth.uid();
  v_item_id uuid;
begin
  if v_uid is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if char_length(btrim(coalesce(p_name, ''))) not between 1 and 120 then
    raise exception 'Item name is required and must be 120 characters or fewer';
  end if;
  if char_length(btrim(coalesce(p_category, ''))) not between 1 and 80 then
    raise exception 'Category is required and must be 80 characters or fewer';
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

  if p_item_id is null then
    insert into public.mr_items (
      user_id, name, category, unit, aliases, notes, image_url, low_stock_threshold, current_quantity
    ) values (
      v_uid, btrim(p_name), btrim(p_category), btrim(p_unit), coalesce(p_aliases, '{}'::text[]),
      nullif(btrim(coalesce(p_notes, '')), ''), nullif(btrim(coalesce(p_image_url, '')), ''),
      p_low_stock_threshold, 0
    ) returning id into v_item_id;
  else
    update public.mr_items set
      name = btrim(p_name),
      category = btrim(p_category),
      unit = btrim(p_unit),
      aliases = coalesce(p_aliases, '{}'::text[]),
      notes = nullif(btrim(coalesce(p_notes, '')), ''),
      image_url = nullif(btrim(coalesce(p_image_url, '')), ''),
      low_stock_threshold = p_low_stock_threshold,
      updated_at = now()
    where id = p_item_id and user_id = v_uid
    returning id into v_item_id;
    if not found then raise exception 'MR item was not found'; end if;
  end if;
  return v_item_id;
end
$function$;

revoke all on function public.mr_upsert_catalog_item(
  text, text, text, text[], text, text, numeric, uuid
) from public, anon;
grant execute on function public.mr_upsert_catalog_item(
  text, text, text, text[], text, text, numeric, uuid
) to authenticated;
