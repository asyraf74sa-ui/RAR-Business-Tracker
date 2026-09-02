import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const sql = readFileSync(
  new URL('../../supabase/migrations/20260902054745_discord_acquisition_operations.sql', import.meta.url),
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
