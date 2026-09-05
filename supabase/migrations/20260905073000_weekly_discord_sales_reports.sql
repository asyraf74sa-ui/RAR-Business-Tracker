-- Durable, per-user delivery state for the local Discord bot's weekly sales overview.
-- This table stores report metadata only; no sales or inventory rows are modified.

create table if not exists public.discord_report_deliveries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  report_type text not null,
  period_start timestamp with time zone not null,
  period_end timestamp with time zone not null,
  status text not null,
  claim_token uuid not null,
  lease_expires_at timestamp with time zone not null,
  discord_channel_id text not null,
  discord_message_id text,
  sent_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint discord_report_deliveries_type_valid check (report_type = 'weekly_sales'),
  constraint discord_report_deliveries_period_valid check (
    period_end = period_start + interval '7 days'
  ),
  constraint discord_report_deliveries_status_valid check (status in ('pending', 'sent')),
  constraint discord_report_deliveries_channel_valid check (discord_channel_id ~ '^[0-9]{17,20}$'),
  constraint discord_report_deliveries_message_valid check (
    discord_message_id is null or discord_message_id ~ '^[0-9]{17,20}$'
  ),
  constraint discord_report_deliveries_state_valid check (
    (status = 'pending' and discord_message_id is null and sent_at is null)
    or (status = 'sent' and discord_message_id is not null and sent_at is not null)
  ),
  constraint discord_report_deliveries_period_unique unique (
    user_id, report_type, period_start, period_end
  )
);

create index if not exists discord_report_deliveries_user_period_idx
  on public.discord_report_deliveries (user_id, report_type, period_end desc);

alter table public.discord_report_deliveries enable row level security;

drop policy if exists "Users view their Discord report deliveries" on public.discord_report_deliveries;
create policy "Users view their Discord report deliveries"
  on public.discord_report_deliveries for select to authenticated
  using ((select auth.uid()) is not null and (select auth.uid()) = user_id);

drop policy if exists "Users insert their Discord report deliveries" on public.discord_report_deliveries;
create policy "Users insert their Discord report deliveries"
  on public.discord_report_deliveries for insert to authenticated
  with check ((select auth.uid()) is not null and (select auth.uid()) = user_id);

drop policy if exists "Users update their Discord report deliveries" on public.discord_report_deliveries;
create policy "Users update their Discord report deliveries"
  on public.discord_report_deliveries for update to authenticated
  using ((select auth.uid()) is not null and (select auth.uid()) = user_id)
  with check ((select auth.uid()) is not null and (select auth.uid()) = user_id);

revoke all on public.discord_report_deliveries from public, anon, authenticated;
grant select, insert, update on public.discord_report_deliveries to authenticated;

create or replace function public.claim_discord_report_delivery(
  p_report_type text,
  p_period_start timestamp with time zone,
  p_period_end timestamp with time zone,
  p_discord_channel_id text,
  p_claim_token uuid,
  p_lease_seconds integer default 300
)
returns table (
  claimed boolean,
  delivery_status text,
  discord_message_id text
)
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_status text;
  v_existing_token uuid;
  v_lease_expires_at timestamp with time zone;
  v_channel_id text;
  v_message_id text;
