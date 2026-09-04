import assert from 'node:assert/strict'
import test from 'node:test'
import { canonicalPlatformName, PLATFORM_NAMES, platformKey } from '../src/platforms.js'
import { resolvePlatform, UnknownPlatformError } from '../src/catalog.js'

test('PayPal aliases normalize to one canonical platform identity', () => {
  for (const alias of ['PAYPAL', 'PayPal', 'paypal']) {
    assert.equal(canonicalPlatformName(alias), 'PayPal')
  }
})

test('TNG aliases normalize to one canonical platform identity', () => {
  for (const alias of ['TNG', 'tng', "Touch 'n Go", 'Touch n Go', "Touch 'n Go eWallet", 'TNG eWallet']) {
    assert.equal(canonicalPlatformName(alias), 'TNG')
  }
})

test('canonical platform list has no duplicate normalized identities and preserves existing platforms', () => {
  const keys = PLATFORM_NAMES.map(platformKey)
  assert.equal(new Set(keys).size, PLATFORM_NAMES.length)
  for (const name of ['Eldorado', 'ZeusX', 'Gameflip', 'PlayerAuctions', 'G2G', 'Itemku', 'Direct', 'PayPal', 'TNG']) {
    assert.ok(PLATFORM_NAMES.includes(name))
  }
})

test('database platform resolution accepts aliases but rejects missing identities', () => {
  const platforms = [
    { id: 'paypal', name: 'PayPal', active: true },
    { id: 'tng', name: 'TNG', active: true },
  ]
  assert.equal(resolvePlatform('PAYPAL', platforms).id, 'paypal')
  assert.equal(resolvePlatform("Touch 'n Go eWallet", platforms).id, 'tng')
  assert.throws(() => resolvePlatform('Unknown', platforms), UnknownPlatformError)
})
