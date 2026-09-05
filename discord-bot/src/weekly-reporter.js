import { randomUUID } from 'node:crypto'
import {
  claimDiscordReportDelivery,
  loadWeeklySalesRecords,
  markDiscordReportDeliverySent,
} from './supabase.js'
import {
  aggregateWeeklySales,
  buildWeeklySalesEmbed,
  latestCompletedWeeklyRange,
  nextWeeklyBoundary,
  WEEKLY_FIRST_REPORT_END,
  WEEKLY_REPORT_TYPE,
  weeklyReportMarker,
} from './weekly-finance.js'

const RETRY_DELAY_MS = 5 * 60 * 1000
const MAX_TIMER_MS = 2_147_000_000
const MAX_RECONCILIATION_MESSAGES = 10_000

export async function runWeeklySalesReport({
  channelId,
  claimToken = randomUUID(),
  client,
  logger = console,
  now = new Date(),
  services = defaultServices,
  supabase,
}) {
  const range = latestCompletedWeeklyRange(now)
  if (Date.parse(range.endExclusive) < Date.parse(WEEKLY_FIRST_REPORT_END)) {
    return { status: 'not-due', range }
  }
  const claim = await services.claim(supabase, {
    reportType: WEEKLY_REPORT_TYPE,
    range,
    channelId,
    claimToken,
  })

  if (claim.deliveryStatus === 'sent') return { status: 'already-sent', range }
  if (!claim.claimed) return { status: 'in-progress', range }

  const channel = await client.channels.fetch(channelId)
  if (!channel?.isTextBased?.() || typeof channel.send !== 'function' || !channel.messages?.fetch) {
    throw new Error(`Weekly sales channel ${channelId} is unavailable or is not a text channel.`)
  }

  const marker = weeklyReportMarker(range)
  const existing = await findDeliveredReport(channel, {
    botUserId: client.user?.id,
    marker,
    notBefore: range.endExclusive,
  })
  if (existing) {
    await services.markSent(supabase, { ...range, claimToken, messageId: existing.id })
    logger.info?.(`Reconciled weekly sales report ${marker} from Discord message ${existing.id}.`)
    return { status: 'reconciled', range, messageId: existing.id }
  }

  const [rarRecords, mrRecords] = await Promise.all([
    services.loadRecords(supabase, range, 'RAR'),
    services.loadRecords(supabase, range, 'MR'),
  ])
  const embed = buildWeeklySalesEmbed({
    range,
    rar: aggregateWeeklySales(rarRecords),
    mr: aggregateWeeklySales(mrRecords),
  })
  const sendClaim = await services.claim(supabase, {
    reportType: WEEKLY_REPORT_TYPE,
    range,
    channelId,
    claimToken,
  })
  if (sendClaim.deliveryStatus === 'sent') return { status: 'already-sent', range }
  if (!sendClaim.claimed) return { status: 'claim-lost', range }

  const message = await channel.send({ embeds: [embed] })
  await services.markSent(supabase, { ...range, claimToken, messageId: message.id })
  logger.info?.(`Posted weekly sales report ${marker} as Discord message ${message.id}.`)
  return { status: 'sent', range, messageId: message.id, embed }
}

export function createWeeklySalesReporter({
  channelId,
  clearTimer = clearTimeout,
  client,
  logger = console,
  now = () => new Date(),
  run = runWeeklySalesReport,
  setTimer = setTimeout,
  supabase,
}) {
  let active = false
  let running = null
  let timer = null
  let wakePending = false

  const schedule = (delay) => {
    if (!active) return
    if (timer) clearTimer(timer)
    timer = setTimer(() => {
      timer = null
      void execute()
    }, Math.min(Math.max(delay, 0), MAX_TIMER_MS))
  }

  const execute = async () => {
    if (!active) return null
    if (running) {
      wakePending = true
      return running
    }

    running = (async () => {
      let retry = false
      try {
        const result = await run({ channelId, client, logger, now: now(), supabase })
        retry = ['claim-lost', 'in-progress'].includes(result?.status)
        return result
      } catch (error) {
        retry = true
        logger.error?.(`Weekly sales report check failed: ${error instanceof Error ? error.message : String(error)}`)
        return { status: 'failed', error }
      } finally {
        running = null
        if (!active) return
        if (wakePending) {
          wakePending = false
          queueMicrotask(() => { void execute() })
          return
        }
        const delay = retry
          ? RETRY_DELAY_MS
          : Math.max(0, Date.parse(nextWeeklyBoundary(now())) - now().getTime())
        schedule(delay)
      }
    })()
    return running
  }

  return {
    start() {
      if (active) return running
      active = true
      return execute()
    },
    wake() {
      if (!active) return this.start()
      if (timer) {
        clearTimer(timer)
        timer = null
      }
      return execute()
    },
    stop() {
      active = false
      wakePending = false
      if (timer) clearTimer(timer)
      timer = null
    },
    checkNow: execute,
  }
}

export async function findDeliveredReport(channel, {
  botUserId,
  marker,
  notBefore,
  maxMessages = MAX_RECONCILIATION_MESSAGES,
}) {
  let before
  let scanned = 0
  const notBeforeTimestamp = Date.parse(notBefore)

  while (scanned < maxMessages) {
    const batch = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) })
    const messages = [...batch.values()]
    if (messages.length === 0) return null

    for (const message of messages) {
      if (message.author?.id !== botUserId) continue
      if (message.embeds?.some((embed) => embed.footer?.text?.includes(marker))) return message
    }

    scanned += messages.length
    const oldest = messages.reduce((candidate, message) => (
      !candidate || message.createdTimestamp < candidate.createdTimestamp ? message : candidate
    ), null)
    if (messages.length < 100 || oldest.createdTimestamp < notBeforeTimestamp) return null
    before = oldest.id
  }

  throw new Error(`Could not safely reconcile weekly report ${marker} within ${maxMessages} Discord messages.`)
}

const defaultServices = {
  claim: claimDiscordReportDelivery,
  loadRecords: loadWeeklySalesRecords,
  markSent: markDiscordReportDeliverySent,
}
