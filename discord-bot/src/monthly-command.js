import { MessageFlags } from 'discord.js'
import {
  aggregateFinancialRecords,
  buildMonthlyHistoryPages,
  buildMonthlyOverviewPage,
  currentMalaysiaMonth,
  malaysiaMonthRange,
  MonthlyInputError,
  parseMonthOption,
} from './monthly-finance.js'
import { loadFinancialHistoryRecords, loadMonthlyFinancialRecords } from './supabase.js'
import { normalizeGame } from './games.js'

const MONTHLY_LOAD_TIMEOUT_MS = 15_000
const HISTORY_LOAD_TIMEOUT_MS = 30_000

export async function processMonthlyInteraction(
  interaction,
  {
    supabase,
    loadRecords = loadMonthlyFinancialRecords,
    logger = console,
    now = new Date(),
    timeoutMs = MONTHLY_LOAD_TIMEOUT_MS,
  },
) {
  if (!await deferEphemeral(interaction, '/monthly', logger)) return false

  try {
    const requested = interaction.options.getString('month')
    const game = normalizeGame(interaction.options.getString('game'))
    const month = requested ? parseMonthOption(requested) : currentMalaysiaMonth(now)
    const range = malaysiaMonthRange(month)
    const records = await withTimeout(loadRecords(supabase, range, game), timeoutMs, 'Monthly report timed out.')
    const [report] = aggregateFinancialRecords(records, { selectedMonth: month })
    await interaction.editReply({ embeds: [buildMonthlyOverviewPage(report, { game })] })
    return true
  } catch (error) {
    if (error instanceof MonthlyInputError) {
      await safeEditReply(interaction, {
        content: '❌ Invalid month. Use YYYY-MM, for example 2026-09.',
        embeds: [],
      }, '/monthly', logger)
      return false
    }

    logger.error?.(`/monthly failed: ${safeErrorMessage(error)}`)
    await safeEditReply(interaction, {
      content: `❌ Could not load ${normalizeGame(interaction.options.getString('game'))} monthly report.\nPlease try again.`,
      embeds: [],
    }, '/monthly', logger)
    return false
  }
}

export async function processMonthlyHistoryInteraction(
  interaction,
  {
    supabase,
    loadRecords = loadFinancialHistoryRecords,
    logger = console,
    timeoutMs = HISTORY_LOAD_TIMEOUT_MS,
  },
) {
  if (!await deferEphemeral(interaction, '/months', logger)) return false

  try {
    const game = normalizeGame(interaction.options.getString('game'))
    const records = await withTimeout(loadRecords(supabase, game), timeoutMs, 'Monthly history timed out.')
    const pages = buildMonthlyHistoryPages(aggregateFinancialRecords(records), { game })
    await interaction.editReply({ embeds: [pages[0]] })
    for (const page of pages.slice(1)) {
      await interaction.followUp({ embeds: [page], flags: MessageFlags.Ephemeral })
    }
    return true
  } catch (error) {
    logger.error?.(`/months failed: ${safeErrorMessage(error)}`)
    await safeEditReply(interaction, {
      content: `❌ Could not load ${normalizeGame(interaction.options.getString('game'))} monthly report.\nPlease try again.`,
      embeds: [],
    }, '/months', logger)
    return false
  }
}

async function deferEphemeral(interaction, command, logger) {
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral })
    return true
  } catch (error) {
    logger.error?.(`${command} could not be deferred: ${safeErrorMessage(error)}`)
    return false
  }
}

async function safeEditReply(interaction, response, command, logger) {
  try {
    await interaction.editReply(response)
  } catch (error) {
    logger.error?.(`${command} error response failed: ${safeErrorMessage(error)}`)
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
