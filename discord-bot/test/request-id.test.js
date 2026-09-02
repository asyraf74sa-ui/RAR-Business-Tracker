import assert from 'node:assert/strict'
import test from 'node:test'
import { discordRequestId } from '../src/request-id.js'

test('the same Discord message always produces the same request UUID', () => {
  const message = { guildId: '123', channelId: '456', messageId: '789' }
  const first = discordRequestId(message)
  const second = discordRequestId(message)

  assert.equal(first, second)
  assert.equal(first, '3070c599-4609-52a2-a277-6dfdf1b069e0')
  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
})

test('acquisition operation types are stable and distinct without changing sale IDs', () => {
  const message = { guildId: '123', channelId: '456', messageId: '789' }
  const sale = discordRequestId(message)
  const purchase = discordRequestId({ ...message, operationType: 'purchase' })
  const farm = discordRequestId({ ...message, operationType: 'farm' })
  const trade = discordRequestId({ ...message, operationType: 'trade' })
  const manualAdd = discordRequestId({ ...message, operationType: 'manual_add' })
  const stockReconcile = discordRequestId({ ...message, operationType: 'stock_reconcile' })

  assert.equal(purchase, discordRequestId({ ...message, operationType: 'PURCHASE' }))
  assert.equal(manualAdd, discordRequestId({ ...message, operationType: 'MANUAL_ADD' }))
  assert.equal(stockReconcile, discordRequestId({ ...message, operationType: 'stock_reconcile' }))
  assert.equal(new Set([sale, purchase, farm, trade, manualAdd, stockReconcile]).size, 6)
})

test('different Discord message IDs produce different request UUIDs', () => {
  const first = discordRequestId({ guildId: '123', channelId: '456', messageId: '789' })
  const second = discordRequestId({ guildId: '123', channelId: '456', messageId: '790' })

  assert.notEqual(first, second)
})
