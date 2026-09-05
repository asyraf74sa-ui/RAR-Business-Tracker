-- Supabase projects may have default table grants for authenticated.
-- Make the report-delivery table's intended privileges explicit on existing deployments.

revoke all on public.discord_report_deliveries from public, anon, authenticated;
grant select, insert, update on public.discord_report_deliveries to authenticated;
