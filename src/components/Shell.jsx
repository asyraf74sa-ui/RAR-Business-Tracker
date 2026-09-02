import { useEffect, useState } from 'react'
import {
  Boxes,
  ChevronRight,
  Gem,
  History,
  Home,
  Leaf,
  LogOut,
  Menu,
  PackagePlus,
  ReceiptText,
  Settings2,
  X,
} from 'lucide-react'
import { IconButton } from './ui.jsx'

const navigation = [
  { id: 'dashboard', label: 'Dashboard', mobileLabel: 'Home', icon: Home },
  { id: 'inventory', label: 'Stock', mobileLabel: 'Stock', icon: Boxes },
  { id: 'sale', label: 'Sale', mobileLabel: 'Sale', icon: ReceiptText },
  { id: 'gems', label: 'Gems', icon: Gem },
  { id: 'purchases', label: 'Purchases', icon: PackagePlus },
  { id: 'farming', label: 'Farm', icon: Leaf },
  { id: 'history', label: 'History', mobileLabel: 'History', icon: History },
  { id: 'settings', label: 'Prices & setup', icon: Settings2 },
]

const primaryMobileIds = new Set(['dashboard', 'inventory', 'sale', 'history'])
const primaryMobile = navigation.filter((item) => primaryMobileIds.has(item.id))
const secondaryMobile = navigation.filter((item) => !primaryMobileIds.has(item.id))

export default function Shell({ activePage, onNavigate, user, onSignOut, children }) {
  const [moreOpen, setMoreOpen] = useState(false)
  const current = navigation.find((item) => item.id === activePage) || navigation[0]

  useEffect(() => {
    if (!moreOpen) return undefined
    const closeOnEscape = (event) => event.key === 'Escape' && setMoreOpen(false)
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [moreOpen])

  const navigate = (id) => {
    onNavigate(id)
    setMoreOpen(false)
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' })
  }

  return (
    <div className={`app-shell app-shell--${activePage}`}>
      <header className="app-header">
        <div className="app-header__inner">
          <div className="brand brand--product" aria-label="RAR Business Tracker, Run a Restaurant">
            <span className="brand-mark" aria-hidden="true">R</span>
            <div><strong>RAR Business Tracker</strong><span>Run a Restaurant</span></div>
          </div>

          <nav className="desktop-nav" aria-label="Main navigation">
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
          <span className="brand-mark" aria-hidden="true">R</span>
          <div><strong>{current.label}</strong><span>RAR Business Tracker</span></div>
        </div>
        <button className="mobile-account" onClick={() => setMoreOpen(true)} aria-label="Open account and navigation menu">
          {user?.email?.slice(0, 1).toUpperCase() || 'R'}
        </button>
      </header>

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
        <button className={secondaryMobile.some((item) => item.id === activePage) ? 'is-active' : ''} aria-expanded={moreOpen} onClick={() => setMoreOpen(true)}>
          <span className="bottom-nav__icon"><Menu size={20} aria-hidden="true" /></span>
          <span>More</span>
        </button>
      </nav>

      {moreOpen && (
        <div className="sheet-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setMoreOpen(false)}>
          <section className="more-sheet" role="dialog" aria-modal="true" aria-labelledby="more-title">
            <div className="more-sheet__handle" />
            <div className="more-sheet__header">
              <div><span className="eyebrow">More tools</span><h2 id="more-title">Run your restaurant</h2><p>{user?.email}</p></div>
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
