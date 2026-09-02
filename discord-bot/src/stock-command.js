import { MessageFlags } from 'discord.js'
import { loadActiveItems } from './supabase.js'
import {
  buildStockAutocompleteChoices,
  buildStockItemPage,
  buildStockOverviewPages,
  findExactStockItem,
} from './stock-view.js'

const STOCK_LOAD_TIMEOUT_MS = 10_000
const AUTOCOMPLETE_TIMEOUT_MS = 2_000
const STOCK_LOAD_ERROR = '❌ Could not load RAR stock.\nPlease try again.'

export async function processStockInteraction(
  interaction,
  { supabase, loadItems = loadActiveItems, logger = console, timeoutMs = STOCK_LOAD_TIMEOUT_MS },
) {
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral })
  } catch (error) {
    logger.error?.(`/stock could not be deferred: ${safeErrorMessage(error)}`)
    return false
  }

  try {
    const items = await withTimeout(loadItems(supabase), timeoutMs, 'RAR stock request timed out.')
    const requestedName = interaction.options.getString('item')

    if (requestedName) {
      const item = findExactStockItem(items, requestedName)
      if (!item) {
        await interaction.editReply({ content: '❌ Item not found.', embeds: [] })
        return true
      }

      await interaction.editReply({ embeds: [buildStockItemPage(item)] })
      return true
    }

    const pages = buildStockOverviewPages(items)
    await interaction.editReply({ embeds: [pages[0]] })
    for (const page of pages.slice(1)) {
      await interaction.followUp({ embeds: [page], flags: MessageFlags.Ephemeral })
    }
    return true
  } catch (error) {
    logger.error?.(`/stock failed: ${safeErrorMessage(error)}`)
    try {
      await interaction.editReply({ content: STOCK_LOAD_ERROR, embeds: [] })
    } catch (replyError) {
      logger.error?.(`/stock error response failed: ${safeErrorMessage(replyError)}`)
    }
    return false
  }
}

export async function processStockAutocompleteInteraction(
  interaction,
  { supabase, loadItems = loadActiveItems, logger = console, timeoutMs = AUTOCOMPLETE_TIMEOUT_MS },
) {
  try {
    const items = await withTimeout(loadItems(supabase), timeoutMs, 'RAR stock autocomplete timed out.')
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
