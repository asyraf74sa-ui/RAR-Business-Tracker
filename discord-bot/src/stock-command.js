import { MessageFlags } from 'discord.js'
import { normalizeGame } from './games.js'
import { loadActiveItems, loadMRActiveItems, loadMRSetStockSummaries } from './supabase.js'
import {
  buildStockAutocompleteChoices,
  buildStockItemPage,
  buildStockOverviewPages,
  findExactStockItem,
} from './stock-view.js'

const STOCK_LOAD_TIMEOUT_MS = 10_000
const AUTOCOMPLETE_TIMEOUT_MS = 2_000

export async function processStockInteraction(
  interaction,
  {
    supabase,
    loadItems = null,
    loadSetSummaries = loadMRSetStockSummaries,
    logger = console,
    timeoutMs = STOCK_LOAD_TIMEOUT_MS,
  },
) {
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral })
  } catch (error) {
    logger.error?.(`/stock could not be deferred: ${safeErrorMessage(error)}`)
    return false
  }

  try {
    const game = selectedGame(interaction)
    const itemLoader = loadItems || (game === 'MR' ? loadMRActiveItems : loadActiveItems)
    const [items, setSummaries] = await withTimeout(Promise.all([
      itemLoader(supabase, game),
      game === 'MR' ? loadSetSummaries(supabase) : Promise.resolve([]),
    ]), timeoutMs, `${game} stock request timed out.`)
    const requestedName = interaction.options.getString('item')

    if (requestedName) {
      const item = findExactStockItem(items, requestedName)
      if (!item) {
        await interaction.editReply({ content: '❌ Item not found.', embeds: [] })
        return true
      }

      await interaction.editReply({ embeds: [buildStockItemPage(item, { game })] })
      return true
    }

    const pages = buildStockOverviewPages(items, { game, setSummaries })
    await interaction.editReply({ embeds: [pages[0]] })
    for (const page of pages.slice(1)) {
      await interaction.followUp({ embeds: [page], flags: MessageFlags.Ephemeral })
    }
    return true
  } catch (error) {
    logger.error?.(`/stock failed: ${safeErrorMessage(error)}`)
    try {
      await interaction.editReply({
        content: `❌ Could not load ${selectedGame(interaction)} stock.\nPlease try again.`,
        embeds: [],
      })
    } catch (replyError) {
      logger.error?.(`/stock error response failed: ${safeErrorMessage(replyError)}`)
    }
    return false
  }
}

export async function processStockAutocompleteInteraction(
  interaction,
  { supabase, loadItems = null, logger = console, timeoutMs = AUTOCOMPLETE_TIMEOUT_MS },
) {
  try {
    const game = selectedGame(interaction)
    const itemLoader = loadItems || (game === 'MR' ? loadMRActiveItems : loadActiveItems)
    const items = await withTimeout(itemLoader(supabase, game), timeoutMs, `${game} stock autocomplete timed out.`)
    const choices = buildStockAutocompleteChoices(items, interaction.options.getFocused())
    await interaction.respond(choices)
    return true
  } catch (error) {
    logger.error?.(`/stock autocomplete failed: ${safeErrorMessage(error)}`)
    try {
      if (!interaction.responded) await interaction.respond([])
    } catch (replyError) {
      logger.error?.(`/stock autocomplete error response failed: ${safeErrorMessage(replyError)}`)
    }
    return false
  }
}

function selectedGame(interaction) {
  return normalizeGame(interaction.options.getString?.('game'))
}

async function withTimeout(promise, timeoutMs, message) {
  let timeoutId
  const timeout = new Promise((resolve, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs)
  })

  try {
    return await Promise.race([Promise.resolve(promise), timeout])
  } finally {
    clearTimeout(timeoutId)
  }
}

function safeErrorMessage(error) {
  return error instanceof Error ? error.message : String(error?.message || error)
}
