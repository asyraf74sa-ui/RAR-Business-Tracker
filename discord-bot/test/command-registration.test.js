import assert from 'node:assert/strict'
import test from 'node:test'
import { buildGuildCommandDefinitions, syncGuildCommands } from '../src/command-registration.js'

test('guild definitions register /help and autocomplete-enabled /stock', () => {
  const definitions = buildGuildCommandDefinitions()
  assert.deepEqual(definitions.map(({ name }) => name), ['help', 'stock'])

  const stock = definitions.find(({ name }) => name === 'stock')
  assert.equal(stock.options[0].name, 'item')
  assert.equal(stock.options[0].required, false)
  assert.equal(stock.options[0].autocomplete, true)
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

  assert.deepEqual(createdNames, ['stock'])
  assert.deepEqual(editedNames, ['help', 'help', 'stock'])
  assert.equal([...state.values()].filter(({ name }) => name === 'help').length, 1)
  assert.equal([...state.values()].filter(({ name }) => name === 'stock').length, 1)
  assert.ok([...state.values()].some(({ name }) => name === 'unrelated'))
})
