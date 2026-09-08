import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const readProjectFile = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

test('website loads the authoritative expense table and exposes Expenses in all three workspaces', async () => {
  const [app, workspaces] = await Promise.all([
    readProjectFile('src/App.jsx'),
    readProjectFile('src/lib/business-workspaces.js'),
  ])
  assert.match(app, /from\('business_expenses'\)\.select\('\*'\)/)
  assert.match(app, /<Expenses [^>]*scope="rar"/)
  assert.match(app, /<Expenses [^>]*scope="mr"/)
  assert.match(app, /<Expenses [^>]*scope="all"/)
  assert.equal((workspaces.match(/id: 'expenses'/g) || []).length, 3)
})

test('website creates, edits, and soft-voids expenses only through authoritative RPCs', async () => {
  const page = await readProjectFile('src/pages/Expenses.jsx')
  assert.match(page, /supabase\.rpc\('record_business_expense'/)
  assert.match(page, /p_source: 'website'/)
  assert.match(page, /supabase\.rpc\('update_business_expense'/)
  assert.match(page, /supabase\.rpc\('void_business_expense'/)
  assert.doesNotMatch(page, /from\('business_expenses'\)\.(?:insert|update|delete)/)
  assert.match(page, /Historical audit details were preserved/)
})

test('website treats descriptions and categories as free text and preserves original currencies', async () => {
  const page = await readProjectFile('src/pages/Expenses.jsx')
  assert.match(page, /description.*maxLength="500"/s)
  assert.match(page, /category.*maxLength="80"/s)
  assert.match(page, /CURRENCIES\.map/)
  assert.match(page, /Original currency is preserved as the authoritative amount/)
  assert.doesNotMatch(page, /rar_items|mr_items|resolve.*item/i)
})
