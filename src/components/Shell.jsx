import { useState } from 'react'
import {
  BarChart3,
  Boxes,
  ChevronDown,
  Coins,
  History,
  Leaf,
  LogOut,
  Menu,
  PackagePlus,
  PlusCircle,
  Settings,
  X,
} from 'lucide-react'
import { IconButton } from './ui.jsx'

const navigation = [
  { id: 'dashboard', label: 'Dashboard', mobileLabel: 'Home', icon: BarChart3 },
  { id: 'sale', label: 'Record sale', mobileLabel: 'Sale', icon: PlusCircle },
  { id: 'inventory', label: 'Stocktake', mobileLabel: 'Stock', icon: Boxes },
  { id: 'gems', label: 'Gems', mobileLabel: 'Gems', icon: Coins },
  { id: 'purchases', label: 'Purchases', icon: PackagePlus },
  { id: 'farming', label: 'Farming', icon: Leaf },
  { id: 'history', label: 'Sales history', icon: History },
  { id: 'settings', label: 'Items & settings', icon: Settings },
]

const primaryMobile = navigation.slice(0, 4)
const secondaryMobile = navigation.slice(4)

export default function Shell({ activePage, onNavigate, user, onSignOut, children }) {
  const [moreOpen, setMoreOpen] = useState(false)
  const current = navigation.find((item) => item.id === activePage) || navigation[0]

  const navigate = (id) => {
    onNavigate(id)
    setMoreOpen(false)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">R</span>
          <div><strong>RAR</strong><span>Business tracker</span></div>
        </div>

        <nav className="sidebar__nav" aria-label="Main navigation">
          {navigation.map(({ id, label, icon: Icon }) => (
            <button key={id} className={activePage === id ? 'is-active' : ''} onClick={() => navigate(id)}>
              <Icon size={19} aria-hidden="true" />
              <span>{label}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar__account">
          <div className="account-avatar">{user?.email?.slice(0, 1).toUpperCase() || 'R'}</div>
          <div className="sidebar__account-copy"><strong>Restaurant owner</strong><span>{user?.email}</span></div>
          <IconButton label="Sign out" onClick={onSignOut}><LogOut size={18} /></IconButton>
        </div>
      </aside>

      <div className="app-main">
        <header className="mobile-header">
          <div className="brand">
            <span className="brand-mark">R</span>
            <div><strong>{current.label}</strong><span>RAR Tracker</span></div>
          </div>
          <button className="mobile-account" onClick={() => setMoreOpen(true)} aria-label="Open account and navigation menu">
            {user?.email?.slice(0, 1).toUpperCase() || 'R'}
          </button>
        </header>

        <main className="page-content">{children}</main>
      </div>

      <nav className="bottom-nav" aria-label="Mobile navigation">
        {primaryMobile.map(({ id, mobileLabel, icon: Icon }) => (
          <button key={id} className={activePage === id ? 'is-active' : ''} onClick={() => navigate(id)}>
            <Icon size={20} aria-hidden="true" />
            <span>{mobileLabel}</span>
          </button>
        ))}
        <button className={secondaryMobile.some((item) => item.id === activePage) ? 'is-active' : ''} onClick={() => setMoreOpen(true)}>
          <Menu size={20} aria-hidden="true" />
          <span>More</span>
        </button>
      </nav>

      {moreOpen && (
        <div className="sheet-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setMoreOpen(false)}>
          <section className="more-sheet" role="dialog" aria-modal="true" aria-labelledby="more-title">
            <div className="more-sheet__handle" />
            <div className="more-sheet__header">
              <div><span className="eyebrow">Signed in as</span><h2 id="more-title">{user?.email}</h2></div>
              <IconButton label="Close menu" onClick={() => setMoreOpen(false)}><X size={19} /></IconButton>
            </div>
            <div className="more-sheet__links">
              {secondaryMobile.map(({ id, label, icon: Icon }) => (
                <button key={id} className={activePage === id ? 'is-active' : ''} onClick={() => navigate(id)}>
                  <span><Icon size={20} />{label}</span><ChevronDown size={16} className="rotate-negative" />
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
