import { detectAcquisitionGame, detectAcquisitionOperation } from './acquisition-parser.js'
import { detectSaleGame } from './parser.js'
import { detectExpenseWorkspace } from './expense-parser.js'

export function routeDiscordMessage(channelId, content, config) {
  const expenseWorkspace = detectExpenseWorkspace(content)
  if (expenseWorkspace === 'RAR' && channelId === config.DISCORD_ACQUISITION_CHANNEL_ID) {
    return { kind: 'expense', workspace: 'RAR' }
  }
  if (expenseWorkspace === 'MR' && channelId === config.DISCORD_MR_OPERATIONS_CHANNEL_ID) {
    return { kind: 'expense', workspace: 'MR' }
  }
  if (expenseWorkspace === 'SHARED' && [config.DISCORD_ACQUISITION_CHANNEL_ID, config.DISCORD_MR_OPERATIONS_CHANNEL_ID].includes(channelId)) {
    return { kind: 'expense', workspace: 'SHARED' }
  }

  const saleGame = detectSaleGame(content)
  if (channelId === config.DISCORD_SALES_CHANNEL_ID && saleGame) {
    return { kind: 'sale', game: saleGame }
  }

  const game = detectAcquisitionGame(content)
  const operation = detectAcquisitionOperation(content)
  if (game === 'RAR' && channelId === config.DISCORD_ACQUISITION_CHANNEL_ID && operation) {
    return { kind: 'operation', game, operation }
  }
  if (game === 'MR' && channelId === config.DISCORD_MR_OPERATIONS_CHANNEL_ID && operation && operation !== 'farm') {
    return { kind: 'operation', game, operation }
  }
  return null
}
