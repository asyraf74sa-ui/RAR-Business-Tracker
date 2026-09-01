-- Harden every stock- and money-moving operation at the database boundary.
-- This migration is intentionally additive: it preserves all existing business data.

alter table public.rar_sales
  add column if not exists request_id uuid;

alter table public.rar_inventory_events
  add column if not exists request_id uuid,
  add column if not exists balance_after numeric;

create unique index if not exists rar_sales_user_request_id_unique
  on public.rar_sales (user_id, request_id)
  where request_id is not null;

create unique index if not exists rar_inventory_events_user_request_item_unique
  on public.rar_inventory_events (user_id, request_id, item_id)
  where request_id is not null;

create unique index if not exists rar_items_user_normalized_name_unique
  on public.rar_items (user_id, lower(btrim(name)));

create unique index if not exists rar_platforms_user_normalized_name_unique
  on public.rar_platforms (user_id, lower(btrim(name)));

do $constraints$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'rar_items_stock_nonnegative'
      and conrelid = 'public.rar_items'::regclass
  ) then
    alter table public.rar_items
      add constraint rar_items_stock_nonnegative
      check (stock::text not in ('NaN', 'Infinity', '-Infinity') and stock >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'rar_items_gem_range_valid'
      and conrelid = 'public.rar_items'::regclass
  ) then
    alter table public.rar_items
      add constraint rar_items_gem_range_valid
      check (
        (gem_value_min is null and gem_value_max is null)
        or (
          gem_value_min is not null
          and gem_value_max is not null
          and gem_value_min::text not in ('NaN', 'Infinity', '-Infinity')
          and gem_value_max::text not in ('NaN', 'Infinity', '-Infinity')
          and gem_value_min >= 0
          and gem_value_max >= gem_value_min
        )
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'rar_platforms_fee_valid'
      and conrelid = 'public.rar_platforms'::regclass
  ) then
    alter table public.rar_platforms
      add constraint rar_platforms_fee_valid
      check (
        default_fee_pct is null
        or (
          default_fee_pct::text not in ('NaN', 'Infinity', '-Infinity')
          and default_fee_pct >= 0
          and default_fee_pct < 100
        )
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'rar_sales_amounts_nonnegative'
      and conrelid = 'public.rar_sales'::regclass
  ) then
    alter table public.rar_sales
      add constraint rar_sales_amounts_nonnegative
      check (
        net_credit::text not in ('NaN', 'Infinity', '-Infinity')
        and platform_fee::text not in ('NaN', 'Infinity', '-Infinity')
        and net_credit >= 0
        and platform_fee >= 0
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'rar_sales_currency_supported'
      and conrelid = 'public.rar_sales'::regclass
  ) then
    alter table public.rar_sales
      add constraint rar_sales_currency_supported
      check (currency in ('USD', 'MYR', 'PHP', 'IDR'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'rar_inventory_events_cash_valid'
      and conrelid = 'public.rar_inventory_events'::regclass
  ) then
    alter table public.rar_inventory_events
      add constraint rar_inventory_events_cash_valid
      check (
        (cash_amount is null and cash_currency is null)
        or (
          cash_amount is not null
          and cash_currency in ('USD', 'MYR', 'PHP', 'IDR')
          and cash_amount::text not in ('NaN', 'Infinity', '-Infinity')
          and cash_amount >= 0
        )
      );
  end if;
end
$constraints$;

create or replace function public.rar_ensure_defaults(
  p_items jsonb,
  p_platforms jsonb
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_count integer;
  v_distinct_count integer;
  v_valid boolean;
  v_seeded boolean := false;
  v_row record;
begin
  if v_uid is null then
    raise exception 'Authentication required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_uid::text || ':rar-defaults', 0));

  if not exists (select 1 from public.rar_items where user_id = v_uid) then
    if p_items is null or jsonb_typeof(p_items) <> 'array' then
      raise exception 'Default items must be a JSON array';
    end if;

    select
      count(*)::integer,
      count(distinct lower(btrim(coalesce(x.name, ''))))::integer,
      coalesce(bool_and(
        nullif(btrim(x.name), '') is not null
        and coalesce(x.kind, 'item') in ('item', 'currency')
        and coalesce(x.stock, 0)::text not in ('NaN', 'Infinity', '-Infinity')
        and coalesce(x.stock, 0) >= 0
        and (
          (x.gem_value_min is null and x.gem_value_max is null)
          or (
            x.gem_value_min is not null
            and x.gem_value_max is not null
            and x.gem_value_min::text not in ('NaN', 'Infinity', '-Infinity')
            and x.gem_value_max::text not in ('NaN', 'Infinity', '-Infinity')
            and x.gem_value_min >= 0
            and x.gem_value_max >= x.gem_value_min
          )
        )
      ), false)
    into v_count, v_distinct_count, v_valid
    from jsonb_to_recordset(p_items) as x(
      name text,
      kind text,
      stock numeric,
      gem_value_min numeric,
      gem_value_max numeric,
      is_farm_item boolean,
      active boolean
    );

    if v_count = 0 or v_count <> v_distinct_count or not v_valid then
      raise exception 'Default item payload is invalid or contains duplicate names';
    end if;

    if (
      select count(*)
      from jsonb_to_recordset(p_items) as x(name text, kind text)
      where coalesce(x.kind, 'item') = 'currency' and lower(btrim(x.name)) = 'gems'
    ) <> 1 then
      raise exception 'Default items must contain exactly one Gems currency row';
    end if;

    for v_row in
      select *
      from jsonb_to_recordset(p_items) as x(
        name text,
        kind text,
        stock numeric,
        gem_value_min numeric,
        gem_value_max numeric,
        is_farm_item boolean,
        active boolean
      )
      order by lower(btrim(name))
    loop
      insert into public.rar_items (
        user_id, name, kind, stock, gem_value_min, gem_value_max, is_farm_item, active
      ) values (
        v_uid,
        btrim(v_row.name),
        coalesce(v_row.kind, 'item'),
        coalesce(v_row.stock, 0),
        v_row.gem_value_min,
        v_row.gem_value_max,
        coalesce(v_row.is_farm_item, false),
        coalesce(v_row.active, true)
      );
    end loop;
    v_seeded := true;
  end if;

  if not exists (select 1 from public.rar_platforms where user_id = v_uid) then
    if p_platforms is null or jsonb_typeof(p_platforms) <> 'array' then
      raise exception 'Default platforms must be a JSON array';
    end if;

    select
      count(*)::integer,
      count(distinct lower(btrim(coalesce(x.name, ''))))::integer,
      coalesce(bool_and(
        nullif(btrim(x.name), '') is not null
        and (
          x.default_fee_pct is null
          or (
            x.default_fee_pct::text not in ('NaN', 'Infinity', '-Infinity')
            and x.default_fee_pct >= 0
            and x.default_fee_pct < 100
          )
        )
      ), false)
    into v_count, v_distinct_count, v_valid
    from jsonb_to_recordset(p_platforms) as x(name text, default_fee_pct numeric);

    if v_count = 0 or v_count <> v_distinct_count or not v_valid then
      raise exception 'Default platform payload is invalid or contains duplicate names';
    end if;

    insert into public.rar_platforms (user_id, name, default_fee_pct, active)
    select v_uid, btrim(x.name), x.default_fee_pct, true
    from jsonb_to_recordset(p_platforms) as x(name text, default_fee_pct numeric)
    order by lower(btrim(x.name));
    v_seeded := true;
  end if;

  insert into public.rar_farm_config (user_id, farming_accounts, cycle_days, units_per_item_per_account)
  values (v_uid, 3, 2.5, 1)
  on conflict (user_id) do nothing;

  return v_seeded;
end
$function$;

drop function if exists public.rar_record_sale(
  timestamp with time zone, text, numeric, numeric, text, text, text, jsonb, boolean, uuid
);
drop function if exists public.rar_record_sale(
  timestamp with time zone, text, numeric, numeric, text, text, text, jsonb, boolean
);

create function public.rar_record_sale(
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
    if found then
      return v_sale_id;
    end if;
  end if;

  if p_net_credit is null
    or p_platform_fee is null
    or p_net_credit::text in ('NaN', 'Infinity', '-Infinity')
    or p_platform_fee::text in ('NaN', 'Infinity', '-Infinity')
    or p_net_credit < 0
    or p_platform_fee < 0 then
    raise exception 'Net credit and platform fee must be non-negative numbers';
  end if;

  if v_currency not in ('USD', 'MYR', 'PHP', 'IDR') then
    raise exception 'Unsupported currency';
  end if;

  if v_classification not in ('normal', 'break_even', 'unknown_price', 'other') then
    raise exception 'Invalid sale classification';
  end if;

  select name into v_platform
  from public.rar_platforms
  where user_id = v_uid
    and active = true
    and lower(name) = lower(btrim(p_platform))
  limit 1;
  if not found then
    raise exception 'Invalid or inactive sales platform';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Sale items must be a JSON array';
  end if;

  select
    count(*)::integer,
    count(distinct x.item_id)::integer,
    coalesce(bool_and(
      x.item_id is not null
      and x.quantity is not null
      and x.quantity::text not in ('NaN', 'Infinity', '-Infinity')
      and x.quantity > 0
      and (
        x.unit_gross_price is null
        or (
          x.unit_gross_price::text not in ('NaN', 'Infinity', '-Infinity')
          and x.unit_gross_price >= 0
        )
      )
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
    if found then
      raise exception 'Insufficient stock for %', v_short_name;
    end if;
  end if;

  for v_line in
    select *
    from jsonb_to_recordset(p_items) as x(item_id uuid, quantity numeric, unit_gross_price numeric)
    order by item_id
  loop
    insert into public.rar_sale_items (
      user_id, sale_id, item_id, quantity, unit_gross_price
    ) values (
      v_uid, v_sale_id, v_line.item_id, v_line.quantity, v_line.unit_gross_price
    );

    if v_inventory_applied then
      update public.rar_items
      set stock = stock - v_line.quantity, updated_at = now()
      where id = v_line.item_id and user_id = v_uid and stock >= v_line.quantity
      returning stock into v_balance;
      if not found then
        raise exception 'Insufficient stock for a sale item';
      end if;

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

drop function if exists public.rar_convert_item_to_gems(
  uuid, numeric, numeric, timestamp with time zone, text, uuid
);
drop function if exists public.rar_convert_item_to_gems(
  uuid, numeric, numeric, timestamp with time zone, text
);

create function public.rar_convert_item_to_gems(
  p_item_id uuid,
  p_quantity numeric,
  p_gems_received numeric,
  p_event_at timestamp with time zone default now(),
  p_notes text default null,
  p_request_id uuid default null
)
returns numeric
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_gem_id uuid;
  v_locked integer := 0;
  v_item_stock numeric;
  v_item_balance numeric;
  v_gem_balance numeric;
  v_existing record;
  v_lock_id uuid;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if p_quantity is null or p_gems_received is null
    or p_quantity::text in ('NaN', 'Infinity', '-Infinity')
    or p_gems_received::text in ('NaN', 'Infinity', '-Infinity')
    or p_quantity <= 0 or p_gems_received <= 0 then
    raise exception 'Quantity and gems must be positive numbers';
  end if;

  if p_request_id is not null then
    perform pg_advisory_xact_lock(hashtextextended(v_uid::text || ':inventory:' || p_request_id::text, 0));
    if exists (
      select 1 from public.rar_inventory_events
      where user_id = v_uid and request_id = p_request_id and event_type <> 'gem_conversion'
    ) then
      raise exception 'Request ID was already used for another operation';
    end if;
    select e.item_id, e.quantity_delta, e.gem_amount into v_existing
    from public.rar_inventory_events e
    join public.rar_items i on i.id = e.item_id and i.user_id = v_uid and i.kind = 'item'
    where e.user_id = v_uid and e.request_id = p_request_id and e.event_type = 'gem_conversion'
    limit 1;
    if found then
      if v_existing.item_id <> p_item_id
        or v_existing.quantity_delta <> -p_quantity
        or v_existing.gem_amount <> p_gems_received then
        raise exception 'Request ID was reused with different Gem conversion details';
      end if;
      return -p_gems_received;
    end if;
  end if;

  select id into v_gem_id
  from public.rar_items
  where user_id = v_uid and kind = 'currency' and lower(name) = 'gems' and active = true
  limit 1;
  if v_gem_id is null then raise exception 'Gems currency item not found'; end if;

  for v_lock_id in
    select id from public.rar_items
    where user_id = v_uid and id in (p_item_id, v_gem_id)
    order by id for update
  loop
    v_locked := v_locked + 1;
  end loop;
  if v_locked <> 2 then raise exception 'Invalid item or Gem wallet'; end if;

  select stock into v_item_stock
  from public.rar_items
  where id = p_item_id and user_id = v_uid and kind = 'item' and active = true;
  if not found then raise exception 'Invalid or inactive item'; end if;
  if v_item_stock < p_quantity then raise exception 'Insufficient item stock'; end if;

  update public.rar_items
  set stock = stock - p_quantity, updated_at = now()
  where id = p_item_id and user_id = v_uid and stock >= p_quantity
  returning stock into v_item_balance;
  if not found then raise exception 'Insufficient item stock'; end if;

  update public.rar_items
  set stock = stock + p_gems_received, updated_at = now()
  where id = v_gem_id and user_id = v_uid
  returning stock into v_gem_balance;

  insert into public.rar_inventory_events (
    user_id, event_at, item_id, event_type, quantity_delta, gem_amount,
    notes, request_id, balance_after
  ) values (
    v_uid, coalesce(p_event_at, now()), p_item_id, 'gem_conversion', -p_quantity,
    p_gems_received, p_notes, p_request_id, v_item_balance
  );
  insert into public.rar_inventory_events (
    user_id, event_at, item_id, event_type, quantity_delta, gem_amount,
    notes, request_id, balance_after
  ) values (
    v_uid, coalesce(p_event_at, now()), v_gem_id, 'gem_conversion', p_gems_received,
    p_gems_received, coalesce(p_notes, 'Received from item conversion'), p_request_id, v_gem_balance
  );

  return p_gems_received;
end
$function$;

drop function if exists public.rar_buy_item_with_gems(
  uuid, numeric, numeric, timestamp with time zone, text, uuid
);
drop function if exists public.rar_buy_item_with_gems(
  uuid, numeric, numeric, timestamp with time zone, text
);

create function public.rar_buy_item_with_gems(
  p_item_id uuid,
  p_quantity numeric,
  p_gems_spent numeric,
  p_event_at timestamp with time zone default now(),
  p_notes text default null,
  p_request_id uuid default null
)
returns numeric
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_gem_id uuid;
  v_locked integer := 0;
  v_gem_stock numeric;
  v_item_balance numeric;
  v_gem_balance numeric;
  v_existing record;
  v_lock_id uuid;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if p_quantity is null or p_gems_spent is null
    or p_quantity::text in ('NaN', 'Infinity', '-Infinity')
    or p_gems_spent::text in ('NaN', 'Infinity', '-Infinity')
    or p_quantity <= 0 or p_gems_spent <= 0 then
    raise exception 'Quantity and gems must be positive numbers';
  end if;

  if p_request_id is not null then
    perform pg_advisory_xact_lock(hashtextextended(v_uid::text || ':inventory:' || p_request_id::text, 0));
    if exists (
      select 1 from public.rar_inventory_events
      where user_id = v_uid and request_id = p_request_id and event_type <> 'gem_purchase'
    ) then
      raise exception 'Request ID was already used for another operation';
    end if;
    select e.item_id, e.quantity_delta, e.gem_amount into v_existing
    from public.rar_inventory_events e
    join public.rar_items i on i.id = e.item_id and i.user_id = v_uid and i.kind = 'item'
    where e.user_id = v_uid and e.request_id = p_request_id and e.event_type = 'gem_purchase'
    limit 1;
    if found then
      if v_existing.item_id <> p_item_id
        or v_existing.quantity_delta <> p_quantity
        or v_existing.gem_amount <> -p_gems_spent then
        raise exception 'Request ID was reused with different Gem purchase details';
      end if;
      return -p_quantity;
    end if;
  end if;

  select id into v_gem_id
  from public.rar_items
  where user_id = v_uid and kind = 'currency' and lower(name) = 'gems' and active = true
  limit 1;
  if v_gem_id is null then raise exception 'Gems currency item not found'; end if;

  for v_lock_id in
    select id from public.rar_items
    where user_id = v_uid and id in (p_item_id, v_gem_id)
    order by id for update
  loop
    v_locked := v_locked + 1;
  end loop;
  if v_locked <> 2 then raise exception 'Invalid item or Gem wallet'; end if;

  if not exists (
    select 1 from public.rar_items
    where id = p_item_id and user_id = v_uid and kind = 'item' and active = true
  ) then
    raise exception 'Invalid or inactive item';
  end if;

  select stock into v_gem_stock
  from public.rar_items where id = v_gem_id and user_id = v_uid;
  if v_gem_stock < p_gems_spent then raise exception 'Insufficient Gem balance'; end if;

  update public.rar_items
  set stock = stock - p_gems_spent, updated_at = now()
  where id = v_gem_id and user_id = v_uid and stock >= p_gems_spent
  returning stock into v_gem_balance;
  if not found then raise exception 'Insufficient Gem balance'; end if;

  update public.rar_items
  set stock = stock + p_quantity, updated_at = now()
  where id = p_item_id and user_id = v_uid
  returning stock into v_item_balance;

  insert into public.rar_inventory_events (
    user_id, event_at, item_id, event_type, quantity_delta, gem_amount,
    notes, request_id, balance_after
  ) values (
    v_uid, coalesce(p_event_at, now()), v_gem_id, 'gem_purchase', -p_gems_spent,
    -p_gems_spent, p_notes, p_request_id, v_gem_balance
  );
  insert into public.rar_inventory_events (
    user_id, event_at, item_id, event_type, quantity_delta, gem_amount,
    notes, request_id, balance_after
  ) values (
    v_uid, coalesce(p_event_at, now()), p_item_id, 'gem_purchase', p_quantity,
    -p_gems_spent, coalesce(p_notes, 'Purchased with gems'), p_request_id, v_item_balance
  );

  return p_quantity;
end
$function$;

drop function if exists public.rar_record_purchase(
  uuid, numeric, numeric, text, timestamp with time zone, text, uuid
);
drop function if exists public.rar_record_purchase(
  uuid, numeric, numeric, text, timestamp with time zone, text
);

create function public.rar_record_purchase(
  p_item_id uuid,
  p_quantity numeric,
  p_cash_amount numeric default null,
  p_cash_currency text default null,
  p_event_at timestamp with time zone default now(),
  p_notes text default null,
  p_request_id uuid default null
)
returns numeric
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_currency text := case when p_cash_currency is null then null else upper(btrim(p_cash_currency)) end;
  v_balance numeric;
  v_existing record;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if p_quantity is null
    or p_quantity::text in ('NaN', 'Infinity', '-Infinity')
    or p_quantity <= 0 then
    raise exception 'Quantity must be a positive number';
  end if;
  if (p_cash_amount is null) <> (p_cash_currency is null) then
    raise exception 'Cash amount and currency must be supplied together';
  end if;
  if p_cash_amount is not null and (
    p_cash_amount::text in ('NaN', 'Infinity', '-Infinity')
    or p_cash_amount < 0
    or v_currency not in ('USD', 'MYR', 'PHP', 'IDR')
  ) then
    raise exception 'Cash amount or currency is invalid';
  end if;

  if p_request_id is not null then
    perform pg_advisory_xact_lock(hashtextextended(v_uid::text || ':inventory:' || p_request_id::text, 0));
    if exists (
      select 1 from public.rar_inventory_events
      where user_id = v_uid and request_id = p_request_id and event_type <> 'supplier_purchase'
    ) then
      raise exception 'Request ID was already used for another operation';
    end if;
    select item_id, quantity_delta, cash_amount, cash_currency into v_existing
    from public.rar_inventory_events
    where user_id = v_uid and request_id = p_request_id and event_type = 'supplier_purchase'
    limit 1;
    if found then
      if v_existing.item_id <> p_item_id
        or v_existing.quantity_delta <> p_quantity
        or v_existing.cash_amount is distinct from p_cash_amount
        or v_existing.cash_currency is distinct from v_currency then
        raise exception 'Request ID was reused with different purchase details';
      end if;
      return -p_quantity;
    end if;
  end if;

  perform id
  from public.rar_items
  where id = p_item_id and user_id = v_uid and kind = 'item' and active = true
  for update;
  if not found then raise exception 'Invalid or inactive item'; end if;

  update public.rar_items
  set stock = stock + p_quantity, updated_at = now()
  where id = p_item_id and user_id = v_uid
  returning stock into v_balance;

  insert into public.rar_inventory_events (
    user_id, event_at, item_id, event_type, quantity_delta, cash_amount,
    cash_currency, notes, request_id, balance_after
  ) values (
    v_uid, coalesce(p_event_at, now()), p_item_id, 'supplier_purchase', p_quantity,
    p_cash_amount, v_currency, p_notes, p_request_id, v_balance
  );

  return p_quantity;
end
$function$;

create or replace function public.rar_reconcile_stock(
  p_item_id uuid,
  p_counted_stock numeric,
  p_event_at timestamp with time zone default now(),
  p_notes text default 'Weekly stocktake'
)
returns numeric
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_old numeric;
  v_delta numeric;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if p_counted_stock is null
    or p_counted_stock::text in ('NaN', 'Infinity', '-Infinity')
    or p_counted_stock < 0 then
    raise exception 'Counted stock must be a non-negative number';
  end if;

  select stock into v_old
  from public.rar_items
  where id = p_item_id and user_id = v_uid
  for update;
  if not found then raise exception 'Invalid item'; end if;

  v_delta := p_counted_stock - v_old;
  update public.rar_items
  set stock = p_counted_stock, updated_at = now()
  where id = p_item_id and user_id = v_uid;

  if v_delta <> 0 then
    insert into public.rar_inventory_events (
      user_id, event_at, item_id, event_type, quantity_delta, notes, balance_after
    ) values (
      v_uid, coalesce(p_event_at, now()), p_item_id, 'stock_adjustment',
      v_delta, p_notes, p_counted_stock
    );
  end if;
  return v_delta;
end
$function$;

create or replace function public.rar_reconcile_stock_batch(
  p_counts jsonb,
  p_event_at timestamp with time zone default now(),
  p_notes text default 'Weekly stocktake',
  p_request_id uuid default null
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_line_count integer;
  v_distinct_count integer;
  v_locked_count integer := 0;
  v_existing_count integer;
  v_valid boolean;
  v_old numeric;
  v_delta numeric;
  v_line record;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if p_counts is null or jsonb_typeof(p_counts) <> 'array' then
    raise exception 'Stocktake counts must be a JSON array';
  end if;

  select
    count(*)::integer,
    count(distinct x.item_id)::integer,
    coalesce(bool_and(
      x.item_id is not null
      and x.counted_stock is not null
      and x.counted_stock::text not in ('NaN', 'Infinity', '-Infinity')
      and x.counted_stock >= 0
    ), false)
  into v_line_count, v_distinct_count, v_valid
  from jsonb_to_recordset(p_counts) as x(item_id uuid, counted_stock numeric);

  if v_line_count = 0 or v_line_count <> v_distinct_count or not v_valid then
    raise exception 'Stocktake counts are empty, invalid, or contain duplicate items';
  end if;

  if p_request_id is not null then
    perform pg_advisory_xact_lock(hashtextextended(v_uid::text || ':inventory:' || p_request_id::text, 0));
    if exists (
      select 1 from public.rar_inventory_events
      where user_id = v_uid and request_id = p_request_id and event_type <> 'stock_adjustment'
    ) then
      raise exception 'Request ID was already used for another operation';
    end if;

    select count(*)::integer into v_existing_count
    from public.rar_inventory_events
    where user_id = v_uid and request_id = p_request_id and event_type = 'stock_adjustment';

    if v_existing_count > 0 then
      if v_existing_count <> v_line_count or exists (
        select 1
        from jsonb_to_recordset(p_counts) as x(item_id uuid, counted_stock numeric)
        left join public.rar_inventory_events e
          on e.user_id = v_uid
          and e.request_id = p_request_id
          and e.event_type = 'stock_adjustment'
          and e.item_id = x.item_id
        where e.item_id is null or e.balance_after is distinct from x.counted_stock
      ) then
        raise exception 'Request ID was reused with different stocktake details';
      end if;
      return -v_existing_count;
    end if;
  end if;

  for v_line in
    select i.id
    from public.rar_items i
    join jsonb_to_recordset(p_counts) as x(item_id uuid, counted_stock numeric)
      on x.item_id = i.id
    where i.user_id = v_uid
    order by i.id
    for update of i
  loop
    v_locked_count := v_locked_count + 1;
  end loop;
  if v_locked_count <> v_line_count then raise exception 'One or more stocktake items are invalid'; end if;

  for v_line in
    select *
    from jsonb_to_recordset(p_counts) as x(item_id uuid, counted_stock numeric)
    order by item_id
  loop
    select stock into v_old
    from public.rar_items
    where id = v_line.item_id and user_id = v_uid;
    v_delta := v_line.counted_stock - v_old;

    update public.rar_items
    set stock = v_line.counted_stock, updated_at = now()
    where id = v_line.item_id and user_id = v_uid;

    if v_delta <> 0 or p_request_id is not null then
      insert into public.rar_inventory_events (
        user_id, event_at, item_id, event_type, quantity_delta,
        notes, request_id, balance_after
      ) values (
        v_uid, coalesce(p_event_at, now()), v_line.item_id, 'stock_adjustment',
        v_delta, p_notes, p_request_id, v_line.counted_stock
      );
    end if;
  end loop;

  return v_line_count;
end
$function$;

create or replace function public.rar_update_farm_settings(
  p_farming_accounts integer,
  p_cycle_days numeric,
  p_units_per_item_per_account numeric default null
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if p_farming_accounts is null or p_farming_accounts <= 0 then
    raise exception 'Farming accounts must be positive';
  end if;
  if p_cycle_days is null
    or p_cycle_days::text in ('NaN', 'Infinity', '-Infinity')
    or p_cycle_days <= 0 then
    raise exception 'Cycle days must be positive';
  end if;
  if p_units_per_item_per_account is not null and (
    p_units_per_item_per_account::text in ('NaN', 'Infinity', '-Infinity')
    or p_units_per_item_per_account <= 0
  ) then
    raise exception 'Units per item must be positive';
  end if;

  insert into public.rar_farm_config (user_id)
  values (v_uid)
  on conflict (user_id) do nothing;

  perform user_id
  from public.rar_farm_config
  where user_id = v_uid
  for update;

  update public.rar_farm_config
  set farming_accounts = p_farming_accounts,
      cycle_days = p_cycle_days,
      units_per_item_per_account = coalesce(p_units_per_item_per_account, units_per_item_per_account),
      updated_at = now()
  where user_id = v_uid;

  return true;
end
$function$;

drop function if exists public.rar_claim_farm_cycles(
  integer, timestamp with time zone, uuid
);
drop function if exists public.rar_claim_farm_cycles(
  integer, timestamp with time zone
);

create function public.rar_claim_farm_cycles(
  p_cycles integer default 1,
  p_event_at timestamp with time zone default now(),
  p_request_id uuid default null
)
returns numeric
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_accounts integer;
  v_units numeric;
  v_qty numeric;
  v_total numeric := 0;
  v_existing_count integer;
  v_event_at timestamp with time zone := coalesce(p_event_at, now());
  v_item_ids uuid[] := array[]::uuid[];
  v_item_id uuid;
  v_balance numeric;
  v_row record;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if p_cycles is null or p_cycles <= 0 then raise exception 'Cycles must be positive'; end if;

  if p_request_id is not null then
    perform pg_advisory_xact_lock(hashtextextended(v_uid::text || ':inventory:' || p_request_id::text, 0));
    if exists (
      select 1 from public.rar_inventory_events
      where user_id = v_uid and request_id = p_request_id and event_type <> 'farm'
    ) then
      raise exception 'Request ID was already used for another operation';
    end if;
    select count(*)::integer, coalesce(sum(quantity_delta), 0)
    into v_existing_count, v_total
    from public.rar_inventory_events
    where user_id = v_uid and request_id = p_request_id and event_type = 'farm';
    if v_existing_count > 0 then
      return -v_total;
    end if;
  end if;

  insert into public.rar_farm_config (user_id)
  values (v_uid)
  on conflict (user_id) do nothing;

  select farming_accounts, units_per_item_per_account
  into v_accounts, v_units
  from public.rar_farm_config
  where user_id = v_uid
  for update;

  for v_row in
    select id from public.rar_items
    where user_id = v_uid and kind = 'item' and is_farm_item = true and active = true
    order by id for update
  loop
    v_item_ids := array_append(v_item_ids, v_row.id);
  end loop;
  if cardinality(v_item_ids) = 0 then raise exception 'No active farm items'; end if;

  v_qty := v_accounts * v_units * p_cycles;
  foreach v_item_id in array v_item_ids
  loop
    update public.rar_items
    set stock = stock + v_qty, updated_at = now()
    where id = v_item_id and user_id = v_uid
    returning stock into v_balance;

    insert into public.rar_inventory_events (
      user_id, event_at, item_id, event_type, quantity_delta,
      notes, request_id, balance_after
    ) values (
      v_uid, v_event_at, v_item_id, 'farm', v_qty,
      concat(p_cycles, ' farm cycle(s)'), p_request_id, v_balance
    );
    v_total := v_total + v_qty;
  end loop;

  update public.rar_farm_config
  set last_claim_at = v_event_at, updated_at = now()
  where user_id = v_uid;

  return v_total;
end
$function$;

create or replace function public.rar_sync_farm_due(
  p_now timestamp with time zone default now()
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_now timestamp with time zone := coalesce(p_now, now());
  v_accounts integer;
  v_units numeric;
  v_cycle_days numeric;
  v_last timestamp with time zone;
  v_cycles integer;
  v_qty numeric;
  v_new_last timestamp with time zone;
  v_item_ids uuid[] := array[]::uuid[];
  v_item_id uuid;
  v_balance numeric;
  v_row record;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;

  insert into public.rar_farm_config (user_id, last_claim_at)
  values (v_uid, v_now)
  on conflict (user_id) do nothing;

  select farming_accounts, units_per_item_per_account, cycle_days, last_claim_at
  into v_accounts, v_units, v_cycle_days, v_last
  from public.rar_farm_config
  where user_id = v_uid
  for update;

  if v_last is null then
    update public.rar_farm_config
    set last_claim_at = v_now, updated_at = now()
    where user_id = v_uid;
    return 0;
  end if;

  v_cycles := floor(extract(epoch from (v_now - v_last)) / (v_cycle_days * 86400))::integer;
  if v_cycles <= 0 then return 0; end if;

  for v_row in
    select id from public.rar_items
    where user_id = v_uid and kind = 'item' and is_farm_item = true and active = true
    order by id for update
  loop
    v_item_ids := array_append(v_item_ids, v_row.id);
  end loop;
  if cardinality(v_item_ids) = 0 then raise exception 'No active farm items'; end if;

  v_qty := v_accounts * v_units * v_cycles;
  v_new_last := v_last + (v_cycle_days * v_cycles) * interval '1 day';

  foreach v_item_id in array v_item_ids
  loop
    update public.rar_items
    set stock = stock + v_qty, updated_at = now()
    where id = v_item_id and user_id = v_uid
    returning stock into v_balance;

    insert into public.rar_inventory_events (
      user_id, event_at, item_id, event_type, quantity_delta, notes, balance_after
    ) values (
      v_uid, v_new_last, v_item_id, 'farm', v_qty,
      concat(v_cycles, ' auto-synced farm cycle(s)'), v_balance
    );
  end loop;

  update public.rar_farm_config
  set last_claim_at = v_new_last, updated_at = now()
  where user_id = v_uid;

  return v_cycles;
end
$function$;

revoke all on function public.rar_ensure_defaults(jsonb, jsonb) from public, anon;
revoke all on function public.rar_record_sale(timestamp with time zone, text, numeric, numeric, text, text, text, jsonb, boolean, uuid) from public, anon;
revoke all on function public.rar_convert_item_to_gems(uuid, numeric, numeric, timestamp with time zone, text, uuid) from public, anon;
revoke all on function public.rar_buy_item_with_gems(uuid, numeric, numeric, timestamp with time zone, text, uuid) from public, anon;
revoke all on function public.rar_record_purchase(uuid, numeric, numeric, text, timestamp with time zone, text, uuid) from public, anon;
revoke all on function public.rar_reconcile_stock(uuid, numeric, timestamp with time zone, text) from public, anon;
revoke all on function public.rar_reconcile_stock_batch(jsonb, timestamp with time zone, text, uuid) from public, anon;
revoke all on function public.rar_update_farm_settings(integer, numeric, numeric) from public, anon;
revoke all on function public.rar_claim_farm_cycles(integer, timestamp with time zone, uuid) from public, anon;
revoke all on function public.rar_sync_farm_due(timestamp with time zone) from public, anon;

grant execute on function public.rar_ensure_defaults(jsonb, jsonb) to authenticated;
grant execute on function public.rar_record_sale(timestamp with time zone, text, numeric, numeric, text, text, text, jsonb, boolean, uuid) to authenticated;
grant execute on function public.rar_convert_item_to_gems(uuid, numeric, numeric, timestamp with time zone, text, uuid) to authenticated;
grant execute on function public.rar_buy_item_with_gems(uuid, numeric, numeric, timestamp with time zone, text, uuid) to authenticated;
grant execute on function public.rar_record_purchase(uuid, numeric, numeric, text, timestamp with time zone, text, uuid) to authenticated;
grant execute on function public.rar_reconcile_stock(uuid, numeric, timestamp with time zone, text) to authenticated;
grant execute on function public.rar_reconcile_stock_batch(jsonb, timestamp with time zone, text, uuid) to authenticated;
grant execute on function public.rar_update_farm_settings(integer, numeric, numeric) to authenticated;
grant execute on function public.rar_claim_farm_cycles(integer, timestamp with time zone, uuid) to authenticated;
grant execute on function public.rar_sync_farm_due(timestamp with time zone) to authenticated;
