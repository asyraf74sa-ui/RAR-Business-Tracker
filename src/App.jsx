import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { AlertCircle, CheckCircle2, Info, RefreshCw, X } from 'lucide-react'
import AuthPage from './components/AuthPage.jsx'
import Shell from './components/Shell.jsx'
import { Button, Card, LoadingScreen } from './components/ui.jsx'
import { DEFAULT_PLATFORMS, INITIAL_ITEMS } from './lib/constants.js'
import { WORKSPACE_NAVIGATION } from './lib/business-workspaces.js'
import { readableError, supabase } from './lib/supabase.js'
import { selectAllRows } from './lib/supabase-pagination.js'

const Dashboard = lazy(() => import('./pages/Dashboard.jsx'))
const AllBusinessHistory = lazy(() => import('./pages/AllBusinessHistory.jsx'))
const Farming = lazy(() => import('./pages/Farming.jsx'))
const Gems = lazy(() => import('./pages/Gems.jsx'))
const Inventory = lazy(() => import('./pages/Inventory.jsx'))
const MRHistory = lazy(() => import('./pages/MRHistory.jsx'))
const MRInventory = lazy(() => import('./pages/MRInventory.jsx'))
const MROperations = lazy(() => import('./pages/MROperations.jsx'))
const MRSale = lazy(() => import('./pages/MRSale.jsx'))
const MRSettings = lazy(() => import('./pages/MRSettings.jsx'))
const Purchases = lazy(() => import('./pages/Purchases.jsx'))
const RecordSale = lazy(() => import('./pages/RecordSale.jsx'))
const SalesHistory = lazy(() => import('./pages/SalesHistory.jsx'))
const Settings = lazy(() => import('./pages/Settings.jsx'))
const UnifiedDashboard = lazy(() => import('./pages/UnifiedDashboard.jsx'))

const emptyData = {
  items: [],
  platforms: [],
  sales: [],
  saleItems: [],
  inventoryEvents: [],
  farmConfig: null,
  mr: {
    items: [],
    setFamilies: [],
    setStock: [],
    sales: [],
    saleItems: [],
    inventoryEvents: [],
    itemPrices: [],
  },
}

