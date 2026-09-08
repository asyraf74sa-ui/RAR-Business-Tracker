-- Authoritative operating-expense ledger for RAR, MR, and shared business costs.
-- This migration is additive and does not read from or mutate inventory or sales.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated, service_role;

create table public.business_expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  incurred_at timestamp with time zone not null default now(),
  workspace text not null check (workspace in ('RAR', 'MR', 'SHARED')),
  amount numeric not null check (
    amount::text not in ('NaN', 'Infinity', '-Infinity')
    and amount > 0
    and amount <= 1000000000000000
  ),
  currency text not null check (currency in ('USD', 'MYR', 'PHP', 'IDR')),
  description text not null check (char_length(btrim(description)) between 1 and 500),
  category text not null default 'Other' check (char_length(btrim(category)) between 1 and 80),
  notes text check (notes is null or char_length(notes) <= 2000),
  source text not null default 'manual' check (source in ('website', 'discord', 'manual')),
  request_id uuid not null,
  voided_at timestamp with time zone,
  void_reason text check (void_reason is null or char_length(btrim(void_reason)) between 1 and 500),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint business_expenses_void_state_valid check (
    (voided_at is null and void_reason is null)
    or (voided_at is not null and void_reason is not null)
  ),
  unique (id, user_id),
  unique (user_id, request_id)
);

create index business_expenses_user_incurred_at_idx
  on public.business_expenses (user_id, incurred_at desc);
create index business_expenses_active_workspace_date_idx
  on public.business_expenses (user_id, workspace, incurred_at desc)
  where voided_at is null;

create table private.business_expense_audit (
  id bigint generated always as identity primary key,
  expense_id uuid not null,
  user_id uuid not null,
  action text not null check (action in ('created', 'updated', 'voided')),
  old_record jsonb,
  new_record jsonb not null,
  changed_by uuid,
  changed_at timestamp with time zone not null default now(),
  constraint business_expense_audit_expense_user_fkey
    foreign key (expense_id, user_id)
    references public.business_expenses(id, user_id)
    on delete restrict
);

create index business_expense_audit_expense_changed_idx
  on private.business_expense_audit (expense_id, changed_at desc);
create index business_expense_audit_user_changed_idx
  on private.business_expense_audit (user_id, changed_at desc);

alter table public.business_expenses enable row level security;
alter table private.business_expense_audit enable row level security;

create policy "Users view their own business expenses"
  on public.business_expenses
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create or replace function private.guard_business_expense_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if new.id is distinct from old.id
    or new.user_id is distinct from old.user_id
    or new.request_id is distinct from old.request_id
    or new.source is distinct from old.source
    or new.created_at is distinct from old.created_at then
    raise exception 'Immutable expense identity fields cannot be changed';
  end if;

  if old.voided_at is not null then
    raise exception 'Voided expenses cannot be changed';
  end if;

  if old.voided_at is null and new.voided_at is not null and new.void_reason is null then
    raise exception 'A void reason is required';
  end if;

  if old.voided_at is null and new.voided_at is null and new.void_reason is not null then
    raise exception 'A void reason is valid only when voiding an expense';
  end if;

  new.updated_at := now();
  return new;
end
$function$;

create trigger business_expenses_guard_update
before update on public.business_expenses
for each row execute function private.guard_business_expense_update();

create or replace function private.audit_business_expense_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  insert into private.business_expense_audit (
    expense_id,
    user_id,
    action,
    old_record,
    new_record,
    changed_by
  ) values (
    new.id,
    new.user_id,
    case
      when tg_op = 'INSERT' then 'created'
      when old.voided_at is null and new.voided_at is not null then 'voided'
      else 'updated'
    end,
    case when tg_op = 'INSERT' then null else to_jsonb(old) end,
    to_jsonb(new),
    auth.uid()
  );
  return new;
end
$function$;

create trigger business_expenses_audit_change
after insert or update on public.business_expenses
for each row execute function private.audit_business_expense_change();

