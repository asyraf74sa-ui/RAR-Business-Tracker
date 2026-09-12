import { isDeepStrictEqual } from 'node:util'
import { fingerprint, loadImage, normalizeTitle, UploadError } from './upload-input.js'

const unpublished = (listing) => ['draft', 'prepare', 'ready'].includes(listing.status)
const duplicates = (rows, key) => rows.filter((row) => typeof row.name === 'string' && normalizeTitle(row.name) === key)

export function verifyFields(listing, payload) {
  for (const [field, value] of Object.entries(payload)) {
    if (!isDeepStrictEqual(listing[field], value)) throw new UploadError(`Draft verification failed: ${field} is missing or differs. Nothing will be published.`)
  }
}
export function verifyPhoto(listing, photoId) {
  const photo = listing.photo?.[photoId]
  if (!photoId || !photo || photo.status !== 'active' || photo.display_order !== 0 || listing.cover_photo !== photoId
      || typeof photo.view_url !== 'string' || !photo.view_url.startsWith('https://')) {
    throw new UploadError('Photo/cover verification failed. Nothing will be published.')
  }
}

export async function planUpload(entries, { file, api, journal, allowDuplicate = false, readImage = loadImage }) {
  const rows = await api.listings()
  const plans = []
  for (const entry of entries) {
    const result = { ...entry, action: 'ERROR' }
    plans.push(result)
    if (entry.error) { result.reason = entry.error; continue }
    const saved = journal.get(entry.key)
    if (saved?.listingId) result.listingId = saved.listingId
    if (saved?.stage === 'published') {
      Object.assign(result, { action: 'SKIP', reason: 'Already completed in the recovery journal.', listingId: saved.listingId })
      continue
    }
    if (saved?.stage === 'create_pending' && !saved.listingId) {
      result.reason = 'Uncertain previous create. Review Gameflip and runs/; do not delete state or re-create blindly.'
      result.stop = true
      continue
    }
    const matches = duplicates(rows, entry.key).filter((row) => row.id !== saved?.listingId)
    if (matches.length && !allowDuplicate) {
      Object.assign(result, { action: saved?.listingId ? 'ERROR' : 'SKIP', reason: saved?.listingId ? 'Another matching listing exists; retained draft requires review.' : 'Existing listing found.', listingId: saved?.listingId || matches[0].id })
      continue
    }
    try {
      if (entry.validationError) throw new UploadError(entry.validationError)
      // Omission is intentional: no placeholder, copied photo or file access.
      // An explicitly supplied image remains mandatory for this entry/recovery.
      const images = entry.imagePath === undefined ? [] : [await readImage(file, entry.imagePath)]
      const digest = fingerprint(entry, images)
      if (saved?.listingId && saved.fingerprint !== digest) throw new UploadError('Input or image changed since draft creation. Review the existing draft; no replacement will be created.')
      if (saved?.listingId) {
        const snapshot = await api.listing(saved.listingId)
        verifyFields(snapshot, entry.payload)
        if (!unpublished(snapshot) && !(snapshot.status === 'onsale' && saved.stage === 'publish_pending')) {
          throw new UploadError('Retained listing is no longer an unpublished draft; manual review required.', { stop: true })
        }
        if (snapshot.status === 'onsale' && images.length) verifyPhoto(snapshot, saved.photoId)
      }
      Object.assign(result, { action: saved?.listingId ? 'RESUME' : 'CREATE', images, fingerprint: digest, saved, listingId: saved?.listingId })
    } catch (error) {
      result.reason = error instanceof UploadError ? error.message : 'Image or retained-draft validation failed.'
      result.stop = !(error instanceof UploadError) || error.stop
    }
  }
  return { plans, scanned: rows.length }
}

