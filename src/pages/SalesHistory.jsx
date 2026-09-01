import { useMemo, useState } from 'react'
import { CalendarDays, Filter, History, PackageSearch, ReceiptText, X } from 'lucide-react'
import { Button, Card, CurrencyStrip, EmptyState, PageHeader, SearchInput, SectionHeading, StatusBadge } from '../components/ui.jsx'
import { CLASSIFICATIONS, CURRENCIES } from '../lib/constants.js'
import { formatDateTime, formatMoney, formatQuantity, groupCurrencyTotals, toNumber } from '../lib/format.js'

export default function SalesHistory({ data, onNavigate }) {
  const [filters, setFilters] = useState({ search: '', platform: '', currency: '', classification: '', from: '', to: '' })
  const itemMap = useMemo(() => new Map(data.items.map((item) => [item.id, item])), [data.items])

  const rows = useMemo(() => data.sales.map((sale) => ({
    ...sale,
    lines: data.saleItems.filter((line) => line.sale_id === sale.id).map((line) => ({ ...line, item: itemMap.get(line.item_id) })),
  })).filter((sale) => {
    const haystack = `${sale.platform} ${sale.notes || ''} ${sale.lines.map((line) => line.item?.name || '').join(' ')}`.toLowerCase()
    if (filters.search && !haystack.includes(filters.search.toLowerCase())) return false
    if (filters.platform && sale.platform !== filters.platform) return false
    if (filters.currency && sale.currency !== filters.currency) return false
    if (filters.classification && sale.classification !== filters.classification) return false
    const date = new Date(sale.sold_at)
    if (filters.from && date < new Date(`${filters.from}T00:00:00`)) return false
    if (filters.to && date > new Date(`${filters.to}T23:59:59.999`)) return false
    return true
  }), [data.sales, data.saleItems, itemMap, filters])

  const netTotals = useMemo(() => groupCurrencyTotals(rows, (sale) => sale.net_credit), [rows])
  const hasFilters = Object.values(filters).some(Boolean)
  const update = (key, value) => setFilters((current) => ({ ...current, [key]: value }))
  const reset = () => setFilters({ search: '', platform: '', currency: '', classification: '', from: '', to: '' })

  return (
    <div className="page-stack">
      <PageHeader eyebrow="Sales ledger" title="Sales history" description="Search every bundle and review net, fee, and gross without combining currencies." action={<Button onClick={() => onNavigate('sale')}>Record new sale</Button>} />

      <Card className="history-summary">
        <div><span>Filtered net sales</span><strong>{rows.length} {rows.length === 1 ? 'sale' : 'sales'}</strong></div>
        <CurrencyStrip totals={netTotals} />
      </Card>

      <Card className="filters-card">
        <div className="filters-card__top">
          <SearchInput value={filters.search} onChange={(value) => update('search', value)} placeholder="Search platform, item, or notes…" />
          {hasFilters && <Button variant="ghost" size="small" onClick={reset}><X size={15} />Clear</Button>}
        </div>
        <div className="filters-grid">
          <label><span>Platform</span><select value={filters.platform} onChange={(event) => update('platform', event.target.value)}><option value="">All platforms</option>{data.platforms.map((platform) => <option key={platform.id}>{platform.name}</option>)}</select></label>
          <label><span>Currency</span><select value={filters.currency} onChange={(event) => update('currency', event.target.value)}><option value="">All currencies</option>{CURRENCIES.map((currency) => <option key={currency}>{currency}</option>)}</select></label>
          <label><span>Classification</span><select value={filters.classification} onChange={(event) => update('classification', event.target.value)}><option value="">All types</option>{CLASSIFICATIONS.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label>
          <label><span>From</span><input type="date" value={filters.from} onChange={(event) => update('from', event.target.value)} /></label>
          <label><span>To</span><input type="date" value={filters.to} onChange={(event) => update('to', event.target.value)} /></label>
        </div>
      </Card>

      <Card className="sales-table-card">
        <SectionHeading title="Transactions" description={`${rows.length} matching ${rows.length === 1 ? 'sale' : 'sales'}.`} action={<Filter size={19} />} />
        {rows.length === 0 ? <EmptyState title="No matching sales" description={hasFilters ? 'Try removing one or more filters.' : 'Record your first item or Gem sale.'} icon={PackageSearch} action={hasFilters ? <Button variant="secondary" size="small" onClick={reset}>Reset filters</Button> : undefined} /> : (
          <>
            <div className="sales-table-wrap">
              <table className="sales-table">
                <thead><tr><th>Date</th><th>Platform</th><th>Bundle contents</th><th>Net</th><th>Fee</th><th>Gross</th><th>Type</th></tr></thead>
                <tbody>
                  {rows.map((sale) => <tr key={sale.id}><td><strong>{formatDateTime(sale.sold_at, { dateOnly: true })}</strong><span>{new Intl.DateTimeFormat(undefined, { timeStyle: 'short' }).format(new Date(sale.sold_at))}</span></td><td><span className="platform-chip">{sale.platform.slice(0, 1)}</span>{sale.platform}</td><td><div className="bundle-tags">{sale.lines.map((line) => <span key={line.id}>{formatQuantity(line.quantity)}× {line.item?.name || 'Item'}</span>)}</div>{sale.notes && <small className="table-note">{sale.notes}</small>}</td><td><strong>{formatMoney(sale.net_credit, sale.currency)}</strong><span>{sale.currency}</span></td><td>{formatMoney(sale.platform_fee, sale.currency)}</td><td><strong>{formatMoney(toNumber(sale.net_credit) + toNumber(sale.platform_fee), sale.currency)}</strong></td><td><StatusBadge tone={sale.classification === 'normal' ? 'success' : sale.classification === 'unknown_price' ? 'warning' : 'neutral'}>{sale.classification.replace('_', ' ')}</StatusBadge></td></tr>)}
                </tbody>
              </table>
            </div>
            <div className="sales-cards">
              {rows.map((sale) => <article className="sale-history-card" key={sale.id}><header><div><span className="platform-chip">{sale.platform.slice(0, 1)}</span><div><strong>{sale.platform}</strong><small><CalendarDays size={13} />{formatDateTime(sale.sold_at)}</small></div></div><StatusBadge tone={sale.classification === 'normal' ? 'success' : 'neutral'}>{sale.classification.replace('_', ' ')}</StatusBadge></header><div className="sale-history-card__bundle">{sale.lines.map((line) => <span key={line.id}>{formatQuantity(line.quantity)}× {line.item?.name || 'Item'}</span>)}</div><div className="sale-history-card__money"><span>Net<strong>{formatMoney(sale.net_credit, sale.currency)}</strong></span><span>Fee<strong>{formatMoney(sale.platform_fee, sale.currency)}</strong></span><span>Gross<strong>{formatMoney(toNumber(sale.net_credit) + toNumber(sale.platform_fee), sale.currency)}</strong></span></div>{sale.notes && <p><ReceiptText size={14} />{sale.notes}</p>}</article>)}
            </div>
          </>
        )}
      </Card>
    </div>
  )
}
