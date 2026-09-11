import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import { hostname } from 'node:os'
import { join } from 'node:path'
import { hash, UploadError } from './upload-input.js'

const stages = new Set(['create_pending', 'create_rejected', 'draft', 'photo_pending', 'photo_uploaded', 'photo_attached', 'publish_pending', 'published'])
const validId = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(value)
const validHash = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)

// One journal per account, not per input filename: copying/renaming JSON must not bypass recovery.
export async function openJournal(directory, owner, { redact = (value) => value } = {}) {
  const account = hash(owner)
  const path = join(directory, `${account}.state.json`)
  let state = { version: 1, account, entries: {} }
  try {
    const data = await readFile(path, 'utf8')
    if (data.length > 10_000_000) throw Error()
    state = JSON.parse(data)
    if (state.version !== 1 || state.account !== account || !state.entries || Array.isArray(state.entries)) throw Error()
    for (const [key, entry] of Object.entries(state.entries)) {
      if (!validHash(key) || !validHash(entry.fingerprint) || typeof entry.title !== 'string' || entry.title.length > 120
          || !stages.has(entry.stage) || (entry.listingId !== undefined && !validId(entry.listingId))
          || (entry.photoId !== undefined && !validId(entry.photoId)) || (!['create_pending', 'create_rejected'].includes(entry.stage) && !entry.listingId)
          || Object.keys(entry).some((field) => !['title', 'fingerprint', 'listingId', 'photoId', 'stage'].includes(field))) throw Error()
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw new UploadError('Recovery journal is unreadable or invalid. Do not delete it or retry creation; review it first.', { stop: true })
  }
  return {
    get(key) { const entry = state.entries[hash(key)]; return entry ? { ...entry } : undefined },
    async save(key, value) {
      // Only non-secret recovery fields. Never store a response, image bytes, URL, or environment.
      const entry = Object.fromEntries(['title', 'fingerprint', 'listingId', 'photoId', 'stage']
        .filter((field) => value[field] !== undefined).map((field) => [field, value[field]]))
      if (JSON.stringify(redact(entry)) !== JSON.stringify(entry)) throw new UploadError('Sensitive or unsafe recovery data blocked.', { stop: true })
      state.entries[hash(key)] = entry
      const temporary = `${path}.${process.pid}.tmp`
      let handle
      try {
        await mkdir(directory, { recursive: true })
        handle = await open(temporary, 'wx', 0o600)
        await handle.writeFile(JSON.stringify(state, null, 2) + '\n')
        await handle.sync()
        await handle.close()
        handle = undefined
        await rename(temporary, path)
      } catch { throw new UploadError('Cannot safely save recovery state. Batch stopped; retain runs/ and inspect the last operation before retrying.', { stop: true }) }
      finally { await handle?.close().catch(() => {}) }
    },
  }
}

export async function acquireLock(directory, owner) {
  const path = join(directory, `${hash(owner)}.lock`)
  try { await mkdir(directory, { recursive: true }) }
  catch { throw new UploadError('Cannot create the local run directory.', { stop: true }) }
  let handle
  try {
    handle = await open(path, 'wx', 0o600)
    await handle.writeFile(JSON.stringify({ pid: process.pid, host: hostname() }))
    await handle.sync()
  } catch {
    await handle?.close().catch(() => {})
    // Do not guess whether another process or crashed process owns the lock.
    throw new UploadError('Account upload lock exists or cannot be written. Close other uploaders; review a stale lock manually before removing only that .lock file.', { stop: true })
  }
  return async () => {
    await handle.close()
    await unlink(path)
  }
}
