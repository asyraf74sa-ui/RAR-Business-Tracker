import { createHash } from 'node:crypto'

const URL_NAMESPACE = '6ba7b811-9dad-11d1-80b4-00c04fd430c8'

export function discordRequestId({ guildId, channelId, messageId, operationType = null }) {
  for (const [name, value] of Object.entries({ guildId, channelId, messageId })) {
    if (!String(value || '').trim()) throw new TypeError(`${name} is required`)
  }
  if (operationType !== null && !String(operationType).trim()) throw new TypeError('operationType cannot be empty')

  const namespace = Buffer.from(URL_NAMESPACE.replaceAll('-', ''), 'hex')
  const components = [guildId, channelId, messageId]
  if (operationType !== null) components.push(String(operationType).trim().toLowerCase())
  const name = Buffer.from(components.join(':'), 'utf8')
  const bytes = createHash('sha1').update(namespace).update(name).digest().subarray(0, 16)

  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80

  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