export async function runUpload(plan, { api, journal, execute = false, confirmed = false, allowDuplicate = false, log = () => {} }) {
  const results = []
  let draftsCreated = 0
  const live = execute && confirmed
  const newCount = plan.plans.filter((item) => item.action === 'CREATE').length
  const resumes = plan.plans.filter((item) => item.action === 'RESUME').length
  log(execute ? 'LIVE GAMEFLIP UPLOAD' : 'GAMEFLIP BULK UPLOAD DRY RUN')
  log(`${newCount} new listings ${execute ? 'will be created' : 'would be created'}; ${resumes} existing drafts ${execute ? 'will be resumed' : 'would be resumed'}.`)
  log(`Duplicate scan: ${plan.scanned} searchable owned listings (all known statuses, explicit expiration range).`)
  if (allowDuplicate) log('WARNING: --allow-duplicate permits matching account titles; input duplicates and recovery checks remain blocked.')
  if (execute && !confirmed) throw new UploadError('Confirmation missing. No writes made. Live mode also requires --confirm UPLOAD.', { stop: true })
  let halted = live && plan.plans.some((entry) => entry.stop)
  for (const entry of plan.plans) {
    let state = entry.saved
    let stage = 'validation'
    const result = { title: entry.title, action: entry.action, ...(entry.listingId ? { listingId: entry.listingId } : {}) }
    results.push(result)
    log(`[${entry.index + 1}/${plan.plans.length}] ${entry.title}`)
    if (['ERROR', 'SKIP'].includes(entry.action)) {
      result.reason = entry.reason
      log(`  ${entry.action}: ${entry.reason}${result.listingId ? ` (id: ${result.listingId})` : ''}`)
      continue
    }
    if (!live) {
      const cents = entry.payload.price
      log(`  ${entry.action}: $${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')} — qty ${entry.payload.qty_avail}; ${entry.images.length ? 'image OK' : 'no image (photo workflow omitted)'}`)
      continue
    }
    if (halted) { Object.assign(result, { action: 'NOT_ATTEMPTED', reason: 'Batch stopped for safety.' }); log('  NOT ATTEMPTED: batch stopped for safety.'); continue }
    const save = async (changes) => {
      state = { ...state, ...changes }
      if (state.listingId) result.listingId = state.listingId
      await journal.save(entry.key, state)
    }
    try {
      stage = 'duplicate recheck'
      let rows
      try { rows = await api.listings() }
      catch { throw new UploadError('Duplicate recheck failed; batch stopped without further creation.', { stop: true }) }
      if (!allowDuplicate && duplicates(rows, entry.key).some((row) => row.id !== state?.listingId)) {
        if (state?.listingId) throw new UploadError('Another matching listing appeared; retained draft requires review.')
        Object.assign(result, { action: 'SKIP', reason: 'Existing listing found during immediate recheck.' })
        log('  SKIP: existing listing found during immediate recheck.')
        continue
      }
      if (!state?.listingId) {
        stage = 'create draft'
        await save({ title: entry.title, fingerprint: entry.fingerprint, stage: 'create_pending' })
        let listingId
        try { listingId = await api.createDraft(entry.payload) }
        catch (error) {
          // Only an explicit API rejection proves that retrying creation is safe.
          if (error instanceof UploadError && !error.uncertain) await save({ stage: 'create_rejected' })
          throw error
        }
        draftsCreated++
        await save({ listingId, stage: 'draft' })
        log(`  draft created: ${listingId}`)
      }
      stage = 'verify draft fields'
      let snapshot = await api.listing(state.listingId)
      verifyFields(snapshot, entry.payload)
      if (snapshot.status === 'onsale' && ['publish_pending', 'published'].includes(state.stage)) {
        if (entry.images.length) verifyPhoto(snapshot, state.photoId)
        await save({ stage: 'published' })
        result.action = 'SUCCESS'
        log(`  SUCCESS: previous publish confirmed (id: ${state.listingId}).`)
        continue
      }
      if (!unpublished(snapshot)) throw new UploadError('Expected an unpublished draft; unexpected status requires manual review.', { stop: true })
      if (entry.images.length && !['photo_uploaded', 'photo_attached', 'publish_pending'].includes(state.stage)) {
        stage = 'allocate photo'
        await save({ stage: 'photo_pending' })
        const allocation = await api.allocatePhoto(state.listingId)
        await save({ photoId: allocation.id })
        stage = 'upload image'
        await api.uploadPhoto(allocation, entry.images[0])
        await save({ stage: 'photo_uploaded' })
        log('  image uploaded')
      }
      if (entry.images.length && state.stage === 'photo_uploaded') {
        stage = 'associate photo and cover'
        snapshot = await api.listing(state.listingId)
        verifyFields(snapshot, entry.payload)
        await api.attachPhoto(state.listingId, state.photoId, snapshot)
        await save({ stage: 'photo_attached' })
      }
      stage = 'verify before publish'
      snapshot = await api.listing(state.listingId)
      verifyFields(snapshot, entry.payload)
      if (entry.images.length) verifyPhoto(snapshot, state.photoId)
      if (!unpublished(snapshot)) throw new UploadError('Draft status changed before publishing.', { stop: true })
      stage = 'publish'
      await save({ stage: 'publish_pending' })
      await api.publish(state.listingId, snapshot)
      stage = 'verify published'
      snapshot = await api.listing(state.listingId)
      verifyFields(snapshot, entry.payload)
      if (entry.images.length) verifyPhoto(snapshot, state.photoId)
      if (snapshot.status !== 'onsale') throw new UploadError('Publish not confirmed; draft ID retained. Review before retrying.')
      await save({ stage: 'published' })
      result.action = 'SUCCESS'
      log(`  SUCCESS (id: ${state.listingId})`)
    } catch (error) {
      Object.assign(result, { action: 'FAILED', stage, reason: error instanceof UploadError ? error.message : 'Unexpected failure; details withheld. Review recovery state.' })
      halted ||= !(error instanceof UploadError) || error.stop || error.uncertain
      log(`  FAILED at ${stage}${result.listingId ? ` (id: ${result.listingId})` : ''}: ${result.reason}`)
    }
  }
  const count = (action) => results.filter((entry) => entry.action === action).length
  const summary = {
    created: count('SUCCESS'), draftsCreated, wouldCreate: count('CREATE'), wouldResume: count('RESUME'),
    skipped: count('SKIP'), invalid: count('ERROR'), failed: count('FAILED'), notAttempted: count('NOT_ATTEMPTED'),
  }
  log(live ? 'GAMEFLIP BULK UPLOAD COMPLETE' : 'GAMEFLIP BULK UPLOAD DRY RUN COMPLETE')
  log(live
    ? `Published/completed: ${summary.created}; New drafts created: ${summary.draftsCreated}; Skipped: ${summary.skipped}; Failed: ${summary.failed + summary.invalid}; Not attempted: ${summary.notAttempted}`
    : `${summary.wouldCreate} would create; ${summary.wouldResume} would resume; ${summary.skipped} skipped; ${summary.invalid} invalid. Zero mutations.`)
  return { mode: live ? 'live' : 'dry-run', summary, results }
}
