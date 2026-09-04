import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const migration = readFileSync(new URL('../supabase/migrations/20260904153645_phase2_catalog_management.sql', import.meta.url), 'utf8')
const rarSettings = readFileSync(new URL('../src/pages/Settings.jsx', import.meta.url), 'utf8')
const mrSettings = readFileSync(new URL('../src/pages/MRSettings.jsx', import.meta.url), 'utf8')
const shell = readFileSync(new URL('../src/components/Shell.jsx', import.meta.url), 'utf8')
const ui = readFileSync(new URL('../src/components/ui.jsx', import.meta.url), 'utf8')
const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')

test('catalog migration is additive and exposes authenticated security-invoker RPCs only', () => {
  assert.match(migration, /add column if not exists category/i)
  assert.match(migration, /add column if not exists aliases/i)
  for (const name of ['rar_upsert_catalog_item', 'mr_save_catalog_item', 'mr_upsert_catalog_item', 'mr_upsert_set_family']) {
    assert.match(migration, new RegExp(`function public\\.${name}[\\s\\S]+?security invoker`, 'i'))
    assert.match(migration, new RegExp(`revoke all on function public\\.${name}[\\s\\S]+?from public, anon`, 'i'))
    assert.match(migration, new RegExp(`grant execute on function public\\.${name}[\\s\\S]+?to authenticated`, 'i'))
  }
  assert.doesNotMatch(migration, /security definer/i)
  assert.doesNotMatch(migration, /service_role/i)
})

test('catalog mutation functions never assign RAR or MR stock and preserve item IDs', () => {
  const functionArea = migration.slice(migration.indexOf('create or replace function public.rar_upsert_catalog_item'))
  assert.doesNotMatch(functionArea, /set\s+stock\s*=/i)
  assert.doesNotMatch(functionArea, /set\s+current_quantity\s*=/i)
  assert.doesNotMatch(functionArea, /delete\s+from\s+public\.(?:rar|mr)_/i)
  assert.doesNotMatch(functionArea, /set\s+id\s*=/i)
  assert.match(functionArea, /stock, gem_value_min[\s\S]+?'item', 0,/i)
  assert.match(functionArea, /low_stock_threshold, current_quantity, is_archived[\s\S]+?p_low_stock_threshold, 0,/i)
})

test('duplicate catalog identities and invalid furniture mappings are rejected', () => {
  assert.match(migration, /An RAR item name or alias already exists/)
  assert.match(migration, /An MR item name or alias already exists/)
  assert.match(migration, /An MR item or set-family name or alias already exists/)
  assert.match(migration, /return public\.mr_save_catalog_item/)
  assert.match(migration, /Set components must be the matching family Table and Chair/)
  assert.match(migration, /MR furniture sets require exactly four chairs/)
})

test('RAR and MR Catalog Managers use safe RPCs rather than direct catalog writes', () => {
  assert.match(rarSettings, /rpc\('rar_upsert_catalog_item'/)
  assert.doesNotMatch(rarSettings, /from\('rar_items'\)\.(?:insert|update|delete)/)
  assert.match(mrSettings, /rpc\('mr_save_catalog_item'/)
  assert.match(mrSettings, /rpc\('mr_upsert_set_family'/)
  assert.doesNotMatch(mrSettings, /from\('mr_items'\)\.(?:insert|update|delete)/)
})

test('Basketball Tip Jar metadata is preserved without a stock assignment', () => {
  const block = migration.slice(migration.indexOf("update public.rar_items\nset category = 'Appliances'"), migration.indexOf('create or replace function public.rar_upsert_catalog_item'))
  assert.match(block, /Basketball Tip Jar/)
  assert.match(block, /gem_value_min = 2700/)
  assert.match(block, /gem_value_max = 3000/)
  assert.doesNotMatch(block, /stock\s*=/)
})

test('responsive workspace navigation covers mobile widths without horizontal overflow', () => {
  assert.match(styles, /body \{ overflow-x: hidden; \}/)
  assert.match(styles, /@media \(max-width: 900px\)[\s\S]+?\.mobile-workspace-bar/)
  assert.match(styles, /@media \(max-width: 480px\)[\s\S]+?\.workspace-switcher button/)
  assert.match(styles, /repeat\(auto-fit,minmax\(54px,1fr\)\)/)
  assert.match(shell, /const switchWorkspace[\s\S]+?scrollToTop\(\)/)
  assert.match(ui, /createPortal\([\s\S]+?document\.body/)
})
