import { fetchLatestUsdRates } from '../src/lib/frankfurter.js'

const SUCCESS_CACHE = 'public, max-age=300'
const CDN_CACHE = 'public, max-age=3600'

function sendJson(response, statusCode, payload) {
  response.statusCode = statusCode
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.end(JSON.stringify(payload))
}

export function createFxHandler({ loadRates = fetchLatestUsdRates, logger = console } = {}) {
  return async function fxHandler(request, response) {
    if (request.method !== 'GET') {
      response.setHeader('Allow', 'GET')
      response.setHeader('Cache-Control', 'no-store')
      sendJson(response, 405, { error: 'Method not allowed' })
      return
    }

    try {
      const payload = await loadRates()
      response.setHeader('Cache-Control', SUCCESS_CACHE)
      response.setHeader('Vercel-CDN-Cache-Control', CDN_CACHE)
      sendJson(response, 200, payload)
    } catch (error) {
      logger.error('FX rate refresh failed:', error instanceof Error ? error.message : 'Unknown error')
      response.setHeader('Cache-Control', 'no-store')
      sendJson(response, 503, { error: 'USD conversion is temporarily unavailable' })
    }
  }
}

export default createFxHandler()