export default function App() {
  const [session, setSession] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [dataLoading, setDataLoading] = useState(false)
  const [data, setData] = useState(emptyData)
  const [appError, setAppError] = useState(null)
  const [workspace, setWorkspace] = useState(() => {
    const saved = localStorage.getItem('business-workspace')
    return ['all', 'rar', 'mr'].includes(saved) ? saved : 'all'
  })
  const [activePages, setActivePages] = useState(() => ({
    all: localStorage.getItem('business-active-page-all') || 'dashboard',
    rar: localStorage.getItem('rar-active-page') || 'dashboard',
    mr: localStorage.getItem('business-active-page-mr') || 'dashboard',
  }))
  const [toast, setToast] = useState(null)
  const toastTimer = useRef(null)
  const loadVersion = useRef(0)
  const defaultsInFlight = useRef(new Map())

  const notify = useCallback((type, message) => {
    window.clearTimeout(toastTimer.current)
    setToast({ type, message })
    toastTimer.current = window.setTimeout(() => setToast(null), type === 'error' ? 8_000 : 4_500)
  }, [])

  const ensureDefaults = useCallback(async (userId) => {
    if (defaultsInFlight.current.has(userId)) return defaultsInFlight.current.get(userId)

    const setup = (async () => {
      const { error } = await supabase.rpc('rar_ensure_defaults', {
        p_items: INITIAL_ITEMS,
        p_platforms: DEFAULT_PLATFORMS,
      })
      if (error) throw new Error(`Private tracker setup failed: ${readableError(error)}`)
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
      await ensureDefaults(userId)

      const requests = await Promise.all([
        supabase.from('rar_items').select('*').order('name'),
        supabase.from('rar_platforms').select('*').order('name'),
        selectAllRows(() => supabase.from('rar_sales').select('*').order('sold_at', { ascending: false })),
        selectAllRows(() => supabase.from('rar_sale_items').select('*').order('created_at', { ascending: false })),
        selectAllRows(() => supabase.from('rar_inventory_events').select('*').order('event_at', { ascending: false })),
        supabase.from('rar_farm_config').select('*').maybeSingle(),
        supabase.from('mr_items').select('*').order('category').order('name'),
        supabase.from('mr_set_families').select('*').order('name'),
        supabase.from('mr_set_stock_summary').select('*').order('name'),
        selectAllRows(() => supabase.from('mr_sales').select('*').order('sold_at', { ascending: false })),
        selectAllRows(() => supabase.from('mr_sale_items').select('*').order('created_at', { ascending: false })),
        selectAllRows(() => supabase.from('mr_inventory_events').select('*').order('event_at', { ascending: false })),
        supabase.from('mr_item_prices').select('*').order('updated_at', { ascending: false }),
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
        mr: {
          items: requests[6].data || [],
          setFamilies: requests[7].data || [],
          setStock: requests[8].data || [],
          sales: requests[9].data || [],
          saleItems: requests[10].data || [],
          inventoryEvents: requests[11].data || [],
          itemPrices: requests[12].data || [],
        },
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

  const navigate = (page, nextWorkspace = workspace) => {
    const validPage = WORKSPACE_NAVIGATION[nextWorkspace]?.some((entry) => entry.id === page) ? page : 'dashboard'
    setWorkspace(nextWorkspace)
    setActivePages((current) => ({ ...current, [nextWorkspace]: validPage }))
    localStorage.setItem('business-workspace', nextWorkspace)
    localStorage.setItem(`business-active-page-${nextWorkspace}`, validPage)
    if (nextWorkspace === 'rar') localStorage.setItem('rar-active-page', validPage)
  }

  const switchWorkspace = (nextWorkspace) => navigate(activePages[nextWorkspace] || 'dashboard', nextWorkspace)

  const refresh = useCallback(() => session ? loadBusinessData(session.user.id, { quiet: true }) : Promise.resolve(), [session, loadBusinessData])

  if (authLoading) return <LoadingScreen label="Restoring your session…" />
  if (!session) return <AuthPage onAuthenticate={authenticate} />

  const activePage = activePages[workspace] || 'dashboard'
  const pageProps = { data, refresh, notify, user: session.user, onNavigate: navigate }
  const rarPages = {
    dashboard: <Dashboard {...pageProps} />,
    sale: <RecordSale {...pageProps} />,
    inventory: <Inventory {...pageProps} />,
    gems: <Gems {...pageProps} />,
    purchases: <Purchases {...pageProps} />,
    farming: <Farming {...pageProps} />,
    history: <SalesHistory {...pageProps} />,
    settings: <Settings {...pageProps} />,
  }
  const mrPages = {
    dashboard: <UnifiedDashboard {...pageProps} scope="mr" />,
    inventory: <MRInventory {...pageProps} />,
    sale: <MRSale {...pageProps} />,
    operations: <MROperations {...pageProps} />,
    history: <MRHistory {...pageProps} />,
    settings: <MRSettings {...pageProps} />,
  }
  const allPages = {
    dashboard: <UnifiedDashboard {...pageProps} scope="all" />,
    history: <AllBusinessHistory {...pageProps} />,
  }
  const pages = workspace === 'rar' ? rarPages : workspace === 'mr' ? mrPages : allPages

  return (
    <>
      <Shell workspace={workspace} onWorkspaceChange={switchWorkspace} activePage={activePage} onNavigate={navigate} user={session.user} onSignOut={signOut}>
        {dataLoading ? <LoadingScreen /> : appError ? (
          <Card className="error-card">
            <span><AlertCircle size={24} /></span>
            <div><h1>We couldn’t load your tracker</h1><p>{appError}</p><Button onClick={() => loadBusinessData(session.user.id)}><RefreshCw size={17} />Try again</Button></div>
          </Card>
        ) : <Suspense fallback={<LoadingScreen label="Opening workspace…" />}>{pages[activePage] || pages.dashboard}</Suspense>}
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
