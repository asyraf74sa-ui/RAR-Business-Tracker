import assert from 'node:assert/strict'
import test from 'node:test'
import { selectAllRows } from '../src/lib/supabase-pagination.js'

test('loads every ordered Supabase page for lifetime reporting', async () => {
  const source = Array.from({ length: 2_005 }, (_, index) => ({ id: index }))
  const ranges = []
  const result = await selectAllRows(() => ({
    async range(from, to) {
      ranges.push([from, to])
      return { data: source.slice(from, to + 1), error: null }
    },
  }))

  assert.equal(result.data.length, 2_005)
  assert.deepEqual(result.data, source)
  assert.deepEqual(ranges, [[0, 999], [1_000, 1_999], [2_000, 2_999]])
})

test('returns a Supabase error without requesting another page', async () => {
  let calls = 0
  const error = new Error('read failed')
  const result = await selectAllRows(() => ({
    async range() {
      calls += 1
      return { data: null, error }
    },
  }))

  assert.equal(result.error, error)
  assert.equal(calls, 1)
})
