-- Keep the exposed RPC wrappers as invokers. Their only permitted operation is
-- calling fully validated helpers in the non-exposed private schema.

alter function public.record_business_expense(timestamp with time zone, text, numeric, text, text, uuid, text, text, text)
  security invoker;
alter function public.update_business_expense(uuid, timestamp with time zone, text, numeric, text, text, text, text)
  security invoker;
alter function public.void_business_expense(uuid, text)
  security invoker;

grant usage on schema private to authenticated;
grant execute on function private.record_business_expense(timestamp with time zone, text, numeric, text, text, uuid, text, text, text)
  to authenticated;
grant execute on function private.update_business_expense(uuid, timestamp with time zone, text, numeric, text, text, text, text)
  to authenticated;
grant execute on function private.void_business_expense(uuid, text)
  to authenticated;

create policy "No client access to business expense audit"
  on private.business_expense_audit
  as restrictive
  for all
  to public
  using (false)
  with check (false);

drop index private.business_expense_audit_expense_changed_idx;
create index business_expense_audit_expense_user_changed_idx
  on private.business_expense_audit (expense_id, user_id, changed_at desc);
