import dotenv from 'dotenv'
import {
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  Partials,
} from 'discord.js'
import {
  AcquisitionParseError,
  detectAcquisitionOperation,
  parseAcquisitionMessage,
} from './acquisition-parser.js'
import {
  AmbiguousItemError,
  DuplicateItemError,
  InsufficientStockError,
  TradeValidationError,
  UnknownItemError,
  UnknownPlatformError,
  resolvePlatform,
  resolveManualAddItems,
  resolvePurchaseItems,
  resolveSaleItems,
  resolveStockItems,
  resolveTradeItems,
} from './catalog.js'
import { registerGuildCommands } from './command-registration.js'
import { buildHelpPages } from './help.js'
import { processMonthlyHistoryInteraction, processMonthlyInteraction } from './monthly-command.js'
import { isSaleMessage, parseSaleMessage, SaleParseError } from './parser.js'
import { discordRequestId } from './request-id.js'
import { buildStockReconciliationResults, formatStockReconciliationLine } from './stock-results.js'
import { processStockAutocompleteInteraction, processStockInteraction } from './stock-command.js'
import {
  addStockBundle,
  authenticateSupabase,
  claimFarmCycles,
  createBotSupabaseClient,
  findRecordedInventoryOperation,
  findRecordedSale,
  loadActiveItems,
  loadCatalog,
  loadInventoryEvents,
  recordPurchaseBundle,
  reconcileStockBundle,
  recordSale,
  recordTrade,
} from './supabase.js'

dotenv.config({ quiet: true })

const config = readConfig(process.env)
const supabase = createBotSupabaseClient({
  url: config.SUPABASE_URL,
  publishableKey: config.SUPABASE_ANON_KEY,
})

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel, Partials.Message],
})

let processingQueue = Promise.resolve()
const warnedEditedMessages = new Set()

client.once(Events.ClientReady, (readyClient) => {
  console.log(
    `RAR Discord bot ready as ${readyClient.user.tag}. Watching sales ${config.DISCORD_SALES_CHANNEL_ID} and acquisitions ${config.DISCORD_ACQUISITION_CHANNEL_ID}.`,
  )
  registerGuildCommands(readyClient, { guildId: config.DISCORD_GUILD_ID }).then(({ guild }) => {
    console.log(`Guild /help, /stock, /monthly, and /months commands are ready in ${guild.name}.`)
  }).catch((error) => {
    console.error(`Could not register guild commands: ${safeErrorMessage(error)}`)
  })
})

client.on(Events.MessageCreate, (message) => {
  enqueue(() => processDiscordMessage(message, { isEdit: false }))
})

client.on(Events.MessageUpdate, (oldMessage, newMessage) => {
  enqueue(async () => {
    const message = newMessage.partial ? await newMessage.fetch() : newMessage
    if (!oldMessage.partial && oldMessage.content === message.content) return
    await processDiscordMessage(message, { isEdit: true })
  })
})

client.on(Events.InteractionCreate, (interaction) => {
  if (interaction.isAutocomplete() && interaction.commandName === 'stock') {
    processStockAutocompleteInteraction(interaction, { supabase })
    return
  }

  if (!interaction.isChatInputCommand()) return
  if (interaction.commandName === 'help') {
    processHelpInteraction(interaction).catch((error) => {
      console.error(`Could not answer /help: ${safeErrorMessage(error)}`)
    })
  } else if (interaction.commandName === 'stock') {
    processStockInteraction(interaction, { supabase })
  } else if (interaction.commandName === 'monthly') {
    processMonthlyInteraction(interaction, { supabase })
  } else if (interaction.commandName === 'months') {
    processMonthlyHistoryInteraction(interaction, { supabase })
  }
})

client.on(Events.Error, (error) => {
  console.error(`Discord client error: ${safeErrorMessage(error)}`)
})

process.on('unhandledRejection', (error) => {
  console.error(`Unhandled asynchronous error: ${safeErrorMessage(error)}`)
})

function enqueue(task) {
  processingQueue = processingQueue.then(task, task).catch((error) => {
    console.error(`Message processing error: ${safeErrorMessage(error)}`)
  })
}