create or replace function private.record_business_expense(
  p_incurred_at timestamp with time zone,
  p_workspace text,
  p_amount numeric,
  p_currency text,
  p_description text,
  p_request_id uuid,
  p_category text default 'Other',
  p_notes text default null,
  p_source text default 'manual'
)
returns table(expense_id uuid, duplicate boolean)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_workspace text := upper(btrim(coalesce(p_workspace, '')));
  v_currency text := upper(btrim(coalesce(p_currency, '')));
  v_description text := btrim(coalesce(p_description, ''));
  v_category text := coalesce(nullif(btrim(coalesce(p_category, '')), ''), 'Other');
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
  v_source text := lower(btrim(coalesce(p_source, 'manual')));
  v_existing public.business_expenses%rowtype;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if p_request_id is null then raise exception 'Request ID is required'; end if;
  if p_incurred_at is null or p_incurred_at > now() + interval '5 minutes' then
    raise exception 'Expense date is invalid or in the future';
  end if;
  if v_workspace not in ('RAR', 'MR', 'SHARED') then raise exception 'Unsupported expense workspace'; end if;
  if p_amount is null or p_amount::text in ('NaN', 'Infinity', '-Infinity') or p_amount <= 0 or p_amount > 1000000000000000 then
    raise exception 'Expense amount must be greater than zero';
  end if;
  if v_currency not in ('USD', 'MYR', 'PHP', 'IDR') then raise exception 'Unsupported expense currency'; end if;
  if char_length(v_description) not between 1 and 500 then raise exception 'Expense description is required and must be at most 500 characters'; end if;
  if char_length(v_category) not between 1 and 80 then raise exception 'Expense category must be at most 80 characters'; end if;
  if v_notes is not null and char_length(v_notes) > 2000 then raise exception 'Expense notes must be at most 2000 characters'; end if;
  if v_source not in ('website', 'discord', 'manual') then raise exception 'Unsupported expense source'; end if;

  perform pg_advisory_xact_lock(hashtextextended(v_uid::text || ':business-expense:' || p_request_id::text, 0));

  select * into v_existing
  from public.business_expenses
  where user_id = v_uid and request_id = p_request_id;

  if found then
    if v_existing.incurred_at is distinct from p_incurred_at
      or v_existing.workspace is distinct from v_workspace
      or v_existing.amount is distinct from p_amount
      or v_existing.currency is distinct from v_currency
      or v_existing.description is distinct from v_description
      or v_existing.category is distinct from v_category
      or v_existing.notes is distinct from v_notes
      or v_existing.source is distinct from v_source then
      raise exception 'Request ID was already used for a different expense';
    end if;
    return query select v_existing.id, true;
    return;
  end if;

  insert into public.business_expenses (
    user_id,
    incurred_at,
    workspace,
    amount,
    currency,
    description,
    category,
    notes,
    source,
    request_id
  ) values (
    v_uid,
    p_incurred_at,
    v_workspace,
    p_amount,
    v_currency,
    v_description,
    v_category,
    v_notes,
    v_source,
    p_request_id
  ) returning id into expense_id;

  duplicate := false;
  return next;
end
$function$;

