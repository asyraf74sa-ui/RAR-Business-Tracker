-- Keep all MR inventory mutations on whole, JavaScript-safe quantities and allow
-- the 75-row active catalog to be reconciled in one atomic transaction.
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
    or jsonb_array_length(p_payload) not between 1 and 100 then
    raise exception 'Inventory payload must contain between 1 and 100 lines';
  end if;

  select count(*)::integer, coalesce(bool_and(
    ((x.item_id is not null)::integer + (x.set_family_id is not null)::integer) = 1
    and ((x.quantity is not null)::integer + (x.counted_stock is not null)::integer) = 1
    and coalesce(x.quantity, x.counted_stock)::text not in ('NaN', 'Infinity', '-Infinity')
    and coalesce(x.quantity, x.counted_stock) = trunc(coalesce(x.quantity, x.counted_stock))
    and coalesce(x.quantity, x.counted_stock) <= 9007199254740991
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

  if exists (
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
    select 1 from expanded
    group by expanded.item_id
    having sum(expanded.quantity) > 9007199254740991
  ) then
    raise exception 'Expanded inventory quantity exceeds the safe integer limit';
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
