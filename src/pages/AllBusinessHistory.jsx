import { useMemo, useState } from 'react'
import { CalendarRange, ReceiptText } from 'lucide-react'
import { Card, EmptyState, Field, PageHeader, StatusBadge } from '../components/ui.jsx'
import { filterRowsByDate, salesForWorkspace } from '../lib/business-workspaces.js'
import { formatDateTime, formatMoney } from '../lib/format.js'

export default function AllBusinessHistory({ data }) {
  const [filters, setFilters] = useState({ from: '', to: '', game: 'ALL' })
  const rows = useMemo(() => filterRowsByDate(salesForWorkspace(data, 'all'), 'sold_at', filters.from, filters.to)
    .filter((sale) => filters.game === 'ALL' || sale.game === filters.game)
    .sort((left, right) => new Date(right.sold_at) - new Date(left.sold_at)), [data, filters])

  return (
    <div className="page-stack">
      <PageHeader eyebrow="All Business" title="Financial history" description="RAR and MR wallet activity together, with game identity kept visible." />
      <Card className="history-filter-card">
        <CalendarRange size={19} />
        <Field label="From"><input type="date" value={filters.from} onChange={(event) => setFilters((current) => ({ ...current, from: event.target.value }))} /></Field>
        <Field label="To"><input type="date" value={filters.to} onChange={(event) => setFilters((current) => ({ ...current, to: event.target.value }))} /></Field>
        <Field label="Game"><select value={filters.game} onChange={(event) => setFilters((current) => ({ ...current, game: event.target.value }))}><option>ALL</option><option>RAR</option><option>MR</option></select></Field>
      </Card>
      <section className="native-list financial-history-list">
        {rows.length === 0 ? <EmptyState title="No matching financial activity" description="Adjust the date or game filters." icon={ReceiptText} /> : rows.map((sale) => (
          <article key={`${sale.game}-${sale.id}`}>
            <span className={`game-orb game-orb--${sale.game.toLowerCase()}`}>{sale.game.slice(0, 1)}</span>
            <div><span><StatusBadge tone={sale.game === 'RAR' ? 'success' : 'neutral'}>{sale.game}</StatusBadge><strong>{sale.platform}</strong></span><small>{formatDateTime(sale.sold_at)}{sale.notes ? ` · ${sale.notes}` : ''}</small></div>
            <div><strong>{formatMoney(sale.net_credit, sale.currency)}</strong><small>Fee {formatMoney(sale.platform_fee, sale.currency)}</small></div>
          </article>
        ))}
      </section>
    </div>
  )
}