async function processDiscordMessage(message, { isEdit }) {
  if (message.author?.bot || !message.guildId) return

  if (message.channelId === config.DISCORD_SALES_CHANNEL_ID) {
    await processDiscordSale(message, { isEdit })
    return
  }

  if (message.channelId === config.DISCORD_ACQUISITION_CHANNEL_ID) {
    await processDiscordAcquisition(message, { isEdit })
  }
}

async function processDiscordSale(message, { isEdit }) {
  const looksLikeSale = isSaleMessage(message.content)
  if (!isEdit && !looksLikeSale) return

  const requestId = requestIdFor(message)

  try {
    const existingSaleId = await findRecordedSale(supabase, requestId)
    if (existingSaleId) {
      await warnAlreadyRecorded(message, { isEdit, recordKind: 'Discord message' })
      return
    }

    if (!looksLikeSale) return

    const parsed = parseSaleMessage(message.content)
    const catalog = await loadCatalog(supabase)
    const platform = resolvePlatform(parsed.platform, catalog.platforms)
    const resolvedItems = resolveSaleItems(parsed.items, catalog.items)

    await recordSale(supabase, {
      p_sold_at: message.createdAt.toISOString(),
      p_platform: platform.name,
      p_net_credit: parsed.netCredit,
      p_platform_fee: parsed.platformFee,
      p_currency: parsed.currency,
      p_classification: 'normal',
      p_notes: `Recorded automatically from Discord message ${message.id}`,
      p_items: resolvedItems.map(({ item, quantity }) => ({
        item_id: item.id,
        quantity,
        unit_gross_price: null,
      })),
      p_inventory_applied: true,
      p_request_id: requestId,
    })

    await safeReply(message, saleConfirmation({ parsed, platform, resolvedItems }))
  } catch (error) {
    console.error(`Sale ${message.id} was not recorded: ${safeErrorMessage(error)}`)
    await safeReply(message, `❌ Sale not recorded\n${userFacingError(error, 'sale')}`)
  }
}

async function processDiscordAcquisition(message, { isEdit }) {
  const operation = detectAcquisitionOperation(message.content)
  const operationTypes = ['purchase', 'farm', 'trade', 'manual_add', 'stock_reconcile']
  const requestIds = operationTypes.map((type) => requestIdFor(message, type))

  try {
    if (isEdit) {
      const existing = await findRecordedInventoryOperation(supabase, requestIds)
      if (existing) {
        await warnAlreadyRecorded(message, {
          isEdit: true,
          recordKind: 'record',
          stockRecord: ['manual_add', 'stock_adjustment'].includes(existing.event_type),
        })
        return
      }
    }

    if (!operation) return

    const parsed = parseAcquisitionMessage(message.content)
    const requestId = requestIdFor(message, parsed.type)
    const existing = await findRecordedInventoryOperation(supabase, [requestId])
    if (existing) {
      await warnAlreadyRecorded(message, {
        isEdit,
        recordKind: 'record',
        stockRecord: ['manual_add', 'stock_adjustment'].includes(existing.event_type),
      })
      return
    }

    if (parsed.type === 'purchase') await processPurchase(message, parsed, requestId)
    else if (parsed.type === 'farm') await processFarm(message, parsed, requestId)
    else if (parsed.type === 'trade') await processTrade(message, parsed, requestId)
    else if (parsed.type === 'manual_add') await processManualAdd(message, parsed, requestId)
    else await processStockReconciliation(message, parsed, requestId)
  } catch (error) {
    const label = operationLabel(operation)
    console.error(`${label} ${message.id} was not recorded: ${safeErrorMessage(error)}`)
    await safeReply(message, `❌ ${operationFailureTitle(operation)}\n${userFacingError(error, operation)}`)
  }
}

