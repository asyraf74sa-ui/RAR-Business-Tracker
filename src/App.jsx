import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertCircle, CheckCircle2, Info, RefreshCw, X } from 'lucide-react'
import AuthPage from './components/AuthPage.jsx'
import Shell from './components/Shell.jsx'
import { Button, Card, LoadingScreen } from './components/ui.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Farming from './pages/Farming.jsx'
import Gems from './pages/Gems.jsx'
import Inventory from './pages/Inventory.jsx'
import Purchases from './pages/Purchases.jsx'
import RecordSale from './pages/RecordSale.jsx'
import SalesHistory from './pages/SalesHistory.jsx'
import Settings from './pages/Settings.jsx'
import { DEFAULT_PLATFORMS, INITIAL_ITEMS } from './lib/constants.js'
import { readableError, supabase } from './lib/supabase.js'

const emptyData = {
  items: [],
  platforms: [],
  sales: [],
  saleItems: [],
  inventoryEvents: [],
  farmConfig: null,
}

export default function App() {
  const [session, setSession] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [dataLoading, setDataLoading] = useState(false)
  const [data, setData] = useState(emptyData)
  const [appError, setAppError] = useState(null)
  const [activePage, setActivePage] = useState(() => localStorage.getItem('rar-active-page') || 'dashboard')
  const [toast, setToast] = useState(null)
  const toastTimer = useRef(null)
  const loadVersion = useRef(0)
  const defaultsInFlight = useRef(new Map())

  const notify = useCallback((type, message) => {
    window.clearTimeout(toastTimer.current)
    setToast({ type, message })
    toastTimer.current = window.setTimeout(() => setToast(null), type === 'error' ? 8_000 : 4_500)
  }, [])

  const ensureDefaults = useCallback(async (userId, existingItems) => {
    if (defaultsInFlight.current.has(userId)) return defaultsInFlight.current.get(userId)

    const setup = (async () => {
      if (existingItems.length === 0) {
        const { error: itemError } = await supabase.from('rar_items').insert(INITIAL_ITEMS.map((item) => ({ ...item, user_id: userId })))
        if (itemError) throw new Error(`Initial item setup failed: ${readableError(itemError)}`)
      }

      const { data: platforms, error: platformLoadError } = await supabase.from('rar_platforms').select('id').limit(1)
      if (platformLoadError) throw platformLoadError
      if (!platforms.length) {
        const { error: platformError } = await supabase.from('rar_platforms').insert(DEFAULT_PLATFORMS.map((platform) => ({ ...platform, user_id: userId, active: true })))
        if (platformError) throw new Error(`Platform setup failed: ${readableError(platformError)}`)
      }

      const { data: farmConfig, error: farmLoadError } = await supabase.from('rar_farm_config').select('user_id').maybeSingle()
      if (farmLoadError) throw farmLoadError
      if (!farmConfig) {
        const { error: farmError } = await supabase.from('rar_farm_config').insert({ user_id: userId, farming_accounts: 3, cycle_days: 2.5, units_per_item_per_account: 1 })
        if (farmError) throw new Error(`Farm setup failed: ${readableError(farmError)}`)
      }
    })()

    defaultsInFlight.current.set(userId, setup)
    try {
      await setup
    } catch (error) {
      defaultsInFlight.current.delete(userId)
      throw error
    }
  }, [])

  const loadBusinessData = useCallback(async (userId, { quiet = false } = {}) => {
    const version = ++loadVersion.current
    if (!quiet) setDataLoading(true)
    setAppError(null)
    try {
      const { data: firstItems, error: firstItemsError } = await supabase.from('rar_items').select('*').order('name')
      if (firstItemsError) throw firstItemsError
      await ensureDefaults(userId, firstItems || [])

      const requests = await Promise.all([
        supabase.from('rar_items').select('*').order('name'),
        supabase.from('rar_platforms').select('*').order('name'),
        supabase.from('rar_sales').select('*').order('sold_at', { ascending: false }).limit(1000),
        supabase.from('rar_sale_items').select('*').order('created_at', { ascending: false }).limit(5000),
        supabase.from('rar_inventory_events').select('*').order('event_at', { ascending: false }).limit(3000),
        supabase.from('rar_farm_config').select('*').maybeSingle(),
      ])
      const firstError = requests.find((response) => response.error)?.error
      if (firstError) throw firstError
      if (version !== loadVersion.current) return

      setData({
        items: requests[0].data || [],
        platforms: requests[1].data || [],
        sales: requests[2].data || [],
        saleItems: requests[3].data || [],
        inventoryEvents: requests[4].data || [],
        farmConfig: requests[5].data || null,
      })
    } catch (error) {
      if (version !== loadVersion.current) return
      setAppError(readableError(error, 'Your business data could not be loaded.'))
    } finally {
      if (version === loadVersion.current && !quiet) setDataLoading(false)
    }
  }, [ensureDefaults])

  useEffect(() => {
    let mounted = true
    supabase.auth.getSession().then(({ data: authData, error }) => {
      if (!mounted) return
      if (error) notify('error', readableError(error, 'Your saved session could not be restored.'))
      const currentSession = authData?.session || null
      setSession(currentSession)
      setAuthLoading(false)
      if (currentSession) loadBusinessData(currentSession.user.id)
    })

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!mounted) return
      setSession(nextSession)
      if (!nextSession) {
        loadVersion.current += 1
        defaultsInFlight.current.clear()
        setData(emptyData)
        setAppError(null)
        setDataLoading(false)
      } else {
        window.setTimeout(() => loadBusinessData(nextSession.user.id), 0)
      }
    })

    return () => {
      mounted = false
      subscription.subscription.unsubscribe()
      window.clearTimeout(toastTimer.current)
    }
  }, [loadBusinessData, notify])

  const authenticate = async ({ mode, email, password }) => {
    try {
      if (mode === 'signup') {
        const { data: authData, error } = await supabase.auth.signUp({ email, password })
        if (error) throw error
        if (!authData.session) return { ok: true, message: 'Account created. Check your email to confirm it, then sign in.' }
        return { ok: true, message: 'Account created. Your private tracker is being prepared.' }
      }
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) throw error
      return { ok: true, message: 'Signed in successfully.' }
    } catch (error) {
      return { ok: false, message: readableError(error, 'Authentication failed. Please try again.') }
    }
  }

  const signOut = async () => {
    const { error } = await supabase.auth.signOut()
    if (error) notify('error', readableError(error, 'Could not sign out.'))
  }

  const navigate = (page) => {
    setActivePage(page)
    localStorage.setItem('rar-active-page', page)
  }

  const refresh = useCallback(() => session ? loadBusinessData(session.user.id, { quiet: true }) : Promise.resolve(), [session, loadBusinessData])

  if (authLoading) return <LoadingScreen label="Restoring your session…" />
  if (!session) return <AuthPage onAuthenticate={authenticate} />

  const pageProps = { data, refresh, notify, user: session.user, onNavigate: navigate }
  const pages = {
    dashboard: <Dashboard {...pageProps} />,
    sale: <RecordSale {...pageProps} />,
    inventory: <Inventory {...pageProps} />,
    gems: <Gems {...pageProps} />,
    purchases: <Purchases {...pageProps} />,
    farming: <Farming {...pageProps} />,
    history: <SalesHistory {...pageProps} />,
    settings: <Settings {...pageProps} />,
  }

  return (
    <>
      <Shell activePage={activePage} onNavigate={navigate} user={session.user} onSignOut={signOut}>
        {dataLoading ? <LoadingScreen /> : appError ? (
          <Card className="error-card">
            <span><AlertCircle size={24} /></span>
            <div><h1>We couldn’t load your tracker</h1><p>{appError}</p><Button onClick={() => loadBusinessData(session.user.id)}><RefreshCw size={17} />Try again</Button></div>
          </Card>
        ) : pages[activePage] || pages.dashboard}
      </Shell>

      {toast && (
        <div className={`toast toast--${toast.type}`} role={toast.type === 'error' ? 'alert' : 'status'}>
          <span>{toast.type === 'success' ? <CheckCircle2 size={19} /> : toast.type === 'error' ? <AlertCircle size={19} /> : <Info size={19} />}</span>
          <p>{toast.message}</p>
          <button aria-label="Dismiss message" onClick={() => setToast(null)}><X size={17} /></button>
        </div>
      )}
    </>
  )
}
