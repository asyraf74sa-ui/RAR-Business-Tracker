import { LoaderCircle, Search, Sparkles, X } from 'lucide-react'
import { formatMoney, formatQuantity } from '../lib/format.js'
import { CURRENCIES } from '../lib/constants.js'

export function Button({ children, variant = 'primary', size = 'default', loading = false, className = '', ...props }) {
  return (
    <button className={`button button--${variant} button--${size} ${className}`} disabled={loading || props.disabled} {...props}>
      {loading && <LoaderCircle aria-hidden="true" className="spin" size={17} />}
      {children}
    </button>
  )
}

export function IconButton({ label, children, className = '', ...props }) {
  return (
    <button className={`icon-button ${className}`} aria-label={label} title={label} {...props}>
      {children}
    </button>
  )
}

export function Card({ children, className = '', as: Tag = 'section' }) {
  return <Tag className={`card ${className}`}>{children}</Tag>
}

export function Field({ label, hint, error, className = '', children }) {
  return (
    <label className={`field ${className}`}>
      <span className="field__label">{label}</span>
      {children}
      {(error || hint) && <span className={`field__hint ${error ? 'field__hint--error' : ''}`}>{error || hint}</span>}
    </label>
  )
}

export function PageHeader({ eyebrow, title, description, action }) {
  return (
    <header className="page-header">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {description && <p className="page-header__description">{description}</p>}
      </div>
      {action && <div className="page-header__action">{action}</div>}
    </header>
  )
}

export function SectionHeading({ title, description, action }) {
  return (
    <div className="section-heading">
      <div>
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      {action}
    </div>
  )
}

export function MetricCard({ label, value, detail, icon: Icon, tone = 'default' }) {
  return (
    <Card className={`metric metric--${tone}`}>
      <div className="metric__icon">{Icon && <Icon size={20} aria-hidden="true" />}</div>
      <div>
        <span className="metric__label">{label}</span>
        <strong className="metric__value">{value}</strong>
        {detail && <span className="metric__detail">{detail}</span>}
      </div>
    </Card>
  )
}

export function CurrencyStrip({ totals, emptyLabel = 'No activity' }) {
  const hasAny = CURRENCIES.some((currency) => Number(totals?.[currency]) !== 0)
  return (
    <div className="currency-strip">
      {CURRENCIES.map((currency) => (
        <div className="currency-strip__item" key={currency}>
          <span>{currency}</span>
          <strong>{hasAny ? formatMoney(totals?.[currency] || 0, currency) : formatMoney(0, currency)}</strong>
        </div>
      ))}
      {!hasAny && <span className="sr-only">{emptyLabel}</span>}
    </div>
  )
}

export function EmptyState({ title, description, icon: Icon = Sparkles, action }) {
  return (
    <div className="empty-state">
      <div className="empty-state__icon"><Icon size={22} /></div>
      <strong>{title}</strong>
      {description && <p>{description}</p>}
      {action}
    </div>
  )
}

export function LoadingScreen({ label = 'Loading your business…' }) {
  return (
    <div className="loading-screen" role="status">
      <div className="brand-mark brand-mark--large">R</div>
      <LoaderCircle className="spin" size={24} />
      <span>{label}</span>
    </div>
  )
}

export function SearchInput({ value, onChange, placeholder = 'Search…' }) {
  return (
    <label className="search-input">
      <Search size={17} aria-hidden="true" />
      <span className="sr-only">Search</span>
      <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
    </label>
  )
}

export function StockPill({ value }) {
  const amount = Number(value) || 0
  return <span className={`stock-pill ${amount <= 0 ? 'stock-pill--empty' : ''}`}>{formatQuantity(amount)} in stock</span>
}

export function StatusBadge({ children, tone = 'neutral' }) {
  return <span className={`status-badge status-badge--${tone}`}>{children}</span>
}

export function Dialog({ open, title, description, onClose, children }) {
  if (!open) return null
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
        <div className="dialog__header">
          <div>
            <h2 id="dialog-title">{title}</h2>
            {description && <p>{description}</p>}
          </div>
          <IconButton label="Close" onClick={onClose}><X size={18} /></IconButton>
        </div>
        {children}
      </section>
    </div>
  )
}
