import { existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { createClient, credentialsFromEnv, InspectorError } from './client.js'
import { inspect, renderReport } from './report.js'

export const HELP = `Gameflip listing inspector — Phase 1, GET/read only

  npm run gameflip:inspect
  npm run gameflip:inspect -- --search "Dinosaur Fossil"
  npm run gameflip:inspect -- --id <listing-id>
  npm run gameflip:inspect -- --all-statuses
  npm run gameflip:inspect -- --raw

Default: all searchable, unexpired onsale listings in YOUR account whose
titles begin "Run A Restaurant -". All pages are read. A sample of up to five
distinct RAR products is compared, including during --search.

--search TEXT    Case-insensitive title substring within RAR listings.
--id ID          One owned listing, any accessible status/title; no shop scan.
--all-statuses   Search all documented statuses with API-default expiration
                 filtering. Use --id for expired/unsearchable owned listings.
--raw            Sanitized listing/comparison JSON, without profile or headers.
--help, -h       Show this help without loading credentials or contacting APIs.

Set GAMEFLIP_API_KEY and GAMEFLIP_OTP_SECRET in tools/gameflip/.env
or your local environment. Never paste credentials into chat.
No website, Discord bot, Supabase, or listing writes are performed.`

export function parseArgs(args) {
  const options = { raw: false, allStatuses: false }
  const seen = new Set()
  for (let i = 0; i < args.length; i++) {
    const flag = args[i]
    if (seen.has(flag)) throw new InspectorError('Do not repeat CLI options. Use --help for usage.')
    seen.add(flag)
    if (flag === '--help' || flag === '-h') options.help = true
    else if (flag === '--raw') options.raw = true
    else if (flag === '--all-statuses') options.allStatuses = true
    else if (flag === '--search' || flag === '--id') {
      const value = args[++i]
      if (!value?.trim() || value.startsWith('--')) throw new InspectorError('Supply a value after --search or --id. Use --help for usage.')
      options[flag.slice(2)] = value.trim()
    } else throw new InspectorError('Unknown CLI option. Use --help; credentials belong in the local environment, not CLI arguments.')
  }
  if (options.id && (options.search || options.allStatuses)) throw new InspectorError('--id cannot be combined with --search or --all-statuses; it already reads any accessible status.')
  return options
}

export async function runCli(args = process.argv.slice(2), {
  env = process.env,
  loadEnv = () => {
    const path = fileURLToPath(new URL('./.env', import.meta.url))
    if (existsSync(path)) process.loadEnvFile(path)
  },
  makeClient = createClient,
  stdout = (message) => process.stdout.write(`${message}\n`),
  stderr = (message) => process.stderr.write(`${message}\n`),
} = {}) {
  try {
    const options = parseArgs(args)
    if (options.help) { stdout(HELP); return 0 }
    try { loadEnv() } catch { throw new InspectorError('Unable to load tools/gameflip/.env. Check its format and local file permissions; its contents were not logged.') }
    const client = makeClient(credentialsFromEnv(env))
    const report = await inspect(client, options, stderr)
    // Both formatted output and raw JSON pass through the same redaction boundary.
    stdout(options.raw ? JSON.stringify(client.redact(report), null, 2) : client.redact(renderReport(client.redact(report))))
    return 0
  } catch (error) {
    // Even unexpected errors are intentionally not interpolated: they may carry credentials.
    stderr(error instanceof InspectorError ? error.message : 'Inspection failed unexpectedly. No listing changes were attempted; diagnostic details were withheld to protect secrets.')
    return 1
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  process.exitCode = await runCli()
}
