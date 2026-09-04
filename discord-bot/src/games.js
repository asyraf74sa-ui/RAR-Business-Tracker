export const GAME_CHOICES = [
  { name: 'RAR', value: 'RAR' },
  { name: 'MR', value: 'MR' },
]

export function normalizeGame(value, fallback = 'RAR') {
  const game = String(value || fallback).trim().toUpperCase()
  return game === 'MR' ? 'MR' : 'RAR'
}
