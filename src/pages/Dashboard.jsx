import { useMemo, useState } from 'react'
import {
  ArrowRight,
  Boxes,
  CalendarClock,
  Gem,
  Gauge,
  Leaf,
  PackageOpen,
  Percent,
  Plus,
  ReceiptText,
  Sprout,
  TrendingUp,
  WalletCards,
} from 'lucide-react'
import { Button, EmptyState, SectionHeading, StatusBadge } from '../components/ui.jsx'
import { CURRENCIES } from '../lib/constants.js'
import { formatDateTime, formatMoney, formatQuantity, groupCurrencyTotals, toNumber } from '../lib/format.js'

const CURRENCY_META = {
  USD: { label: 'Global wallet', symbol: '$' },
  MYR: { label: 'Malaysia wallet', symbol: 'RM' },
  PHP: { label: 'Philippines wallet', symbol: '₱' },
  IDR: { label: 'Indonesia wallet', symbol: 'Rp' },
}

export default function Dashboard({ data, onNavigate }) {
  const { items, sales, saleItems, inventoryEvents, farmConfig } = data
  const [selectedCurrency, setSelectedCurrency] = useState('USD')
  const gemItem = items.find((item) => item.kind === 'currency' && item.name.toLowerCase() === 'gems')
  const physicalItems = items.filter((item) => item.kind === 'item')
  const activeFarmItems = physicalItems.filter((item) => item.is_farm_item && item.active)
  const itemMap = useMemo(() => new Map(items.map((item) => [item.id, item])), [items])

  const netTotals = useMemo(() => groupCurrencyTotals(sales, (sale) => sale.net_credit), [sales])
  const feeTotals = useMemo(() => groupCurrencyTotals(sales, (sale) => sale.platform_fee), [sales])
  const grossTotals = useMemo(() => groupCurrencyTotals(sales, (sale) => toNumber(sale.net_credit) + toNumber(sale.platform_fee)), [sales])
  const saleCountByCurrency = useMemo(() => {
    const counts = Object.fromEntries(CURRENCIES.map((currency) => [currency, 0]))
    sales.forEach((sale) => {
      const currency = String(sale.currency).toUpperCase()
      if (currency in counts) counts[currency] += 1
    })
    return counts
  }, [sales])
  const selectedSales = useMemo(() => sales.filter((sale) => String(sale.currency).toUpperCase() === selectedCurrency), [sales, selectedCurrency])

  const platformPerformance = useMemo(() => {
    const grouped = new Map()
    selectedSales.forEach((sale) => {
      const current = grouped.get(sale.platform) || { platform: sale.platform, net: 0, fees: 0, orders: 0 }
      current.net += toNumber(sale.net_credit)
      current.fees += toNumber(sale.platform_fee)
      current.orders += 1
      grouped.set(sale.platform, current)
    })
    const totalNet = netTotals[selectedCurrency]
    return [...grouped.values()]
      .map((entry) => ({
        ...entry,
        contribution: totalNet > 0 ? (entry.net / totalNet) * 100 : selectedSales.length ? (entry.orders / selectedSales.length) * 100 : 0,
      }))
      .sort((a, b) => b.net - a.net || b.orders - a.orders)
  }, [selectedSales, selectedCurrency, netTotals])

  const bestSellers = useMemo(() => {
    const grouped = new Map()
    saleItems.forEach((line) => grouped.set(line.item_id, (grouped.get(line.item_id) || 0) + toNumber(line.quantity)))
    return [...grouped.entries()]
      .map(([id, quantity]) => ({ item: itemMap.get(id), quantity }))
      .filter(({ item }) => item?.kind === 'item')
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 5)
  }, [saleItems, itemMap])

  const recentSales = sales.slice(0, 5).map((sale) => ({
    ...sale,
    lines: saleItems.filter((line) => line.sale_id === sale.id),
  }))

  const farmOutput = useMemo(() => {
    const thirtyDaysAgo = Date.now() - 30 * 86_400_000
    return inventoryEvents
      .filter((event) => event.event_type === 'farm' && new Date(event.event_at).getTime() >= thirtyDaysAgo)
      .reduce((sum, event) => sum + toNumber(event.quantity_delta), 0)
  }, [inventoryEvents])

  const accounts = toNumber(farmConfig?.farming_accounts, 3)
  const cycleDays = toNumber(farmConfig?.cycle_days, 2.5)
  const unitsPerItem = toNumber(farmConfig?.units_per_item_per_account, 1)
  const perItemPerCycle = accounts * unitsPerItem
  const productionPerCycle = perItemPerCycle * activeFarmItems.length
  const projectedThirtyDays = cycleDays > 0 ? productionPerCycle * (30 / cycleDays) : 0
  const lastClaim = farmConfig?.last_claim_at ? new Date(farmConfig.last_claim_at) : null
  const nextCycle = lastClaim && cycleDays > 0 ? new Date(lastClaim.getTime() + cycleDays * 86_400_000) : null
  const inventoryUnits = physicalItems.reduce((sum, item) => sum + toNumber(item.stock), 0)
  const walletStack = [...CURRENCIES.filter((currency) => currency !== selectedCurrency), selectedCurrency]
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'

  return (
    <div className="page-stack dashboard-page">
      <header className="dashboard-greeting">
        <div><p className="eyebrow">Business wallet</p><h1>{greeting}</h1><p>Here’s your RAR business today.</p></div>
        <Button onClick={() => onNavigate('sale')}><Plus size={18} />Record sale</Button>
      </header>

      <div className="wallet-overview">
        <div className="wallet-stack" aria-label="RAR currency wallets">
          {walletStack.map((currency, index) => {
            const active = currency === selectedCurrency
            return (
              <button
                type="button"
                aria-pressed={active}
                aria-label={`${currency} wallet, ${formatMoney(netTotals[currency], currency)} net received`}
                className={`wallet-pass wallet-pass--${currency.toLowerCase()} ${active ? 'is-active' : ''}`}
                style={{ '--stack-index': index }}
                onClick={() => setSelectedCurrency(currency)}
                key={currency}
              >
                <span className="wallet-pass__ambient" aria-hidden="true" />
                <span className="wallet-pass__top">
                  <span className="wallet-pass__brand"><i>R</i><span><strong>RAR</strong><small>Run a Restaurant</small></span></span>
                  <span className="wallet-pass__currency"><strong>{currency}</strong><small>{CURRENCY_META[currency].label}</small></span>
                </span>
                <span className="wallet-pass__body"><small>Net sales received</small><strong>{formatMoney(netTotals[currency], currency)}</strong></span>
                <span className="wallet-pass__footer">
                  <span><small>After platform fees</small><strong>{CURRENCY_META[currency].symbol} wallet</strong></span>
                  <span><small>Activity</small><strong>{saleCountByCurrency[currency]} {saleCountByCurrency[currency] === 1 ? 'transaction' : 'transactions'}</strong></span>
                  <WalletCards size={22} aria-hidden="true" />
                </span>
              </button>
            )
          })}
        </div>

        <aside className="wallet-insights" aria-label={`${selectedCurrency} wallet at a glance`}>
          <div className="wallet-insights__heading"><span>At a glance</span><strong>{selectedCurrency}</strong></div>
          <article className="support-metric support-metric--blue"><span className="support-metric__icon"><Percent size={20} /></span><div><span>Platform fees</span><strong>{formatMoney(feeTotals[selectedCurrency], selectedCurrency)}</strong><small>{selectedCurrency} only</small></div></article>
          <article className="support-metric support-metric--green"><span className="support-metric__icon"><TrendingUp size={20} /></span><div><span>Gross sales</span><strong>{formatMoney(grossTotals[selectedCurrency], selectedCurrency)}</strong><small>Net received + fees</small></div></article>
          <article className="support-metric support-metric--purple"><span className="support-metric__icon"><Gem size={20} /></span><div><span>Gem balance</span><strong>{formatQuantity(gemItem?.stock || 0)}</strong><small>Alternative business asset</small></div></article>
          <article className="support-metric support-metric--gold"><span className="support-metric__icon"><PackageOpen size={20} /></span><div><span>Inventory units</span><strong>{formatQuantity(inventoryUnits)}</strong><small>{physicalItems.filter((item) => item.active).length} active item types</small></div></article>
        </aside>
      </div>

      <section className="dashboard-surface dashboard-surface--performance">
        <section className="platform-performance">
          <SectionHeading title="Platform performance" description={`Net sales, fees, and share of the ${selectedCurrency} wallet.`} />
          {platformPerformance.length === 0 ? (
            <EmptyState title={`No ${selectedCurrency} platform sales yet`} description="Choose another currency or record your first sale." action={<Button variant="secondary" size="small" onClick={() => onNavigate('sale')}>Record a sale</Button>} />
          ) : (
            <div className="platform-performance__list">
              {platformPerformance.map((entry) => (
                <article className="platform-performance__row" key={entry.platform}>
                  <div className="platform-performance__identity"><span className="platform-chip">{entry.platform.slice(0, 1)}</span><div><strong>{entry.platform}</strong><small>{entry.orders} {entry.orders === 1 ? 'order' : 'orders'}</small></div></div>
                  <div className="platform-performance__money"><span>Net<strong>{formatMoney(entry.net, selectedCurrency)}</strong></span><span>Fees<strong>{formatMoney(entry.fees, selectedCurrency)}</strong></span></div>
                  <div className="platform-performance__share"><i style={{ '--share-angle': `${Math.min(100, Math.max(0, entry.contribution)) * 3.6}deg` }} aria-hidden="true" /><span><strong>{formatQuantity(entry.contribution, 1)}%</strong><small>of wallet</small></span></div>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="top-items">
          <SectionHeading title="Top sold items" description="Ranked by units across all recorded sales." />
          {bestSellers.length === 0 ? <EmptyState title="No best seller yet" description="Bundle items are ranked automatically after your first sale." icon={Boxes} /> : (
            <ol className="rank-list rank-list--visual">
              {bestSellers.map(({ item, quantity }, index) => (
                <li key={item.id}><span className="rank-list__number">{String(index + 1).padStart(2, '0')}</span><div><span><strong title={item.name}>{item.name}</strong><b>{formatQuantity(quantity)} sold</b></span></div></li>
              ))}
            </ol>
          )}
        </section>
      </section>

      <section className="dashboard-surface dashboard-surface--operations">
        <section className="farm-capacity">
          <SectionHeading title="Farm capacity" description="Live production estimates from your current farm configuration." action={<button className="round-link" onClick={() => onNavigate('farming')} aria-label="Open Farm"><ArrowRight size={17} /></button>} />
          <div className="farm-capacity__hero"><span><Sprout size={23} /></span><div><small>Estimated 30-day output</small><strong>≈ {formatQuantity(projectedThirtyDays)} units</strong><p>{formatQuantity(farmOutput)} units actually claimed in the last 30 days</p></div></div>
          <div className="farm-capacity__stats">
            <div><span><Boxes size={16} />Accounts</span><strong>{formatQuantity(accounts, 0)}</strong></div>
            <div><span><CalendarClock size={16} />Cycle</span><strong>{formatQuantity(cycleDays)} days</strong></div>
            <div><span><Leaf size={16} />Per item / cycle</span><strong>{formatQuantity(perItemPerCycle)}</strong></div>
            <div><span><Gauge size={16} />All items / cycle</span><strong>{formatQuantity(productionPerCycle)}</strong></div>
          </div>
          <div className="farm-capacity__timeline"><span><i />Last claim <strong>{formatDateTime(lastClaim)}</strong></span><span><i />Next estimate <strong>{formatDateTime(nextCycle)}</strong></span></div>
        </section>

        <section className="recent-activity">
          <SectionHeading title="Recent sales" description="Latest wallet activity in its original currency." action={<button className="text-link" onClick={() => onNavigate('history')}>View history <ArrowRight size={15} /></button>} />
          {recentSales.length === 0 ? <EmptyState title="Your activity feed is ready" description="Record a single item, bundle, or Gem sale to begin." icon={ReceiptText} /> : (
            <div className="recent-list">
              {recentSales.map((sale) => (
                <div className="recent-list__row" key={sale.id}>
                  <div className="sale-avatar"><ReceiptText size={16} /></div>
                  <div className="recent-list__main"><div><strong>{sale.platform}</strong><StatusBadge tone={sale.classification === 'normal' ? 'success' : 'neutral'}>{sale.classification.replace('_', ' ')}</StatusBadge></div><span>{sale.lines.map((line) => `${formatQuantity(line.quantity)}× ${itemMap.get(line.item_id)?.name || 'Item'}`).join(', ') || 'Sale recorded'}</span></div>
                  <div className="recent-list__amount"><strong>{formatMoney(sale.net_credit, sale.currency)}</strong><span>{formatDateTime(sale.sold_at, { compact: true })}</span></div>
                </div>
              ))}
            </div>
          )}
        </section>
      </section>
    </div>
  )
}
