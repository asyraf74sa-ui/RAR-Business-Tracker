import assert from 'node:assert/strict'
import test from 'node:test'
import { routeDiscordMessage } from '../src/routing.js'

const config = {
  DISCORD_SALES_CHANNEL_ID: 'sales',
  DISCORD_ACQUISITION_CHANNEL_ID: 'rar-ops',
  DISCORD_MR_OPERATIONS_CHANNEL_ID: 'mr-ops',
}

test('shared Sales Record channel routes RAR and MR by prefix', () => {
  assert.deepEqual(routeDiscordMessage('sales', 'RAR - 1 ITEM\n1 US\n0 TAX\nPAYPAL', config), {
    kind: 'sale', game: 'RAR',
  })
  assert.deepEqual(routeDiscordMessage('sales', 'MR - 1 ITEM\n1 US\n0 TAX\nTNG', config), {
    kind: 'sale', game: 'MR',
  })
})

test('RAR and MR operations route only to their own channel', () => {
  assert.deepEqual(routeDiscordMessage('rar-ops', 'RAR ADD - 1 ITEM', config), {
    kind: 'operation', game: 'RAR', operation: 'manual_add',
  })
  assert.deepEqual(routeDiscordMessage('mr-ops', 'MR STOCK - 0 ITEM', config), {
    kind: 'operation', game: 'MR', operation: 'stock_reconcile',
  })
})

test('wrong-channel and cross-game operations are rejected', () => {
  assert.equal(routeDiscordMessage('sales', 'MR ADD - 1 ITEM', config), null)
  assert.equal(routeDiscordMessage('rar-ops', 'MR ADD - 1 ITEM', config), null)
  assert.equal(routeDiscordMessage('mr-ops', 'RAR ADD - 1 ITEM', config), null)
  assert.equal(routeDiscordMessage('mr-ops', 'MR FARM - 1 CYCLE', config), null)
  assert.equal(routeDiscordMessage('unrelated', 'MR - 1 ITEM\n1 US\n0 TAX\nTNG', config), null)
})