create or replace function private.update_business_expense(
  p_expense_id uuid,
  p_incurred_at timestamp with time zone,
  p_workspace text,
  p_amount numeric,
  p_currency text,
  p_description text,
  p_category text default 'Other',
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_workspace text := upper(btrim(coalesce(p_workspace, '')));
  v_currency text := upper(btrim(coalesce(p_currency, '')));
  v_description text := btrim(coalesce(p_description, ''));
  v_category text := coalesce(nullif(btrim(coalesce(p_category, '')), ''), 'Other');
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
  v_id uuid;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if p_expense_id is null then raise exception 'Expense ID is required'; end if;
  if p_incurred_at is null or p_incurred_at > now() + interval '5 minutes' then raise exception 'Expense date is invalid or in the future'; end if;
  if v_workspace not in ('RAR', 'MR', 'SHARED') then raise exception 'Unsupported expense workspace'; end if;
  if p_amount is null or p_amount::text in ('NaN', 'Infinity', '-Infinity') or p_amount <= 0 or p_amount > 1000000000000000 then raise exception 'Expense amount must be greater than zero'; end if;
  if v_currency not in ('USD', 'MYR', 'PHP', 'IDR') then raise exception 'Unsupported expense currency'; end if;
  if char_length(v_description) not between 1 and 500 then raise exception 'Expense description is required and must be at most 500 characters'; end if;
  if char_length(v_category) not between 1 and 80 then raise exception 'Expense category must be at most 80 characters'; end if;
  if v_notes is not null and char_length(v_notes) > 2000 then raise exception 'Expense notes must be at most 2000 characters'; end if;

  update public.business_expenses
  set incurred_at = p_incurred_at,
      workspace = v_workspace,
      amount = p_amount,
      currency = v_currency,
      description = v_description,
      category = v_category,
      notes = v_notes
  where id = p_expense_id and user_id = v_uid and voided_at is null
  returning id into v_id;

  if v_id is null then raise exception 'Active expense not found'; end if;
  return v_id;
end
$function$;

create or replace function private.void_business_expense(
  p_expense_id uuid,
  p_void_reason text default 'Voided by user'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_reason text := coalesce(nullif(btrim(coalesce(p_void_reason, '')), ''), 'Voided by user');
  v_id uuid;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if p_expense_id is null then raise exception 'Expense ID is required'; end if;
  if char_length(v_reason) > 500 then raise exception 'Void reason must be at most 500 characters'; end if;

  select id into v_id
  from public.business_expenses
  where id = p_expense_id and user_id = v_uid;
  if v_id is null then raise exception 'Expense not found'; end if;

  update public.business_expenses
  set voided_at = now(), void_reason = v_reason
  where id = p_expense_id and user_id = v_uid and voided_at is null;
  return v_id;
end
$function$;

create or replace function public.record_business_expense(
  p_incurred_at timestamp with time zone,
  p_workspace text,
  p_amount numeric,
  p_currency text,
  p_description text,
  p_request_id uuid,
  p_category text default 'Other',
  p_notes text default null,
  p_source text default 'manual'
)
returns table(expense_id uuid, duplicate boolean)
language sql
security definer
set search_path = ''
as $function$
  select * from private.record_business_expense(
    p_incurred_at,
    p_workspace,
    p_amount,
    p_currency,
    p_description,
    p_request_id,
    p_category,
    p_notes,
    p_source
  )
$function$;

create or replace function public.update_business_expense(
  p_expense_id uuid,
  p_incurred_at timestamp with time zone,
  p_workspace text,
  p_amount numeric,
  p_currency text,
  p_description text,
  p_category text default 'Other',
  p_notes text default null
)
returns uuid
language sql
security definer
set search_path = ''
as $function$
  select private.update_business_expense(
    p_expense_id,
    p_incurred_at,
    p_workspace,
    p_amount,
    p_currency,
    p_description,
    p_category,
    p_notes
  )
$function$;

create or replace function public.void_business_expense(
  p_expense_id uuid,
  p_void_reason text default 'Voided by user'
)
returns uuid
language sql
security definer
set search_path = ''
as $function$
  select private.void_business_expense(p_expense_id, p_void_reason)
$function$;

revoke all on table public.business_expenses from public, anon, authenticated;
grant select on table public.business_expenses to authenticated;

revoke all on table private.business_expense_audit from public, anon, authenticated, service_role;
revoke all on sequence private.business_expense_audit_id_seq from public, anon, authenticated, service_role;
revoke all on function private.guard_business_expense_update() from public, anon, authenticated, service_role;
revoke all on function private.audit_business_expense_change() from public, anon, authenticated, service_role;
revoke all on function private.record_business_expense(timestamp with time zone, text, numeric, text, text, uuid, text, text, text)
  from public, anon, authenticated, service_role;
revoke all on function private.update_business_expense(uuid, timestamp with time zone, text, numeric, text, text, text, text)
  from public, anon, authenticated, service_role;
revoke all on function private.void_business_expense(uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.record_business_expense(timestamp with time zone, text, numeric, text, text, uuid, text, text, text)
  from public, anon, service_role;
revoke all on function public.update_business_expense(uuid, timestamp with time zone, text, numeric, text, text, text, text)
  from public, anon, service_role;
revoke all on function public.void_business_expense(uuid, text)
  from public, anon, service_role;
grant execute on function public.record_business_expense(timestamp with time zone, text, numeric, text, text, uuid, text, text, text)
  to authenticated;
grant execute on function public.update_business_expense(uuid, timestamp with time zone, text, numeric, text, text, text, text)
  to authenticated;
grant execute on function public.void_business_expense(uuid, text)
  to authenticated;

notify pgrst, 'reload schema';
