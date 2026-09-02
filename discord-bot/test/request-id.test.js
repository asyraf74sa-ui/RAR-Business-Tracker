import assert from 'node:assert/strict'
import test from 'node:test'
import { discordRequestId } from '../src/request-id.js'

test('the same Discord message always produces the same request UUID', () => {
  const message = { guildId: '123', channelId: '456', messageId: '789' }
  const first = discordRequestId(message)
  const second = discordRequestId(message)

  assert.equal(first, second)
  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
})

test('different Discord message IDs produce different request UUIDs', () => {
  const first = discordRequestId({ guildId: '123', channelId: '456', messageId: '789' })
  const second = discordRequestId({ guildId: '123', channelId: '456', messageId: '790' })

  assert.notEqual(first, second)
})