async function processPurchase(message, parsed, requestId) {
  const catalog = await loadCatalog(supabase)
  const resolvedItems = resolvePurchaseItems(parsed.items, catalog.items)
  const result = await recordPurchaseBundle(supabase, {
    p_items: rpcItems(resolvedItems),
    p_cash_amount: parsed.cost.amount,
    p_cash_currency: parsed.cost.currency,
    p_event_at: message.createdAt.toISOString(),
    p_notes: `Recorded automatically from Discord purchase message ${message.id}`,
    p_request_id: requestId,
  })

  if (isDuplicateRpcResult(result)) {
    await warnAlreadyRecorded(message, { isEdit: false, recordKind: 'record' })
    return
  }

  const lines = resolvedItems.map(({ item, quantity }) => `+${formatQuantity(quantity)} ${item.name}`)
  await safeReply(message, [
    '✅ Purchase recorded',
    ...lines,
    `Cost: ${parsed.cost.currency} ${formatMoney(parsed.cost.amount)}`,
  ].join('\n'))
}

async function processFarm(message, parsed, requestId) {
  const result = await claimFarmCycles(supabase, {
    p_cycles: parsed.cycles,
    p_event_at: message.createdAt.toISOString(),
    p_request_id: requestId,
  })

  if (isDuplicateRpcResult(result)) {
    await warnAlreadyRecorded(message, { isEdit: false, recordKind: 'record' })
    return
  }

  let events = []
  try {
    events = await loadInventoryEvents(supabase, requestId)
  } catch (error) {
    console.error(`Farm ${message.id} was recorded, but its item breakdown could not be loaded: ${safeErrorMessage(error)}`)
  }
  const lines = events
    .map((event) => ({
      name: nestedItemName(event.item) || event.item_id,
      quantity: Number(event.quantity_delta),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
    .map(({ name, quantity }) => `+${formatQuantity(quantity)} ${name}`)

  await safeReply(message, [
    '✅ Farm recorded',
    `${parsed.cycles} ${parsed.cycles === 1 ? 'cycle' : 'cycles'} claimed`,
    ...(lines.length > 0 ? lines : ['Item breakdown unavailable; check the RAR tracker.']),
  ].join('\n'))
}

async function processTrade(message, parsed, requestId) {
  const catalog = await loadCatalog(supabase)
  const resolved = resolveTradeItems(parsed.giveItems, parsed.receiveItems, catalog.items)
  const result = await recordTrade(supabase, {
    p_event_at: message.createdAt.toISOString(),
    p_give_items: rpcItems(resolved.give),
    p_receive_items: rpcItems(resolved.receive),
    p_notes: `Recorded automatically from Discord trade message ${message.id}`,
    p_request_id: requestId,
  })

  if (isDuplicateRpcResult(result)) {
    await warnAlreadyRecorded(message, { isEdit: false, recordKind: 'record' })
    return
  }

  await safeReply(message, [
    '✅ Trade recorded',
    '',
    'Gave:',
    ...resolved.give.map(({ item, quantity }) => `-${formatQuantity(quantity)} ${item.name}`),
    '',
    'Received:',
    ...resolved.receive.map(({ item, quantity }) => `+${formatQuantity(quantity)} ${item.name}`),
  ].join('\n'))
}

async function processManualAdd(message, parsed, requestId) {
  const catalog = await loadCatalog(supabase)
  const resolvedItems = resolveManualAddItems(parsed.items, catalog.items)
  const result = await addStockBundle(supabase, {
    p_event_at: message.createdAt.toISOString(),
    p_items: rpcItems(resolvedItems),
    p_notes: `Recorded automatically from Discord manual-add message ${message.id}`,
    p_request_id: requestId,
  })

  if (isDuplicateRpcResult(result)) {
    await warnAlreadyRecorded(message, { isEdit: false, recordKind: 'record', stockRecord: true })
    return
  }

  await safeReply(message, [
    '✅ Stock added',
    '',
    ...resolvedItems.map(({ item, quantity }) => `+${formatQuantity(quantity)} ${item.name}`),
  ].join('\n'))
}

async function processStockReconciliation(message, parsed, requestId) {
  const catalog = await loadCatalog(supabase)
  const resolvedItems = resolveStockItems(parsed.items, catalog.items)
  const result = await reconcileStockBundle(supabase, {
    p_counts: resolvedItems.map(({ item, quantity }) => ({
      item_id: item.id,
      counted_stock: quantity,
    })),
    p_event_at: message.createdAt.toISOString(),
    p_notes: `Recorded automatically from Discord stocktake message ${message.id}`,
    p_request_id: requestId,
  })

  if (isDuplicateRpcResult(result)) {
    await warnAlreadyRecorded(message, { isEdit: false, recordKind: 'record', stockRecord: true })
    return
  }

  let lines = []
  try {
    const events = await loadInventoryEvents(supabase, requestId)
    lines = buildStockReconciliationResults(events).map(formatStockReconciliationLine)
  } catch (error) {
    console.error(
      `Stock reconciliation ${message.id} was recorded, but its result could not be loaded: ${safeErrorMessage(error)}`,
    )
  }

  await safeReply(message, [
    '✅ Stock reconciled',
    '',
    ...(lines.length > 0 ? lines : ['Result breakdown unavailable; check the RAR tracker.']),
  ].join('\n'))
}

async function processHelpInteraction(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral })

  try {
    const topic = interaction.options.getString('topic') || 'overview'
    const itemNames = topic === 'items'
      ? (await loadActiveItems(supabase)).map((item) => item.name)
      : []
    const pages = buildHelpPages(topic, itemNames)

    await interaction.editReply({ embeds: [pages[0]] })
    for (const page of pages.slice(1)) {
      await interaction.followUp({ embeds: [page], flags: MessageFlags.Ephemeral })
    }
  } catch (error) {
    console.error(`/help failed: ${safeErrorMessage(error)}`)
    await interaction.editReply({ content: 'Could not load RAR help. Check the bot console and try again.', embeds: [] })
  }
}

async function warnAlreadyRecorded(message, { isEdit, recordKind, stockRecord = false }) {
  if (isEdit) {
    if (warnedEditedMessages.has(message.id)) return
    const guidance = stockRecord
      ? 'Make corrections through the RAR tracker or post a new stock record.'
      : 'Make corrections through the RAR tracker instead.'
    const replied = await safeReply(message, `⚠️ This record was already processed.\n${guidance}`)
    if (replied) warnedEditedMessages.add(message.id)
    return
  }

  await safeReply(message, `⚠️ This ${recordKind} was already recorded.`)
}

function userFacingError(error, operation) {
  if (error instanceof UnknownItemError) {
    return `Unknown item: ${error.itemName}\nUse /help with the Valid item names topic.`
  }
  if (error instanceof AmbiguousItemError) return error.message
  if (error instanceof DuplicateItemError) return `${error.itemName} can appear only once in RAR STOCK.`
  if (error instanceof InsufficientStockError) {
    return insufficientStockText(error.itemName, error.required, error.available)
  }
  if (error instanceof TradeValidationError) return error.message
  if (error instanceof UnknownPlatformError) return `Unknown platform: ${error.platformName}`
  if (error instanceof SaleParseError || error instanceof AcquisitionParseError) return error.message

  const message = safeErrorMessage(error)
  const detailedStock = message.match(
    /Insufficient stock for\s+(.+?)\.\s*Required:\s*([0-9,.]+)\.\s*Available:\s*([0-9,.]+)/i,
  )
  if (detailedStock) return insufficientStockText(detailedStock[1], detailedStock[2], detailedStock[3])
  const insufficient = message.match(/Insufficient stock for\s+([^\n.]+)/i)
  if (insufficient) return `Insufficient stock for ${insufficient[1].trim()}`
  if (/Invalid or inactive sales platform/i.test(message)) return 'Unknown or inactive platform.'
  if (/issued in the future|system clock|clock skew/i.test(message)) {
    return 'Supabase rejected the session because of clock skew. Synchronize the bot host clock and try again.'
  }
  if (/Authentication required|JWT|session/i.test(message)) {
    return 'Supabase authentication could not be restored automatically. Check the bot console.'
  }
  if (/fetch|network|timeout|econn|socket/i.test(message)) {
    return `Network error. The ${operation || 'record'} was not confirmed; check the bot console and retry.`
  }
  return 'Database error. Check the bot console for details.'
}

function insufficientStockText(itemName, required, available) {
  return [
    `Insufficient stock for ${itemName}.`,
    `Required: ${formatQuantity(Number(required))}`,
    `Available: ${formatQuantity(Number(available))}`,
  ].join('\n')
}

function saleConfirmation({ parsed, platform, resolvedItems }) {
  return [
    '✅ Sale recorded',
    `${platform.name} • $${parsed.netCredit.toFixed(2)} net • $${parsed.platformFee.toFixed(2)} fee`,
    itemSummary(resolvedItems),
  ].join('\n')
}

function itemSummary(items) {
  return items.map(({ item, quantity }) => `${formatQuantity(quantity)} ${item.name}`).join(' + ')
}

function rpcItems(items) {
  return items.map(({ item, quantity }) => ({ item_id: item.id, quantity }))
}

function requestIdFor(message, operationType = null) {
  return discordRequestId({
    guildId: message.guildId,
    channelId: message.channelId,
    messageId: message.id,
    operationType,
  })
}

function isDuplicateRpcResult(result) {
  const numeric = Number(result)
  if (!Number.isFinite(numeric)) throw new Error('Database operation returned an invalid result.')
  return numeric < 0
}

function operationLabel(operation) {
  if (operation === 'purchase') return 'Purchase'
  if (operation === 'farm') return 'Farm'
  if (operation === 'trade') return 'Trade'
  if (operation === 'manual_add') return 'Manual add'
  if (operation === 'stock_reconcile') return 'Stock reconciliation'
  return 'Acquisition'
}

function operationFailureTitle(operation) {
  if (operation === 'manual_add') return 'Stock not added'
  if (operation === 'stock_reconcile') return 'Stock not reconciled'
  return `${operationLabel(operation)} not recorded`
}

function nestedItemName(item) {
  if (Array.isArray(item)) return item[0]?.name || null
  return item?.name || null
}

function formatQuantity(value) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 6 }).format(value)
}

