import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const sql = readFileSync(
  new URL('../../supabase/migrations/20260902054745_discord_acquisition_operations.sql', import.meta.url),
  'utf8',
)
const manualAddSql = readFileSync(
  new URL('../../supabase/migrations/20260902064501_discord_manual_add.sql', import.meta.url),
  'utf8',
)
const hardenedTransactionsSql = readFileSync(
  new URL('../../supabase/migrations/20260901065358_harden_rar_transactions.sql', import.meta.url),
  'utf8',
)
const mrSql = readFileSync(
  new URL('../../supabase/migrations/20260904101125_mr_phase1_backend_bot.sql', import.meta.url),
  'utf8',
)

test('acquisition RPCs preserve authenticated invoker isolation', () => {
  assert.match(sql, /rar_record_purchase_bundle[\s\S]+?security invoker[\s\S]+?auth\.uid\(\)/i)
  assert.match(sql, /rar_record_trade[\s\S]+?security invoker[\s\S]+?auth\.uid\(\)/i)
  assert.match(sql, /revoke all on function public\.rar_record_purchase_bundle[\s\S]+?from public, anon/i)
  assert.match(sql, /revoke all on function public\.rar_record_trade[\s\S]+?from public, anon/i)
})

test('bundle purchase stores its total cash amount on exactly the first event line', () => {
  assert.match(sql, /row_number\(\) over \(order by x\.item_id\) as line_number/i)
  assert.match(sql, /case when v_line\.line_number = 1 then p_cash_amount else null end/i)
  assert.match(sql, /case when v_line\.line_number = 1 then v_currency else null end/i)
})

test('trade locks all rows, checks GIVE stock, then writes negative and positive audit events', () => {
  const tradeSql = sql.slice(sql.indexOf('create or replace function public.rar_record_trade'))
  const lockPosition = tradeSql.indexOf('for update of i')
  const stockCheckPosition = tradeSql.indexOf('where i.user_id = v_uid and i.stock < x.quantity')
  const firstMutationPosition = tradeSql.indexOf('set stock = stock - v_line.quantity')

  assert.ok(lockPosition >= 0)
  assert.ok(stockCheckPosition > lockPosition)
  assert.ok(firstMutationPosition > stockCheckPosition)
  assert.match(tradeSql, /'trade', -v_line\.quantity/i)
  assert.match(tradeSql, /'trade', v_line\.quantity/i)
})

test('manual ADD validates, locks, and increments all active user items atomically', () => {
  const lockPosition = manualAddSql.indexOf('for update of i')
  const mutationPosition = manualAddSql.indexOf('set stock = stock + v_line.quantity')

  assert.match(manualAddSql, /rar_add_stock_bundle[\s\S]+?security invoker[\s\S]+?auth\.uid\(\)/i)
  assert.match(manualAddSql, /where i\.user_id = v_uid and i\.active = true/i)
  assert.ok(lockPosition >= 0)
  assert.ok(mutationPosition > lockPosition)
  assert.match(manualAddSql, /'manual_add', v_line\.quantity/i)
  assert.doesNotMatch(manualAddSql, /cash_amount|cash_currency/i)
})

test('manual ADD duplicate request IDs return without applying another increment', () => {
  assert.match(manualAddSql, /pg_advisory_xact_lock/i)
  assert.match(manualAddSql, /event_type = 'manual_add'[\s\S]+?return -v_existing_count/i)
  assert.match(manualAddSql, /revoke all on function public\.rar_add_stock_bundle[\s\S]+?from public, anon/i)
  assert.match(manualAddSql, /grant execute on function public\.rar_add_stock_bundle[\s\S]+?to authenticated/i)
})

test('existing stocktake bundle RPC is atomic and duplicate-safe', () => {
  const start = hardenedTransactionsSql.indexOf('create or replace function public.rar_reconcile_stock_batch')
  const end = hardenedTransactionsSql.indexOf('create or replace function public.rar_update_farm_settings', start)
  const stockSql = hardenedTransactionsSql.slice(start, end)
  const lockPosition = stockSql.indexOf('for update of i')
  const deltaPosition = stockSql.indexOf('v_delta := v_line.counted_stock - v_old')
  const mutationPosition = stockSql.indexOf('set stock = v_line.counted_stock')

  assert.match(stockSql, /x\.counted_stock >= 0/i)
  assert.match(stockSql, /pg_advisory_xact_lock/i)
  assert.match(stockSql, /event_type = 'stock_adjustment'[\s\S]+?return -v_existing_count/i)
  assert.ok(lockPosition >= 0)
  assert.ok(deltaPosition > lockPosition)
  assert.ok(mutationPosition > deltaPosition)
})

