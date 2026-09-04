export const PLATFORM_NAMES = [
  'Eldorado',
  'ZeusX',
  'Gameflip',
  'PlayerAuctions',
  'G2G',
  'Itemku',
  'PayPal',
  'TNG',
  'Direct',
]

const PLATFORM_BY_KEY = new Map(PLATFORM_NAMES.map((name) => [platformKey(name), name]))

for (const alias of ['Touch n Go', "Touch 'n Go", "Touch 'n Go eWallet", 'TNG eWallet']) {
  PLATFORM_BY_KEY.set(platformKey(alias), 'TNG')
}

export function canonicalPlatformName(value) {
  return PLATFORM_BY_KEY.get(platformKey(value)) || null
}

export function platformKey(value) {
  return String(value || '').normalize('NFKC').toLowerCase().replace(/[^a-z0-9]/g, '')
}
