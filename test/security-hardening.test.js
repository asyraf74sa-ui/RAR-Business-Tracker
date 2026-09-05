import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const readProjectFile = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

test('Vercel does not expose the credential form through arbitrary URL rewrites', async () => {
  const config = JSON.parse(await readProjectFile('vercel.json'))

  assert.equal(config.rewrites, undefined)
})

test('Vercel applies restrictive browser security headers', async () => {
  const config = JSON.parse(await readProjectFile('vercel.json'))
  const headers = Object.fromEntries(config.headers[0].headers.map(({ key, value }) => [key, value]))
  const csp = headers['Content-Security-Policy']

  assert.match(csp, /default-src 'self'/)
  assert.match(csp, /object-src 'none'/)
  assert.match(csp, /frame-ancestors 'none'/)
  assert.match(csp, /form-action 'self'/)
  assert.match(csp, /https:\/\/aiufjjedsgatmnhocxyz\.supabase\.co/)
  assert.equal(headers['X-Content-Type-Options'], 'nosniff')
  assert.equal(headers['X-Frame-Options'], 'DENY')
})

test('the private login page clearly identifies its authentication handling', async () => {
  const [authPage, indexHtml] = await Promise.all([
    readProjectFile('src/components/AuthPage.jsx'),
    readProjectFile('index.html'),
  ])

  assert.match(authPage, /Private owner dashboard/)
  assert.match(authPage, /Authentication is handled by Supabase/)
  assert.match(authPage, /does not save your password in its business database/)
  assert.match(indexHtml, /noindex, nofollow, noarchive/)
})
