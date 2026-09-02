import dotenv from 'dotenv'
import { Client, Events, GatewayIntentBits, Partials } from 'discord.js'
import {
  AmbiguousItemError,
  InsufficientStockError,
  UnknownItemError,
  UnknownPlatformError,
  resolvePlatform,
  resolveSaleItems,
} from './catalog.js'
import { isSaleMessage, parseSaleMessage, SaleParseError } from './parser.js'
import { discordRequestId } from './request-id.js'
import {
  authenticateSupabase,
  createBotSupabaseClient,
  findRecordedSale,
  loadCatalog,
  recordSale,
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
  console.log(`RAR Discord bot ready as ${readyClient.user.tag}. Watching channel ${config.DISCORD_SALES_CHANNEL_ID}.`)
})

client.on(Events.MessageCreate, (message) => {
  enqueue(() => processDiscordSale(message, { isEdit: false }))
})

client.on(Events.MessageUpdate, (oldMessage, newMessage) => {
  enqueue(async () => {
    const message = newMessage.partial ? await newMessage.fetch() : newMessage
    if (!oldMessage.partial && oldMessage.content === message.content) return
    await processDiscordSale(message, { isEdit: true })
  })
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

async function processDiscordSale(message, { isEdit }) {
  if (message.channelId !== config.DISCORD_SALES_CHANNEL_ID) return
  if (message.author?.bot) return
  if (!message.guildId) return

  const looksLikeSale = isSaleMessage(message.content)
  if (!isEdit && !looksLikeSale) return

  const requestId = discordRequestId({
    guildId: message.guildId,
    channelId: message.channelId,
    messageId: message.id,
  })

  try {
    const existingSaleId = await findRecordedSale(supabase, requestId)
    if (existingSaleId) {
      if (isEdit) {
        if (warnedEditedMessages.has(message.id)) return
        const replied = await safeReply(
          message,
          '⚠️ This Discord message was already recorded.\nEdit the transaction from the RAR tracker instead.',
        )
        if (replied) warnedEditedMessages.add(message.id)
      } else {
        await safeReply(message, '⚠️ This Discord message was already recorded.')
      }
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

    await safeReply(message, confirmationText({ parsed, platform, resolvedItems }))
  } catch (error) {
    const reply = userFacingError(error)
    console.error(`Sale ${message.id} was not recorded: ${safeErrorMessage(error)}`)
    await safeReply(message, `❌ Sale not recorded\n${reply}`)
  }
}

function userFacingError(error) {
  if (error instanceof UnknownItemError) return `Unknown item: ${error.itemName}`
  if (error instanceof AmbiguousItemError) return error.message
  if (error instanceof InsufficientStockError) return `Insufficient stock for ${error.itemName}`
  if (error instanceof UnknownPlatformError) return `Unknown platform: ${error.platformName}`
  if (error instanceof SaleParseError) return error.message

  const message = safeErrorMessage(error)
  const insufficient = message.match(/Insufficient stock for\s+([^\n.]+)/i)
  if (insufficient) return `Insufficient stock for ${insufficient[1].trim()}`
  if (/Invalid or inactive sales platform/i.test(message)) return 'Unknown or inactive platform.'
  if (/Authentication required|JWT|session/i.test(message)) return 'Supabase authentication expired. Restart the bot and check its console.'
  if (/fetch|network|timeout|econn|socket/i.test(message)) return 'Network error. The sale was not confirmed; check the bot console and retry.'
  return 'Database error. Check the bot console for details.'
}

function confirmationText({ parsed, platform, resolvedItems }) {
  const itemSummary = resolvedItems
    .map(({ item, quantity }) => `${formatQuantity(quantity)} ${item.name}`)
    .join(' + ')

  return [
    '✅ Sale recorded',
    `${platform.name} • $${parsed.netCredit.toFixed(2)} net • $${parsed.platformFee.toFixed(2)} fee`,
    itemSummary,
  ].join('\n')
}

function formatQuantity(value) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 6 }).format(value)
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
    'DISCORD_SALES_CHANNEL_ID',
    'SUPABASE_URL',
    'SUPABASE_ANON_KEY',
    'SUPABASE_EMAIL',
    'SUPABASE_PASSWORD',
  ]
  const missing = required.filter((name) => !String(environment[name] || '').trim())
  if (missing.length > 0) throw new Error(`Missing required environment variables: ${missing.join(', ')}`)

  return Object.fromEntries(required.map((name) => [name, environment[name].trim()]))
}

function safeErrorMessage(error) {
  return error instanceof Error ? error.message : String(error)
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