begin
  if v_uid is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_report_type <> 'weekly_sales' then
    raise exception 'Unsupported Discord report type';
  end if;
  if p_period_start is null or p_period_end <> p_period_start + interval '7 days' then
    raise exception 'Weekly report period must be exactly seven days';
  end if;
  if p_discord_channel_id is null or p_discord_channel_id !~ '^[0-9]{17,20}$' then
    raise exception 'Discord channel ID is invalid';
  end if;
  if p_claim_token is null then
    raise exception 'Claim token is required';
  end if;
  if p_lease_seconds not between 30 and 3600 then
    raise exception 'Claim lease must be between 30 and 3600 seconds';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    v_uid::text || ':' || p_report_type || ':' || p_period_start::text || ':' || p_period_end::text,
    0
  ));

  insert into public.discord_report_deliveries (
    user_id,
    report_type,
    period_start,
    period_end,
    status,
    claim_token,
    lease_expires_at,
    discord_channel_id
  ) values (
    v_uid,
    p_report_type,
    p_period_start,
    p_period_end,
    'pending',
    p_claim_token,
    now() + make_interval(secs => p_lease_seconds),
    p_discord_channel_id
  ) on conflict on constraint discord_report_deliveries_period_unique do nothing;

  select delivery.status,
         delivery.claim_token,
         delivery.lease_expires_at,
         delivery.discord_channel_id,
         delivery.discord_message_id
    into v_status, v_existing_token, v_lease_expires_at, v_channel_id, v_message_id
  from public.discord_report_deliveries delivery
  where delivery.user_id = v_uid
    and delivery.report_type = p_report_type
    and delivery.period_start = p_period_start
    and delivery.period_end = p_period_end
  for update;

  if not found then
    raise exception 'Discord report delivery could not be claimed';
  end if;
  if v_channel_id <> p_discord_channel_id then
    raise exception 'Discord report period is already assigned to another channel';
  end if;
  if v_status = 'sent' then
    return query select false, v_status, v_message_id;
    return;
  end if;

  if v_existing_token = p_claim_token or v_lease_expires_at <= now() then
    update public.discord_report_deliveries delivery
    set claim_token = p_claim_token,
        lease_expires_at = now() + make_interval(secs => p_lease_seconds),
        updated_at = now()
    where delivery.user_id = v_uid
      and delivery.report_type = p_report_type
      and delivery.period_start = p_period_start
      and delivery.period_end = p_period_end;
    return query select true, 'pending'::text, null::text;
    return;
  end if;

  return query select false, 'pending'::text, null::text;
end
$function$;

revoke all on function public.claim_discord_report_delivery(
  text, timestamp with time zone, timestamp with time zone, text, uuid, integer
) from public, anon;
grant execute on function public.claim_discord_report_delivery(
  text, timestamp with time zone, timestamp with time zone, text, uuid, integer
) to authenticated;

create or replace function public.mark_discord_report_delivery_sent(
  p_report_type text,
  p_period_start timestamp with time zone,
  p_period_end timestamp with time zone,
  p_claim_token uuid,
  p_discord_message_id text
)
returns table (
  marked boolean,
  delivery_status text,
  discord_message_id text
)
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_status text;
  v_existing_token uuid;
  v_existing_message_id text;
begin
  if v_uid is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_report_type <> 'weekly_sales' then
    raise exception 'Unsupported Discord report type';
  end if;
  if p_period_start is null or p_period_end <> p_period_start + interval '7 days' then
    raise exception 'Weekly report period must be exactly seven days';
  end if;
  if p_claim_token is null then
    raise exception 'Claim token is required';
  end if;
  if p_discord_message_id is null or p_discord_message_id !~ '^[0-9]{17,20}$' then
    raise exception 'Discord message ID is invalid';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    v_uid::text || ':' || p_report_type || ':' || p_period_start::text || ':' || p_period_end::text,
    0
  ));

  select delivery.status, delivery.claim_token, delivery.discord_message_id
    into v_status, v_existing_token, v_existing_message_id
  from public.discord_report_deliveries delivery
  where delivery.user_id = v_uid
    and delivery.report_type = p_report_type
    and delivery.period_start = p_period_start
    and delivery.period_end = p_period_end
  for update;

  if not found then
    raise exception 'Discord report delivery was not found';
  end if;
  if v_status = 'sent' then
    return query select false, v_status, v_existing_message_id;
    return;
  end if;
  if v_existing_token <> p_claim_token then
    raise exception 'Discord report claim is no longer active' using errcode = '40001';
  end if;

  update public.discord_report_deliveries delivery
  set status = 'sent',
      discord_message_id = p_discord_message_id,
      sent_at = now(),
      lease_expires_at = now(),
      updated_at = now()
  where delivery.user_id = v_uid
    and delivery.report_type = p_report_type
    and delivery.period_start = p_period_start
    and delivery.period_end = p_period_end;

  return query select true, 'sent'::text, p_discord_message_id;
end
$function$;

revoke all on function public.mark_discord_report_delivery_sent(
  text, timestamp with time zone, timestamp with time zone, uuid, text
) from public, anon;
grant execute on function public.mark_discord_report_delivery_sent(
  text, timestamp with time zone, timestamp with time zone, uuid, text
) to authenticated;
