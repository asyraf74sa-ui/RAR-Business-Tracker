import { useMemo, useState } from 'react'
import { Armchair, Boxes, Sparkles } from 'lucide-react'
import { EmptyState, PageHeader, SearchInput, SectionHeading, StockPill } from '../components/ui.jsx'
import { formatQuantity } from '../lib/format.js'

const CATEGORIES = ['Furnitures', 'Appliances', 'Decorations']

export default function MRInventory({ data }) {
  const [search, setSearch] = useState('')
  const query = search.trim().toLowerCase()
  const grouped = useMemo(() => Object.fromEntries(CATEGORIES.map((category) => [category, data.mr.items
    .filter((item) => !item.is_archived && item.category === category && (!query || `${item.name} ${(item.aliases || []).join(' ')}`.toLowerCase().includes(query)))
    .sort((left, right) => left.name.localeCompare(right.name))])), [data.mr.items, query])

  return (
    <div className="page-stack mr-stock-page">
      <PageHeader eyebrow="MR Inventory" title="73-item catalog" description="My Restaurant stock only, grouped by its production catalog." action={<SearchInput value={search} onChange={setSearch} placeholder="Search MR stock…" />} />
      <section className="set-pass-grid">
        <SectionHeading title="Furniture sets" description="One table plus four chairs. Complete and excess counts are calculated live." action={<Armchair size={19} />} />
        <div>{data.mr.setStock.map((set) => <article key={set.family_id}><span><Sparkles size={17} /><b>{set.name}</b></span><strong>{formatQuantity(set.completed_sets, 0)} <small>complete sets</small></strong><div><span>{formatQuantity(set.tables)} tables</span><span>{formatQuantity(set.chairs)} chairs</span></div><small>{formatQuantity(set.excess_tables)} excess tables · {formatQuantity(set.excess_chairs)} excess chairs</small></article>)}</div>
      </section>
      {CATEGORIES.map((category) => (
        <section className="inventory-category" key={category}>
          <SectionHeading title={category} description={`${grouped[category].length} matching active items`} />
          {grouped[category].length ? <div className="stock-wallet-list">{grouped[category].map((item) => <article key={item.id}><span className="stock-wallet-list__mark">{item.name.slice(0, 1)}</span><div><strong>{item.name}</strong><small>{item.unit}{item.aliases?.length ? ` · Alias: ${item.aliases.join(', ')}` : ''}</small></div><StockPill value={item.current_quantity} /></article>)}</div> : <EmptyState title={`No matching ${category.toLowerCase()}`} description="Try another search term." icon={Boxes} />}
        </section>
      ))}
    </div>
  )
}
