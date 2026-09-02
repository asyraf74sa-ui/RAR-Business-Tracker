-- Add only the atomic inventory operations required by the Discord acquisition channel.
-- Existing sales, inventory balances, and historical events are preserved.

alter table public.rar_inventory_events
  drop constraint if exists rar_inventory_events_event_type_check;

alter table public.rar_inventory_events
  add constraint rar_inventory_events_event_type_check
  check (event_type in (
    'farm',
    'sale',
    'supplier_purchase',
    'gem_purchase',
    'gem_conversion',
    'stock_adjustment',
    'manual_add',
    'manual_remove',
    'history_import',
    'trade',
    'other'
  ));

create or replace function public.rar_record_purchase_bundle(
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
  v_line_count integer;
  v_distinct_count integer;
  v_locked_count integer := 0;
  v_existing_count integer;
  v_valid boolean;
  v_balance numeric;
  v_line record;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if p_cash_amount is null
    or p_cash_amount::text in ('NaN', 'Infinity', '-Infinity')
    or p_cash_amount < 0
    or p_cash_currency is null
    or v_currency not in ('USD', 'MYR', 'PHP', 'IDR') then
    raise exception 'Cash amount or currency is invalid';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Purchase items must be a JSON array';
  end if;

  select
    count(*)::integer,
    count(distinct x.item_id)::integer,
    coalesce(bool_and(
      x.item_id is not null
      and x.quantity is not null
      and x.quantity::text not in ('NaN', 'Infinity', '-Infinity')
      and x.quantity > 0
    ), false)
  into v_line_count, v_distinct_count, v_valid
  from jsonb_to_recordset(p_items) as x(item_id uuid, quantity numeric);

  if v_line_count = 0 or v_line_count <> v_distinct_count or not v_valid then
    raise exception 'Purchase bundle is empty, invalid, or contains duplicate items';
  end if;

  if p_request_id is not null then
    perform pg_advisory_xact_lock(hashtextextended(v_uid::text || ':inventory:' || p_request_id::text, 0));
    if exists (
      select 1 from public.rar_inventory_events
      where user_id = v_uid and request_id = p_request_id and event_type <> 'supplier_purchase'
    ) then
      raise exception 'Request ID was already used for another operation';
    end if;

    select count(*)::integer into v_existing_count
    from public.rar_inventory_events
    where user_id = v_uid and request_id = p_request_id and event_type = 'supplier_purchase';

    if v_existing_count > 0 then
      if v_existing_count <> v_line_count
        or (
          select count(*)
          from public.rar_inventory_events
          where user_id = v_uid
            and request_id = p_request_id
            and event_type = 'supplier_purchase'
            and cash_amount is not null
        ) <> 1
        or not exists (
          select 1
          from public.rar_inventory_events
          where user_id = v_uid
            and request_id = p_request_id
            and event_type = 'supplier_purchase'
            and cash_amount is not distinct from p_cash_amount
            and cash_currency is not distinct from v_currency
        )
        or exists (
          select 1
          from jsonb_to_recordset(p_items) as x(item_id uuid, quantity numeric)
          left join public.rar_inventory_events e
            on e.user_id = v_uid
            and e.request_id = p_request_id
            and e.event_type = 'supplier_purchase'
            and e.item_id = x.item_id
          where e.item_id is null or e.quantity_delta is distinct from x.quantity
        ) then
        raise exception 'Request ID was reused with different purchase details';
      end if;
      return -v_existing_count;
    end if;
  end if;

  for v_line in
    select i.id
    from public.rar_items i
    join jsonb_to_recordset(p_items) as x(item_id uuid, quantity numeric)
      on x.item_id = i.id
    where i.user_id = v_uid and i.kind = 'item' and i.active = true
    order by i.id
    for update of i
  loop
    v_locked_count := v_locked_count + 1;
  end loop;
  if v_locked_count <> v_line_count then
    raise exception 'One or more purchase items are invalid or inactive';
  end if;

  for v_line in
    select x.*, row_number() over (order by x.item_id) as line_number
    from jsonb_to_recordset(p_items) as x(item_id uuid, quantity numeric)
    order by x.item_id
  loop
    update public.rar_items
    set stock = stock + v_line.quantity, updated_at = now()
    where id = v_line.item_id and user_id = v_uid
    returning stock into v_balance;

    insert into public.rar_inventory_events (
      user_id, event_at, item_id, event_type, quantity_delta, cash_amount,
      cash_currency, notes, request_id, balance_after
    ) values (
      v_uid, coalesce(p_event_at, now()), v_line.item_id, 'supplier_purchase', v_line.quantity,
      case when v_line.line_number = 1 then p_cash_amount else null end,
      case when v_line.line_number = 1 then v_currency else null end,
      p_notes, p_request_id, v_balance
    );
  end loop;

  return v_line_count;
end
$function$;

create or replace function public.rar_record_trade(
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
  v_give_count integer;
  v_give_distinct integer;
  v_receive_count integer;
  v_receive_distinct integer;
  v_locked_count integer := 0;
  v_existing_count integer;
  v_give_valid boolean;
  v_receive_valid boolean;
  v_short_name text;
  v_required numeric;
  v_available numeric;
  v_balance numeric;
  v_line record;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if p_give_items is null or jsonb_typeof(p_give_items) <> 'array'
    or p_receive_items is null or jsonb_typeof(p_receive_items) <> 'array' then
    raise exception 'Trade GIVE and RECEIVE items must be JSON arrays';
  end if;

  select
    count(*)::integer,
    count(distinct x.item_id)::integer,
    coalesce(bool_and(
      x.item_id is not null
      and x.quantity is not null
      and x.quantity::text not in ('NaN', 'Infinity', '-Infinity')
      and x.quantity > 0
    ), false)
  into v_give_count, v_give_distinct, v_give_valid
  from jsonb_to_recordset(p_give_items) as x(item_id uuid, quantity numeric);

  select
    count(*)::integer,
    count(distinct x.item_id)::integer,
    coalesce(bool_and(
      x.item_id is not null
      and x.quantity is not null
      and x.quantity::text not in ('NaN', 'Infinity', '-Infinity')
      and x.quantity > 0
    ), false)
  into v_receive_count, v_receive_distinct, v_receive_valid
  from jsonb_to_recordset(p_receive_items) as x(item_id uuid, quantity numeric);

  if v_give_count = 0 or v_give_count <> v_give_distinct or not v_give_valid
    or v_receive_count = 0 or v_receive_count <> v_receive_distinct or not v_receive_valid then
    raise exception 'Trade GIVE or RECEIVE bundle is empty, invalid, or contains duplicate items';
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(p_give_items) as g(item_id uuid, quantity numeric)
    join jsonb_to_recordset(p_receive_items) as r(item_id uuid, quantity numeric)
      on r.item_id = g.item_id
  ) then
    raise exception 'The same item cannot appear in both GIVE and RECEIVE';
  end if;

  if p_request_id is not null then
    perform pg_advisory_xact_lock(hashtextextended(v_uid::text || ':inventory:' || p_request_id::text, 0));
    if exists (
      select 1 from public.rar_inventory_events
      where user_id = v_uid and request_id = p_request_id and event_type <> 'trade'
    ) then
      raise exception 'Request ID was already used for another operation';
    end if;

    select count(*)::integer into v_existing_count
    from public.rar_inventory_events
    where user_id = v_uid and request_id = p_request_id and event_type = 'trade';

    if v_existing_count > 0 then
      if v_existing_count <> v_give_count + v_receive_count
        or exists (
          select 1
          from jsonb_to_recordset(p_give_items) as x(item_id uuid, quantity numeric)
          left join public.rar_inventory_events e
            on e.user_id = v_uid
            and e.request_id = p_request_id
            and e.event_type = 'trade'
            and e.item_id = x.item_id
          where e.item_id is null or e.quantity_delta is distinct from -x.quantity
        )
        or exists (
          select 1
          from jsonb_to_recordset(p_receive_items) as x(item_id uuid, quantity numeric)
          left join public.rar_inventory_events e
            on e.user_id = v_uid
            and e.request_id = p_request_id
            and e.event_type = 'trade'
            and e.item_id = x.item_id
          where e.item_id is null or e.quantity_delta is distinct from x.quantity
        ) then
        raise exception 'Request ID was reused with different trade details';
      end if;
      return -v_existing_count;
    end if;
  end if;

  for v_line in
    select i.id
    from public.rar_items i
    join (
      select x.item_id from jsonb_to_recordset(p_give_items) as x(item_id uuid, quantity numeric)
      union all
      select x.item_id from jsonb_to_recordset(p_receive_items) as x(item_id uuid, quantity numeric)
    ) affected on affected.item_id = i.id
    where i.user_id = v_uid and i.active = true
    order by i.id
    for update of i
  loop
    v_locked_count := v_locked_count + 1;
  end loop;
  if v_locked_count <> v_give_count + v_receive_count then
    raise exception 'One or more trade items are invalid or inactive';
  end if;

  select i.name, x.quantity, i.stock
  into v_short_name, v_required, v_available
  from public.rar_items i
  join jsonb_to_recordset(p_give_items) as x(item_id uuid, quantity numeric)
    on x.item_id = i.id
  where i.user_id = v_uid and i.stock < x.quantity
  order by i.name
  limit 1;
  if found then
    raise exception 'Insufficient stock for %. Required: %. Available: %',
      v_short_name, v_required, v_available;
  end if;

  for v_line in
    select * from jsonb_to_recordset(p_give_items) as x(item_id uuid, quantity numeric)
    order by item_id
  loop
    update public.rar_items
    set stock = stock - v_line.quantity, updated_at = now()
    where id = v_line.item_id and user_id = v_uid and stock >= v_line.quantity
    returning stock into v_balance;
    if not found then raise exception 'Insufficient stock for a trade item'; end if;

    insert into public.rar_inventory_events (
      user_id, event_at, item_id, event_type, quantity_delta,
      notes, request_id, balance_after
    ) values (
      v_uid, coalesce(p_event_at, now()), v_line.item_id, 'trade', -v_line.quantity,
      p_notes, p_request_id, v_balance
    );
  end loop;

  for v_line in
    select * from jsonb_to_recordset(p_receive_items) as x(item_id uuid, quantity numeric)
    order by item_id
  loop
    update public.rar_items
    set stock = stock + v_line.quantity, updated_at = now()
    where id = v_line.item_id and user_id = v_uid
    returning stock into v_balance;

    insert into public.rar_inventory_events (
      user_id, event_at, item_id, event_type, quantity_delta,
      notes, request_id, balance_after
    ) values (
      v_uid, coalesce(p_event_at, now()), v_line.item_id, 'trade', v_line.quantity,
      p_notes, p_request_id, v_balance
    );
  end loop;

  return v_give_count + v_receive_count;
end
$function$;

revoke all on function public.rar_record_purchase_bundle(jsonb, numeric, text, timestamp with time zone, text, uuid) from public, anon;
revoke all on function public.rar_record_trade(timestamp with time zone, jsonb, jsonb, text, uuid) from public, anon;

grant execute on function public.rar_record_purchase_bundle(jsonb, numeric, text, timestamp with time zone, text, uuid) to authenticated;
grant execute on function public.rar_record_trade(timestamp with time zone, jsonb, jsonb, text, uuid) to authenticated;