function formatMoney(value) {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

async function safeReply(message, content) {
  try {
    await message.reply({ content, allowedMentions: { repliedUser: false } })
    return true
  } catch (error) {
    console.error(`Could not reply to Discord message ${message.id}: ${safeErrorMessage(error)}`)
    return false
  }
}

function readConfig(environment) {
  const required = [
    'DISCORD_BOT_TOKEN',
    'DISCORD_GUILD_ID',
    'DISCORD_SALES_CHANNEL_ID',
    'DISCORD_ACQUISITION_CHANNEL_ID',
    'SUPABASE_URL',
    'SUPABASE_ANON_KEY',
    'SUPABASE_EMAIL',
    'SUPABASE_PASSWORD',
  ]
  const missing = required.filter((name) => !String(environment[name] || '').trim())
  if (missing.length > 0) throw new Error(`Missing required environment variables: ${missing.join(', ')}`)

  const values = Object.fromEntries(required.map((name) => [name, environment[name].trim()]))
  if (values.DISCORD_SALES_CHANNEL_ID === values.DISCORD_ACQUISITION_CHANNEL_ID) {
    throw new Error('DISCORD_SALES_CHANNEL_ID and DISCORD_ACQUISITION_CHANNEL_ID must be different.')
  }
  return values
}

function safeErrorMessage(error) {
  return error instanceof Error ? error.message : String(error?.message || error)
}

async function start() {
  await authenticateSupabase(supabase, {
    email: config.SUPABASE_EMAIL,
    password: config.SUPABASE_PASSWORD,
  })

  const catalog = await loadCatalog(supabase)
  console.log(`Supabase authenticated. Loaded ${catalog.items.length} items and ${catalog.platforms.length} platforms.`)

  try {
    await client.login(config.DISCORD_BOT_TOKEN)
  } catch (error) {
    throw new Error(`Discord login failed: ${safeErrorMessage(error)}`)
  }
}

start().catch((error) => {
  console.error(`Startup failed: ${safeErrorMessage(error)}`)
  process.exitCode = 1
})
