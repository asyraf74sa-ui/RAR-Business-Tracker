import assert from 'node:assert/strict'
import test from 'node:test'
import { buildGuildCommandDefinitions, syncGuildCommands } from '../src/command-registration.js'

test('guild definitions register help, stock, and monthly reporting commands', () => {
  const definitions = buildGuildCommandDefinitions()
  assert.deepEqual(definitions.map(({ name }) => name), ['help', 'stock', 'monthly', 'months'])

  const stock = definitions.find(({ name }) => name === 'stock')
  assert.deepEqual(stock.options[0].choices.map(({ value }) => value), ['RAR', 'MR'])
  assert.equal(stock.options[1].name, 'item')
  assert.equal(stock.options[1].required, false)
  assert.equal(stock.options[1].autocomplete, true)

  const monthly = definitions.find(({ name }) => name === 'monthly')
  assert.deepEqual(monthly.options[0].choices.map(({ value }) => value), ['RAR', 'MR'])
  assert.equal(monthly.options[1].name, 'month')
  assert.equal(monthly.options[1].required, false)
  assert.equal(monthly.options[1].min_length, 7)
  assert.equal(monthly.options[1].max_length, 7)

  const months = definitions.find(({ name }) => name === 'months')
  assert.deepEqual(months.options[0].choices.map(({ value }) => value), ['RAR', 'MR'])
})

test('guild command registration is idempotent and preserves unrelated commands', async () => {
  const state = new Map([
    ['help-id', { id: 'help-id', name: 'help' }],
    ['other-id', { id: 'other-id', name: 'unrelated' }],
  ])
  const createdNames = []
  const editedNames = []
  let nextId = 1
  const guild = {
    commands: {
      async fetch() { return new Map(state) },
      async create(definition) {
        createdNames.push(definition.name)
        const command = { id: `created-${nextId++}`, ...definition }
        state.set(command.id, command)
        return command
      },
      async edit(id, definition) {
        editedNames.push(definition.name)
        const command = { id, ...definition }
        state.set(id, command)
        return command
      },
    },
  }

  await syncGuildCommands(guild)
  await syncGuildCommands(guild)

  assert.deepEqual(createdNames, ['stock', 'monthly', 'months'])
  assert.deepEqual(editedNames, ['help', 'help', 'stock', 'monthly', 'months'])
  assert.equal([...state.values()].filter(({ name }) => name === 'help').length, 1)
  assert.equal([...state.values()].filter(({ name }) => name === 'stock').length, 1)
  assert.equal([...state.values()].filter(({ name }) => name === 'monthly').length, 1)
  assert.equal([...state.values()].filter(({ name }) => name === 'months').length, 1)
  assert.ok([...state.values()].some(({ name }) => name === 'unrelated'))
})
