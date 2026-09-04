import { SlashCommandBuilder } from 'discord.js'
import { HELP_TOPICS } from './help.js'
import { GAME_CHOICES } from './games.js'

export function buildGuildCommandDefinitions() {
  return [
    new SlashCommandBuilder()
      .setName('help')
      .setDescription('Show RAR and MR bot formats and live item names')
      .addStringOption((option) => option
        .setName('topic')
        .setDescription('Choose a help topic')
        .setRequired(false)
        .addChoices(...HELP_TOPICS))
      .toJSON(),
    new SlashCommandBuilder()
      .setName('stock')
      .setDescription('View one game inventory without changing it')
      .addStringOption((option) => option
        .setName('game')
        .setDescription('Choose RAR or MR; defaults to RAR')
        .setRequired(false)
        .addChoices(...GAME_CHOICES))
      .addStringOption((option) => option
        .setName('item')
        .setDescription('View one active item by its canonical name')
        .setRequired(false)
        .setAutocomplete(true))
      .toJSON(),
    new SlashCommandBuilder()
      .setName('monthly')
      .setDescription('View a private monthly RAR or MR financial report')
      .addStringOption((option) => option
        .setName('game')
        .setDescription('Choose RAR or MR; defaults to RAR')
        .setRequired(false)
        .addChoices(...GAME_CHOICES))
      .addStringOption((option) => option
        .setName('month')
        .setDescription('Malaysia-calendar month in YYYY-MM format')
        .setRequired(false)
        .setMinLength(7)
        .setMaxLength(7))
      .toJSON(),
    new SlashCommandBuilder()
      .setName('months')
      .setDescription('View private profit history for every recorded month')
      .addStringOption((option) => option
        .setName('game')
        .setDescription('Choose RAR or MR; defaults to RAR')
        .setRequired(false)
        .addChoices(...GAME_CHOICES))
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
