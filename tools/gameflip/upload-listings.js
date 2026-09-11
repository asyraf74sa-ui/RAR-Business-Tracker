import { existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { credentialsFromEnv, createRedactor, InspectorError } from './client.js'
import { createUploadClient } from './upload-api.js'
import { loadInput, UploadError } from './upload-input.js'
import { acquireLock, openJournal } from './upload-state.js'
import { planUpload, runUpload } from './upload-runner.js'

export const HELP = `Standalone Gameflip bulk listing uploader (default: READ-ONLY DRY RUN)

  npm run gameflip:upload -- --file tools/gameflip/listings.json
  npm run gameflip:upload -- --file tools/gameflip/listings.json --execute --confirm UPLOAD

Options:
  --file PATH          Required input JSON; images resolve relative to this file.
  --execute            Enable live draft/photo/publish operations only with confirmation.
  --confirm UPLOAD     Additional explicit live confirmation (case-sensitive).
  --allow-duplicate    Permit existing account titles; never bypass input/journal guards.
  --verbose            Sanitized request-stage diagnostics; never headers or bodies.
  --help               No credentials or network needed.

Keep tools/gameflip/runs/ for recovery. Never delete it to force a retry.
Live mode creates drafts first and publishes only after field/photo verification.
`

export function parseUploadArgs(args) {
  const options = { execute: false, confirmed: false, allowDuplicate: false, verbose: false }
  const seen = new Set()
  for (let index = 0; index < args.length; index++) {
    const flag = args[index]
    if (seen.has(flag)) throw new UploadError('Duplicate command-line option.')
    seen.add(flag)
    if (flag === '--help') options.help = true
    else if (flag === '--execute') options.execute = true
    else if (flag === '--allow-duplicate') options.allowDuplicate = true
    else if (flag === '--verbose') options.verbose = true
    else if (flag === '--file') {
      if (!args[index + 1] || args[index + 1].startsWith('--')) throw new UploadError('--file requires a path.')
      options.file = args[++index]
    } else if (flag === '--confirm') {
      if (args[++index] !== 'UPLOAD') throw new UploadError('Confirmation must be exactly --confirm UPLOAD.')
      options.confirmed = true
    } else throw new UploadError('Unknown option. Use --help. Credentials must never be command-line arguments.')
  }
  if (!options.help && !options.file) throw new UploadError('Specify --file tools/gameflip/listings.json.')
  if (options.confirmed && !options.execute) throw new UploadError('--confirm is only valid together with --execute.')
  return options
}

export async function runUploadCli(args, {
  env = process.env,
  loadEnv = () => { const path = fileURLToPath(new URL('./.env', import.meta.url)); if (existsSync(path)) process.loadEnvFile(path) },
  makeClient = createUploadClient, readInput = loadInput, makeJournal = openJournal, lock = acquireLock,
  directory = fileURLToPath(new URL('./runs/', import.meta.url)),
  stdout = (value) => process.stdout.write(value + '\n'), stderr = (value) => process.stderr.write(value + '\n'),
} = {}) {
  let redact = (value) => value
  let release
  try {
    const options = parseUploadArgs(args)
    if (options.help) { stdout(HELP); return 0 }
    loadEnv()
    const credentials = credentialsFromEnv(env)
    const redactor = createRedactor(credentials)
    redact = redactor.redact
    const log = (value) => stdout(redact(value))
    const entries = await readInput(resolve(options.file))
    // Fail before sending/persisting accidental credentials or sensitive URL parameters in input.
    for (const entry of entries) {
      if (entry.payload && JSON.stringify(redact(entry.payload)) !== JSON.stringify(entry.payload)) {
        entry.error = 'Input contains sensitive or unsafe text. Remove credentials, signed URLs or control characters.'
      }
    }
    const api = makeClient(credentials, { ...options, redactor, onDebug: options.verbose ? (value) => stderr(redact(value)) : () => {} })
    const owner = await api.account()
    if (options.execute && options.confirmed) release = await lock(directory, owner)
    const journal = await makeJournal(directory, owner, { redact })
    const plan = await planUpload(entries, { ...options, api, journal })
    const report = await runUpload(plan, { ...options, api, journal, log })
    return report.summary.failed + report.summary.invalid + report.summary.notAttempted > 0 ? 1 : 0
  } catch (error) {
    // All exposed messages are local constants/field names, never raw API/fs errors or stacks.
    const known = error instanceof UploadError || error instanceof InspectorError
    stderr(known ? redact(error.message) : 'Uploader failed safely; remote/file details withheld. Check input, local environment and recovery state.')
    return 1
  } finally {
    if (release) {
      try { await release() }
      catch { stderr('Could not release upload lock. Review the account .lock file before another live run.') }
    }
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  process.exitCode = await runUploadCli(process.argv.slice(2))
}
