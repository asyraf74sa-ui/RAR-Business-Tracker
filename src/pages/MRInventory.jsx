import { useMemo, useState } from 'react'
import { Armchair, Banknote, Boxes, Gem, Sparkles } from 'lucide-react'
import { EmptyState, PageHeader, SearchInput, SectionHeading, StockPill } from '../components/ui.jsx'
import { formatQuantity } from '../lib/format.js'
import { MR_STOCK_CATEGORIES, mrVirtualCurrencyLabel, splitMrInventory } from '../lib/mr-inventory.js'

export default function MRInventory({ data }) {
  const [search, setSearch] = useState('')
  const query = search.trim().toLowerCase()
  const inventory = useMemo(() => splitMrInventory(data.mr.items, query), [data.mr.items, query])

  return (
    <div className="page-stack mr-stock-page">
      <PageHeader eyebrow="MR Inventory" title="MR stock" description="The 73-item production catalog plus separate virtual-currency balances." action={<SearchInput value={search} onChange={setSearch} placeholder="Search MR stock…" />} />
      <section className="set-pass-grid">
        <SectionHeading title="Furniture sets" description="One table plus four chairs. Complete and excess counts are calculated live." action={<Armchair size={19} />} />
        <div>{data.mr.setStock.map((set) => <article key={set.family_id}><span><Sparkles size={17} /><b>{set.name}</b></span><strong>{formatQuantity(set.completed_sets, 0)} <small>complete sets</small></strong><div><span>{formatQuantity(set.tables)} tables</span><span>{formatQuantity(set.chairs)} chairs</span></div><small>{formatQuantity(set.excess_tables)} excess tables · {formatQuantity(set.excess_chairs)} excess chairs</small></article>)}</div>
      </section>
      <section className="inventory-category mr-virtual-wallet">
        <SectionHeading title="Gems & Money" description={`${inventory.virtualCurrencies.length} matching virtual balances · kept outside the item catalog`} action={<Gem size={19} />} />
        {inventory.virtualCurrencies.length ? <div className="stock-wallet-list">{inventory.virtualCurrencies.map((item) => {
          const label = mrVirtualCurrencyLabel(item)
          return <article key={item.id}><span className="stock-wallet-list__mark">{label === 'Gems' ? <Gem size={17} /> : <Banknote size={17} />}</span><div><strong>{label}</strong><small>MR virtual currency{item.aliases?.length ? ` · Alias: ${item.aliases.join(', ')}` : ''}</small></div><StockPill value={item.current_quantity} /></article>
        })}</div> : <EmptyState title="No matching Gems or Money" description="Try another search term." icon={Gem} />}
      </section>
      {MR_STOCK_CATEGORIES.map((category) => (
        <section className="inventory-category" key={category}>
          <SectionHeading title={category} description={`${inventory.categories[category].length} matching active items`} />
          {inventory.categories[category].length ? <div className="stock-wallet-list">{inventory.categories[category].map((item) => <article key={item.id}><span className="stock-wallet-list__mark">{item.name.slice(0, 1)}</span><div><strong>{item.name}</strong><small>{item.unit}{item.aliases?.length ? ` · Alias: ${item.aliases.join(', ')}` : ''}</small></div><StockPill value={item.current_quantity} /></article>)}</div> : <EmptyState title={`No matching ${category.toLowerCase()}`} description="Try another search term." icon={Boxes} />}
        </section>
      ))}
    </div>
  )
}
