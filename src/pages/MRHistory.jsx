import { useMemo, useState } from 'react'
import { ArrowDownLeft, ArrowUpRight, CalendarRange, History, ReceiptText } from 'lucide-react'
import { Card, EmptyState, Field, PageHeader, StatusBadge } from '../components/ui.jsx'
import { filterRowsByDate } from '../lib/business-workspaces.js'
import { formatDateTime, formatMoney, formatQuantity, toNumber } from '../lib/format.js'

export default function MRHistory({ data }) {
  const [tab, setTab] = useState('sales')
  const [dates, setDates] = useState({ from: '', to: '' })
  const itemMap = useMemo(() => new Map(data.mr.items.map((item) => [item.id, item])), [data.mr.items])
  const saleLines = useMemo(() => data.mr.saleItems.reduce((map, line) => {
    const rows = map.get(line.sale_id) || []
    rows.push(line)
    map.set(line.sale_id, rows)
    return map
  }, new Map()), [data.mr.saleItems])
  const sales = useMemo(() => filterRowsByDate(data.mr.sales, 'sold_at', dates.from, dates.to), [data.mr.sales, dates])
  const events = useMemo(() => filterRowsByDate(data.mr.inventoryEvents, 'event_at', dates.from, dates.to), [data.mr.inventoryEvents, dates])

  return (
    <div className="page-stack">
      <PageHeader eyebrow="MR History" title="My Restaurant activity" description="Sales and operational inventory events stay inside the MR workspace." />
      <Card className="history-filter-card"><CalendarRange size={19} /><Field label="From"><input type="date" value={dates.from} onChange={(event) => setDates((current) => ({ ...current, from: event.target.value }))} /></Field><Field label="To"><input type="date" value={dates.to} onChange={(event) => setDates((current) => ({ ...current, to: event.target.value }))} /></Field><div className="mode-tabs"><button className={tab === 'sales' ? 'is-active' : ''} onClick={() => setTab('sales')}>Sales</button><button className={tab === 'operations' ? 'is-active' : ''} onClick={() => setTab('operations')}>Operations</button></div></Card>
      <section className="native-list">
        {tab === 'sales' ? (sales.length ? sales.map((sale) => {
          const lines = saleLines.get(sale.id) || []
          return <article key={sale.id}><span className="game-orb game-orb--mr">M</span><div><span><StatusBadge tone="neutral">MR sale</StatusBadge><strong>{sale.platform}</strong></span><small>{formatDateTime(sale.sold_at)} · {lines.map((line) => `${formatQuantity(line.quantity)} ${itemMap.get(line.item_id)?.name || 'item'}`).join(', ') || 'No lines'}</small></div><div><strong>{formatMoney(sale.net_credit, sale.currency)}</strong><small>Fee {formatMoney(sale.platform_fee, sale.currency)}</small></div></article>
        }) : <EmptyState title="No MR sales in this range" description="Recorded MR sales will appear here." icon={ReceiptText} />) : (events.length ? events.map((event) => {
          const incoming = toNumber(event.quantity_delta) >= 0
          return <article key={event.id}><span className={`event-direction ${incoming ? 'is-in' : 'is-out'}`}>{incoming ? <ArrowDownLeft size={16} /> : <ArrowUpRight size={16} />}</span><div><span><StatusBadge>{event.event_type.replaceAll('_', ' ')}</StatusBadge><strong>{itemMap.get(event.item_id)?.name || 'MR item'}</strong></span><small>{formatDateTime(event.event_at)}{event.notes ? ` · ${event.notes}` : ''}</small></div><div><strong>{incoming ? '+' : ''}{formatQuantity(event.quantity_delta)}</strong><small>{event.cash_currency ? formatMoney(event.cash_amount, event.cash_currency) : 'No financial effect'}</small></div></article>
        }) : <EmptyState title="No MR operations in this range" description="Purchases, trades, and stock events will appear here." icon={History} />)}
      </section>
    </div>
  )
}
