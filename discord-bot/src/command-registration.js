import { SlashCommandBuilder } from 'discord.js'
import { HELP_TOPICS } from './help.js'

export function buildGuildCommandDefinitions() {
  return [
    new SlashCommandBuilder()
      .setName('help')
      .setDescription('Show RAR bot formats and live item names')
      .addStringOption((option) => option
        .setName('topic')
        .setDescription('Choose a help topic')
        .setRequired(false)
        .addChoices(...HELP_TOPICS))
      .toJSON(),
    new SlashCommandBuilder()
      .setName('stock')
      .setDescription('View live RAR inventory without changing it')
      .addStringOption((option) => option
        .setName('item')
        .setDescription('View one active item by its canonical name')
        .setRequired(false)
        .setAutocomplete(true))
      .toJSON(),
  ]
}

export async function registerGuildCommands(readyClient, { guildId }) {
  const guild = await readyClient.guilds.fetch(guildId)
  const commands = await syncGuildCommands(guild)
  return { guild, commands }
}

export async function syncGuildCommands(guild, definitions = buildGuildCommandDefinitions()) {
  const names = definitions.map(({ name }) => name)
  if (new Set(names).size !== names.length) throw new Error('Guild command definitions contain duplicate names.')

  const fetched = await guild.commands.fetch()
  const existingCommands = commandValues(fetched)
  const registered = []

  for (const definition of definitions) {
    const existing = existingCommands.find((candidate) => candidate.name === definition.name)
    if (existing) {
      registered.push(await guild.commands.edit(existing.id, definition))
    } else {
      const created = await guild.commands.create(definition)
      existingCommands.push(created)
      registered.push(created)
    }
  }

  return registered
}

function commandValues(commands) {
  if (Array.isArray(commands)) return [...commands]
  if (typeof commands?.values === 'function') return [...commands.values()]
  return []
}
