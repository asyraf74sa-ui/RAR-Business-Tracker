-- Add the authenticated, atomic manual-add operation required by the Discord bot.
-- The existing manual_add event type, stocktake RPC, inventory data, and RLS policies are preserved.

create or replace function public.rar_add_stock_bundle(
  p_event_at timestamp with time zone,
  p_items jsonb,
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
  v_line_count integer;
  v_distinct_count integer;
  v_locked_count integer := 0;
  v_existing_count integer;
  v_valid boolean;
  v_balance numeric;
  v_line record;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Manual-add items must be a JSON array';
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
    raise exception 'Manual-add items are empty, invalid, or contain duplicate items';
  end if;

  if p_request_id is not null then
    perform pg_advisory_xact_lock(hashtextextended(v_uid::text || ':inventory:' || p_request_id::text, 0));
    if exists (
      select 1 from public.rar_inventory_events
      where user_id = v_uid and request_id = p_request_id and event_type <> 'manual_add'
    ) then
      raise exception 'Request ID was already used for another operation';
    end if;

    select count(*)::integer into v_existing_count
    from public.rar_inventory_events
    where user_id = v_uid and request_id = p_request_id and event_type = 'manual_add';

    if v_existing_count > 0 then
      if v_existing_count <> v_line_count or exists (
        select 1
        from jsonb_to_recordset(p_items) as x(item_id uuid, quantity numeric)
        left join public.rar_inventory_events e
          on e.user_id = v_uid
          and e.request_id = p_request_id
          and e.event_type = 'manual_add'
          and e.item_id = x.item_id
        where e.item_id is null or e.quantity_delta is distinct from x.quantity
      ) then
        raise exception 'Request ID was reused with different manual-add details';
      end if;
      return -v_existing_count;
    end if;
  end if;

  for v_line in
    select i.id
    from public.rar_items i
    join jsonb_to_recordset(p_items) as x(item_id uuid, quantity numeric)
      on x.item_id = i.id
    where i.user_id = v_uid and i.active = true
    order by i.id
    for update of i
  loop
    v_locked_count := v_locked_count + 1;
  end loop;
  if v_locked_count <> v_line_count then
    raise exception 'One or more manual-add items are invalid or inactive';
  end if;

  for v_line in
    select *
    from jsonb_to_recordset(p_items) as x(item_id uuid, quantity numeric)
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
      v_uid, coalesce(p_event_at, now()), v_line.item_id, 'manual_add', v_line.quantity,
      p_notes, p_request_id, v_balance
    );
  end loop;

  return v_line_count;
end
$function$;

revoke all on function public.rar_add_stock_bundle(timestamp with time zone, jsonb, text, uuid)
  from public, anon;
grant execute on function public.rar_add_stock_bundle(timestamp with time zone, jsonb, text, uuid)
  to authenticated;
