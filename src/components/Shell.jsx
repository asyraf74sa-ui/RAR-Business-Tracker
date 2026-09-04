import { useEffect, useState } from 'react'
import {
  Boxes,
  ChartNoAxesCombined,
  ChevronRight,
  Gem,
  History,
  Home,
  ArrowRightLeft,
  Leaf,
  LogOut,
  Menu,
  PackagePlus,
  ReceiptText,
  Settings2,
  X,
} from 'lucide-react'
import { IconButton } from './ui.jsx'
import { WORKSPACES, WORKSPACE_NAVIGATION } from '../lib/business-workspaces.js'

const icons = { dashboard: Home, inventory: Boxes, sale: ReceiptText, gems: Gem, purchases: PackagePlus, farming: Leaf, operations: ArrowRightLeft, history: History, settings: Settings2 }

export default function Shell({ workspace, onWorkspaceChange, activePage, onNavigate, user, onSignOut, children }) {
  const [moreOpen, setMoreOpen] = useState(false)
  const navigation = WORKSPACE_NAVIGATION[workspace].map((item) => ({ ...item, icon: icons[item.id] || ChartNoAxesCombined }))
  const current = navigation.find((item) => item.id === activePage) || navigation[0]
  const primaryMobile = navigation.filter((item) => item.mobileLabel).slice(0, 4)
  const secondaryMobile = navigation.filter((item) => !primaryMobile.includes(item))
  const workspaceMeta = WORKSPACES.find((entry) => entry.id === workspace)

  useEffect(() => {
    if (!moreOpen) return undefined
    const closeOnEscape = (event) => event.key === 'Escape' && setMoreOpen(false)
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [moreOpen])

  const scrollToTop = () => {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' })
  }

  const navigate = (id) => {
    onNavigate(id)
    setMoreOpen(false)
    scrollToTop()
  }

  const switchWorkspace = (id) => {
    onWorkspaceChange(id)
    setMoreOpen(false)
    scrollToTop()
  }

  return (
    <div className={`app-shell app-shell--${activePage} app-shell--workspace-${workspace}`}>
      <header className="app-header">
        <div className="app-header__inner">
          <div className="brand brand--product" aria-label="Business Tracker">
            <span className="brand-mark" aria-hidden="true">B</span>
            <div><strong>Business Tracker</strong><span>{workspaceMeta.description}</span></div>
          </div>

          <WorkspaceSwitcher workspace={workspace} onChange={switchWorkspace} />

          <nav className="desktop-nav" aria-label={`${workspaceMeta.label} navigation`}>
            {navigation.map(({ id, label, icon: Icon }) => (
              <button key={id} className={activePage === id ? 'is-active' : ''} aria-current={activePage === id ? 'page' : undefined} onClick={() => navigate(id)}>
                <Icon size={17} aria-hidden="true" />
                <span>{label}</span>
              </button>
            ))}
          </nav>

          <div className="app-account">
            <div className="account-avatar" aria-hidden="true">{user?.email?.slice(0, 1).toUpperCase() || 'R'}</div>
            <div className="app-account__copy"><strong>Restaurant owner</strong><span>{user?.email}</span></div>
            <IconButton label="Sign out" onClick={onSignOut}><LogOut size={18} /></IconButton>
          </div>
        </div>
      </header>

      <header className="mobile-header">
        <div className="brand brand--product">
          <span className="brand-mark" aria-hidden="true">{workspace === 'all' ? 'A' : workspace.slice(0, 1).toUpperCase()}</span>
          <div><strong>{current.label}</strong><span>{workspaceMeta.label}</span></div>
        </div>
        <button className="mobile-account" onClick={() => setMoreOpen(true)} aria-label="Open account and navigation menu">
          {user?.email?.slice(0, 1).toUpperCase() || 'R'}
        </button>
      </header>

      <div className="mobile-workspace-bar"><WorkspaceSwitcher workspace={workspace} onChange={switchWorkspace} /></div>

      <main className="page-content">
        <div className="page-transition" key={activePage}>{children}</div>
      </main>

      <nav className="bottom-nav" aria-label="Mobile navigation">
        {primaryMobile.map(({ id, mobileLabel, icon: Icon }) => (
          <button key={id} className={activePage === id ? 'is-active' : ''} aria-current={activePage === id ? 'page' : undefined} onClick={() => navigate(id)}>
            <span className="bottom-nav__icon"><Icon size={20} aria-hidden="true" /></span>
            <span>{mobileLabel}</span>
          </button>
        ))}
        {secondaryMobile.length > 0 && <button className={secondaryMobile.some((item) => item.id === activePage) ? 'is-active' : ''} aria-expanded={moreOpen} onClick={() => setMoreOpen(true)}>
          <span className="bottom-nav__icon"><Menu size={20} aria-hidden="true" /></span>
          <span>More</span>
        </button>}
      </nav>

      {moreOpen && (
        <div className="sheet-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setMoreOpen(false)}>
          <section className="more-sheet" role="dialog" aria-modal="true" aria-labelledby="more-title">
            <div className="more-sheet__handle" />
            <div className="more-sheet__header">
              <div><span className="eyebrow">{workspaceMeta.label}</span><h2 id="more-title">Workspace tools</h2><p>{user?.email}</p></div>
              <IconButton label="Close menu" onClick={() => setMoreOpen(false)}><X size={19} /></IconButton>
            </div>
            <div className="more-sheet__links">
              {secondaryMobile.map(({ id, label, icon: Icon }) => (
                <button key={id} className={activePage === id ? 'is-active' : ''} onClick={() => navigate(id)}>
                  <span><i><Icon size={19} /></i><b>{label}</b></span><ChevronRight size={17} aria-hidden="true" />
                </button>
              ))}
            </div>
            <button className="sheet-signout" onClick={onSignOut}><LogOut size={18} />Sign out</button>
          </section>
        </div>
      )}
    </div>
  )
}

function WorkspaceSwitcher({ workspace, onChange }) {
  return <div className="workspace-switcher" role="group" aria-label="Business workspace">{WORKSPACES.map((entry) => <button type="button" aria-pressed={workspace === entry.id} className={workspace === entry.id ? 'is-active' : ''} key={entry.id} onClick={() => onChange(entry.id)}><span>{entry.shortLabel}</span><small>{entry.id === 'all' ? 'Finance' : 'Operations'}</small></button>)}</div>
}