test('MR migration creates only isolated user-owned tables with RLS and authenticated policies', () => {
  for (const table of ['mr_set_families', 'mr_sales', 'mr_sale_items', 'mr_inventory_events', 'mr_item_prices']) {
    assert.match(mrSql, new RegExp(`create table if not exists public\\.${table}`, 'i'))
    assert.match(mrSql, new RegExp(`alter table public\\.${table} enable row level security`, 'i'))
  }
  assert.match(mrSql, /using \(\(select auth\.uid\(\)\) = user_id\)/i)
  assert.match(mrSql, /with check \(\(select auth\.uid\(\)\) = user_id\)/i)
  assert.match(mrSql, /revoke all on public\.mr_set_families[\s\S]+?from anon/i)
  assert.doesNotMatch(mrSql, /disable row level security/i)
})

test('all MR mutation RPCs are security-invoker, authenticated, locked, and idempotent', () => {
  for (const name of [
    'mr_record_sale',
    'mr_add_stock_bundle',
    'mr_reconcile_stock_batch',
    'mr_record_purchase_bundle',
    'mr_record_trade',
  ]) {
    const start = mrSql.indexOf(`create or replace function public.${name}`)
    assert.ok(start >= 0, `${name} is present`)
    const bodyEnd = mrSql.indexOf('$function$;', start)
    const body = mrSql.slice(start, bodyEnd)
    assert.match(body, /security invoker/i)
    assert.match(body, /auth\.uid\(\)/i)
    assert.match(body, /pg_advisory_xact_lock/i)
    assert.match(body, /request_id/i)
    assert.doesNotMatch(body, /public\.rar_(?:items|sales|sale_items|inventory_events)/i)
    assert.match(mrSql, new RegExp(`grant execute on function public\\.${name}`, 'i'))
  }
})

test('MR catalog loader accepts user-confirmed metadata without seeding production rows', () => {
  const start = mrSql.indexOf('create or replace function public.mr_upsert_catalog_item')
  const body = mrSql.slice(start, mrSql.indexOf('$function$;', start))
  assert.ok(start >= 0)
  assert.match(body, /security invoker/i)
  assert.match(body, /auth\.uid\(\)/i)
  assert.match(body, /p_category text default 'General'/i)
  assert.match(body, /p_aliases text\[\]/i)
  assert.match(mrSql, /grant execute on function public\.mr_upsert_catalog_item/i)
})

test('MR set expansion and summary use generic one-table/four-chair metadata', () => {
  assert.match(mrSql, /chairs_per_set integer not null default 4/i)
  assert.match(mrSql, /select f\.table_item_id, raw\.quantity/i)
  assert.match(mrSql, /select f\.chair_item_id, raw\.quantity \* f\.chairs_per_set/i)
  assert.match(mrSql, /least\(table_item\.current_quantity, floor\(chair_item\.current_quantity \/ family\.chairs_per_set\)\)/i)
  assert.match(mrSql, /as completed_sets/i)
  assert.match(mrSql, /as excess_tables/i)
  assert.match(mrSql, /as excess_chairs/i)
})

test('MR purchase counts bundle spending once and stock reconciliation permits zero', () => {
  assert.match(mrSql, /case when v_first then p_cash_amount else null end/i)
  assert.match(mrSql, /case when v_first then v_currency else null end/i)
  assert.match(mrSql, /mr_reconcile_stock_batch[\s\S]+?mr_expand_inventory_lines\(p_counts, true\)/i)
})

test('PayPal and TNG normalize to canonical shared platforms without an invented fee', () => {
  assert.match(mrSql, /when 'paypal' then 'PayPal'/i)
  assert.match(mrSql, /when 'touchngoewallet' then 'TNG'/i)
  assert.match(mrSql, /cross join \(values \('PayPal'::text\), \('TNG'::text\)\)/i)
  assert.match(mrSql, /platform\.name, null, true/i)
  assert.match(mrSql, /rar_platforms_user_canonical_name_unique/i)
  assert.match(mrSql, /rar_record_sale[\s\S]+?tracker_normalize_platform\(p_platform\)/i)
})

test('MR migration does not seed or invent any MR catalog item or set family', () => {
  const beforeUserInvokedLoader = mrSql.slice(0, mrSql.indexOf('create or replace function public.mr_upsert_catalog_item'))
  assert.doesNotMatch(beforeUserInvokedLoader, /insert into public\.mr_items/i)
  assert.doesNotMatch(mrSql, /insert into public\.mr_set_families/i)
})
