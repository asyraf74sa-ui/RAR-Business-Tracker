import { useMemo } from 'react'
import { ArrowRight, Boxes, Coins, Leaf, Plus, ReceiptText, TrendingUp, WalletCards } from 'lucide-react'
import { Button, Card, CurrencyStrip, EmptyState, MetricCard, PageHeader, SectionHeading, StatusBadge } from '../components/ui.jsx'
import { CURRENCIES } from '../lib/constants.js'
import { formatDateTime, formatMoney, formatQuantity, groupCurrencyTotals, toNumber } from '../lib/format.js'

export default function Dashboard({ data, onNavigate }) {
  const { items, sales, saleItems, inventoryEvents } = data
  const gemItem = items.find((item) => item.kind === 'currency' && item.name.toLowerCase() === 'gems')
  const physicalItems = items.filter((item) => item.kind === 'item')
  const itemMap = useMemo(() => new Map(items.map((item) => [item.id, item])), [items])

  const netTotals = useMemo(() => groupCurrencyTotals(sales, (sale) => sale.net_credit), [sales])
  const feeTotals = useMemo(() => groupCurrencyTotals(sales, (sale) => sale.platform_fee), [sales])
  const grossTotals = useMemo(() => groupCurrencyTotals(sales, (sale) => toNumber(sale.net_credit) + toNumber(sale.platform_fee)), [sales])

  const salesByPlatform = useMemo(() => {
    const grouped = new Map()
    sales.forEach((sale) => {
      if (!grouped.has(sale.platform)) grouped.set(sale.platform, Object.fromEntries(CURRENCIES.map((currency) => [currency, 0])))
      const currency = String(sale.currency).toUpperCase()
      if (CURRENCIES.includes(currency)) grouped.get(sale.platform)[currency] += toNumber(sale.net_credit)
    })
    return [...grouped.entries()].sort((a, b) => {
      const aCount = sales.filter((sale) => sale.platform === a[0]).length
      const bCount = sales.filter((sale) => sale.platform === b[0]).length
      return bCount - aCount
    })
  }, [sales])

  const bestSellers = useMemo(() => {
    const grouped = new Map()
    saleItems.forEach((line) => grouped.set(line.item_id, (grouped.get(line.item_id) || 0) + toNumber(line.quantity)))
    return [...grouped.entries()]
      .map(([id, quantity]) => ({ item: itemMap.get(id), quantity }))
      .filter(({ item }) => item)
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 5)
  }, [saleItems, itemMap])

  const recentSales = sales.slice(0, 5).map((sale) => ({
    ...sale,
    lines: saleItems.filter((line) => line.sale_id === sale.id),
  }))

  const farmOutput = useMemo(() => {
    const thirtyDaysAgo = Date.now() - 30 * 86_400_000
    const totals = new Map()
    inventoryEvents
      .filter((event) => event.event_type === 'farm' && new Date(event.event_at).getTime() >= thirtyDaysAgo)
      .forEach((event) => totals.set(event.item_id, (totals.get(event.item_id) || 0) + toNumber(event.quantity_delta)))
    return [...totals.entries()]
      .map(([id, quantity]) => ({ item: itemMap.get(id), quantity }))
      .filter(({ item }) => item)
      .sort((a, b) => b.quantity - a.quantity)
  }, [inventoryEvents, itemMap])

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Business overview"
        title="Your restaurant, at a glance"
        description="Live totals from your sales, inventory, gems, and farm activity."
        action={<Button onClick={() => onNavigate('sale')}><Plus size={18} />Record sale</Button>}
      />

      <div className="metrics-grid metrics-grid--top">
        <MetricCard label="Gem balance" value={formatQuantity(gemItem?.stock || 0)} detail="Available to spend or sell" icon={Coins} tone="gold" />
        <MetricCard label="Physical stock" value={formatQuantity(physicalItems.reduce((sum, item) => sum + toNumber(item.stock), 0))} detail={`${physicalItems.filter((item) => item.active).length} active item types`} icon={Boxes} tone="green" />
        <MetricCard label="Completed sales" value={formatQuantity(sales.length, 0)} detail={sales[0] ? `Last sale ${formatDateTime(sales[0].sold_at)}` : 'No sales recorded yet'} icon={ReceiptText} />
      </div>

      <div className="financial-grid">
        <Card className="financial-card financial-card--net">
          <div className="financial-card__title"><span><WalletCards size={19} /></span><div><strong>Net sales received</strong><small>Actual wallet credits</small></div></div>
          <CurrencyStrip totals={netTotals} />
        </Card>
        <Card className="financial-card">
          <div className="financial-card__title"><span><ReceiptText size={19} /></span><div><strong>Platform fees</strong><small>Kept separate by currency</small></div></div>
          <CurrencyStrip totals={feeTotals} />
        </Card>
        <Card className="financial-card">
          <div className="financial-card__title"><span><TrendingUp size={19} /></span><div><strong>Gross sales</strong><small>Net received + fees</small></div></div>
          <CurrencyStrip totals={grossTotals} />
        </Card>
      </div>

      <div className="dashboard-grid">
        <Card className="dashboard-panel dashboard-panel--wide">
          <SectionHeading title="Sales by platform" description="Net receipts remain separated by currency." />
          {salesByPlatform.length === 0 ? (
            <EmptyState title="No platform sales yet" description="Your first recorded sale will appear here." action={<Button variant="secondary" size="small" onClick={() => onNavigate('sale')}>Record a sale</Button>} />
          ) : (
            <div className="platform-sales">
              {salesByPlatform.map(([platform, totals]) => (
                <div className="platform-sales__row" key={platform}>
                  <div className="platform-sales__name"><span>{platform.slice(0, 1).toUpperCase()}</span><strong>{platform}</strong></div>
                  <div className="platform-sales__amounts">
                    {CURRENCIES.filter((currency) => totals[currency] !== 0).map((currency) => <span key={currency}><small>{currency}</small>{formatMoney(totals[currency], currency)}</span>)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card className="dashboard-panel">
          <SectionHeading title="Best-selling items" description="Ranked by units sold." />
          {bestSellers.length === 0 ? <EmptyState title="No best seller yet" description="Bundle items will be counted automatically." /> : (
            <ol className="rank-list">
              {bestSellers.map(({ item, quantity }, index) => (
                <li key={item.id}><span className="rank-list__number">{index + 1}</span><div><strong>{item.name}</strong><small>{item.kind === 'currency' ? 'Currency' : 'Item'}</small></div><b>{formatQuantity(quantity)} sold</b></li>
              ))}
            </ol>
          )}
        </Card>
      </div>

      <div className="dashboard-grid">
        <Card className="dashboard-panel dashboard-panel--wide">
          <SectionHeading title="Recent sales" description="Latest bundles and wallet credits." action={<button className="text-link" onClick={() => onNavigate('history')}>View all <ArrowRight size={15} /></button>} />
          {recentSales.length === 0 ? <EmptyState title="Your sales list is ready" description="Record single items, bundles, or Gems directly." /> : (
            <div className="recent-list">
              {recentSales.map((sale) => (
                <div className="recent-list__row" key={sale.id}>
                  <div className="sale-avatar">{sale.platform.slice(0, 1).toUpperCase()}</div>
                  <div className="recent-list__main">
                    <div><strong>{sale.platform}</strong><StatusBadge tone={sale.classification === 'normal' ? 'success' : 'neutral'}>{sale.classification.replace('_', ' ')}</StatusBadge></div>
                    <span>{sale.lines.map((line) => `${formatQuantity(line.quantity)}× ${itemMap.get(line.item_id)?.name || 'Item'}`).join(', ')}</span>
                  </div>
                  <div className="recent-list__amount"><strong>{formatMoney(sale.net_credit, sale.currency)}</strong><span>{formatDateTime(sale.sold_at)}</span></div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card className="dashboard-panel farm-summary">
          <SectionHeading title="Farm output" description="Production claimed in the last 30 days." action={<button className="round-link" onClick={() => onNavigate('farming')} aria-label="Open farming"><Leaf size={17} /></button>} />
          {farmOutput.length === 0 ? <EmptyState title="No recent harvest" description="Sync or claim a cycle to add farm stock." icon={Leaf} /> : (
            <div className="farm-output-list">
              {farmOutput.map(({ item, quantity }) => <div key={item.id}><span><Leaf size={16} />{item.name}</span><strong>+{formatQuantity(quantity)}</strong></div>)}
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
