import { useEffect, useMemo, useRef, useState } from 'react'
import { Armchair, Plus, Save, Settings2 } from 'lucide-react'
import { Button, Card, Dialog, EmptyState, Field, PageHeader, SearchInput, SectionHeading, StatusBadge } from '../components/ui.jsx'
import { formatQuantity } from '../lib/format.js'
import { readableError, supabase } from '../lib/supabase.js'

const CATEGORIES = ['Furnitures', 'Appliances', 'Decorations']
const aliasesFromText = (value) => [...new Set(value.split(',').map((entry) => entry.trim()).filter(Boolean))]

function itemDraft(item) {
  return { name: item.name, category: item.category, unit: item.unit, aliases: (item.aliases || []).join(', '), notes: item.notes || '', image_url: item.image_url || '', low_stock_threshold: item.low_stock_threshold ?? 5, is_archived: item.is_archived }
}

export default function MRSettings({ data, refresh, notify }) {
  const [search, setSearch] = useState('')
  const [drafts, setDrafts] = useState({})
  const [familyDrafts, setFamilyDrafts] = useState({})
  const [saving, setSaving] = useState(null)
  const [addOpen, setAddOpen] = useState(false)
  const [newItem, setNewItem] = useState({ name: '', category: 'Appliances', unit: 'units', aliases: '', low_stock_threshold: '5', notes: '' })
  const lock = useRef(false)

  useEffect(() => setDrafts(Object.fromEntries(data.mr.items.map((item) => [item.id, itemDraft(item)]))), [data.mr.items])
  useEffect(() => setFamilyDrafts(Object.fromEntries(data.mr.setFamilies.map((family) => [family.id, { name: family.name, aliases: (family.aliases || []).join(', '), table_item_id: family.table_item_id, chair_item_id: family.chair_item_id, active: family.active }]))), [data.mr.setFamilies])

  const filtered = useMemo(() => data.mr.items.filter((item) => `${item.name} ${item.category}`.toLowerCase().includes(search.toLowerCase())).sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name)), [data.mr.items, search])
  const furniture = useMemo(() => data.mr.items.filter((item) => !item.is_archived && item.category === 'Furnitures').sort((a, b) => a.name.localeCompare(b.name)), [data.mr.items])

  const persistItem = async (itemId, draft) => {
    const threshold = Number(draft.low_stock_threshold)
    if (!draft.name.trim() || !Number.isFinite(threshold) || threshold < 0) throw new Error('Enter a valid name and non-negative low-stock threshold.')
    const params = { p_item_id: itemId, p_name: draft.name.trim(), p_category: draft.category, p_unit: draft.unit.trim() || 'units', p_aliases: aliasesFromText(draft.aliases), p_notes: draft.notes.trim() || null, p_image_url: draft.image_url?.trim() || null, p_low_stock_threshold: threshold, p_is_archived: Boolean(draft.is_archived) }
    const { data: savedId, error } = await supabase.rpc('mr_save_catalog_item', params)
    if (error) throw error
    const { data: saved, error: verifyError } = await supabase.from('mr_items').select('id,current_quantity,name,category,is_archived').eq('id', savedId).single()
    if (verifyError || !saved || saved.name !== params.p_name || saved.category !== params.p_category || saved.is_archived !== params.p_is_archived) throw new Error('The saved MR catalog metadata could not be verified.')
    return saved
  }

  const saveItem = async (item) => {
    if (lock.current) return
    lock.current = true; setSaving(`item-${item.id}`)
    try { const saved = await persistItem(item.id, drafts[item.id]); await refresh(); notify('success', `${saved.name} updated without changing stock.`) }
    catch (error) { notify('error', readableError(error, `${item.name} could not be updated.`)) }
    finally { lock.current = false; setSaving(null) }
  }

  const addItem = async (event) => {
    event.preventDefault()
    if (lock.current) return
    lock.current = true; setSaving('new-item')
    try {
      const saved = await persistItem(null, { ...newItem, image_url: '', is_archived: false })
      await refresh(); setAddOpen(false); setNewItem({ name: '', category: 'Appliances', unit: 'units', aliases: '', low_stock_threshold: '5', notes: '' })
      notify('success', `${saved.name} created with zero starting stock.`)
    } catch (error) { notify('error', readableError(error, 'The MR item could not be created.')) }
    finally { lock.current = false; setSaving(null) }
  }

  const saveFamily = async (family) => {
    if (lock.current) return
    const draft = familyDrafts[family.id]
    lock.current = true; setSaving(`family-${family.id}`)
    try {
      const params = { p_family_id: family.id, p_name: draft.name.trim(), p_aliases: aliasesFromText(draft.aliases), p_table_item_id: draft.table_item_id, p_chair_item_id: draft.chair_item_id, p_chairs_per_set: 4, p_active: Boolean(draft.active) }
      const { data: savedId, error } = await supabase.rpc('mr_upsert_set_family', params)
      if (error) throw error
      const { data: saved, error: verifyError } = await supabase.from('mr_set_families').select('id,name,table_item_id,chair_item_id,chairs_per_set,active').eq('id', savedId).single()
      if (verifyError || !saved || saved.chairs_per_set !== 4 || saved.table_item_id !== params.p_table_item_id || saved.chair_item_id !== params.p_chair_item_id) throw new Error('The MR set-family mapping could not be verified.')
      await refresh(); notify('success', `${saved.name} set configuration updated.`)
    } catch (error) { notify('error', readableError(error, `${family.name} could not be updated.`)) }
    finally { lock.current = false; setSaving(null) }
  }

  return (
    <div className="page-stack catalog-manager">
      <PageHeader eyebrow="MR · Prices / Setup" title="Catalog Manager" description="Edit safe metadata while item IDs, stock, and historical references stay untouched." action={<Button onClick={() => setAddOpen(true)}><Plus size={17} />Add MR item</Button>} />
      <Card className="settings-card"><SectionHeading title="MR item catalog" description="Archive hides an item from new operations. It never deletes history or resets quantity." action={<SearchInput value={search} onChange={setSearch} placeholder="Search 73-item catalog…" />} />
        {filtered.length ? <div className="catalog-list">{filtered.map((item) => {
          const draft = drafts[item.id]; if (!draft) return null
          const update = (key, value) => setDrafts((current) => ({ ...current, [item.id]: { ...current[item.id], [key]: value } }))
          return <article className={draft.is_archived ? 'is-disabled' : ''} key={item.id}><header><span className="item-icon">{item.name.slice(0, 1)}</span><div><strong>{item.name}</strong><small>{formatQuantity(item.current_quantity)} {item.unit} · ID preserved</small></div><StatusBadge tone={draft.is_archived ? 'neutral' : 'success'}>{draft.is_archived ? 'Archived' : 'Active'}</StatusBadge></header><div className="catalog-fields"><Field label="Canonical name"><input value={draft.name} onChange={(event) => update('name', event.target.value)} /></Field><Field label="Category"><select value={draft.category} onChange={(event) => update('category', event.target.value)}>{CATEGORIES.map((category) => <option key={category}>{category}</option>)}</select></Field><Field label="Aliases" hint="Comma-separated"><input value={draft.aliases} onChange={(event) => update('aliases', event.target.value)} placeholder="Optional aliases" /></Field><Field label="Low stock"><input type="number" min="0" step="any" value={draft.low_stock_threshold} onChange={(event) => update('low_stock_threshold', event.target.value)} /></Field></div><footer><label className="switch-row"><span>Archived</span><input type="checkbox" checked={Boolean(draft.is_archived)} onChange={(event) => update('is_archived', event.target.checked)} /><i /></label><Button size="small" variant="secondary" loading={saving === `item-${item.id}`} onClick={() => saveItem(item)}><Save size={15} />Save metadata</Button></footer></article>
        })}</div> : <EmptyState title="No matching MR items" description="Try another catalog search." />}
      </Card>

      <Card className="settings-card"><SectionHeading title="Furniture set families" description="Mappings accept only matching active Furniture Table and Chair components. Every set is locked to four chairs." action={<Armchair size={20} />} /><div className="family-settings">{data.mr.setFamilies.map((family) => {
        const draft = familyDrafts[family.id]; if (!draft) return null
        const update = (key, value) => setFamilyDrafts((current) => ({ ...current, [family.id]: { ...current[family.id], [key]: value } }))
        return <article key={family.id}><header><span className="game-orb game-orb--mr">M</span><div><strong>{family.name} Set</strong><small>1 table + 4 chairs</small></div></header><div className="catalog-fields"><Field label="Family name"><input value={draft.name} onChange={(event) => update('name', event.target.value)} /></Field><Field label="Set aliases"><input value={draft.aliases} onChange={(event) => update('aliases', event.target.value)} /></Field><Field label="Table"><select value={draft.table_item_id} onChange={(event) => update('table_item_id', event.target.value)}>{furniture.filter((item) => item.name.endsWith('Table')).map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></Field><Field label="Chair"><select value={draft.chair_item_id} onChange={(event) => update('chair_item_id', event.target.value)}>{furniture.filter((item) => item.name.endsWith('Chair')).map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></Field></div><footer><label className="switch-row"><span>Active</span><input type="checkbox" checked={Boolean(draft.active)} onChange={(event) => update('active', event.target.checked)} /><i /></label><Button size="small" variant="secondary" loading={saving === `family-${family.id}`} onClick={() => saveFamily(family)}><Settings2 size={15} />Save family</Button></footer></article>
      })}</div></Card>

      <Dialog open={addOpen} title="Add an MR catalog item" description="New items start at zero. Only MR operations may change inventory." onClose={() => !saving && setAddOpen(false)}><form className="form-stack" onSubmit={addItem}><Field label="Canonical name"><input autoFocus value={newItem.name} onChange={(event) => setNewItem((current) => ({ ...current, name: event.target.value }))} required /></Field><div className="form-grid form-grid--2"><Field label="Category"><select value={newItem.category} onChange={(event) => setNewItem((current) => ({ ...current, category: event.target.value }))}>{CATEGORIES.map((category) => <option key={category}>{category}</option>)}</select></Field><Field label="Unit"><input value={newItem.unit} onChange={(event) => setNewItem((current) => ({ ...current, unit: event.target.value }))} required /></Field></div><Field label="Aliases" hint="Comma-separated"><input value={newItem.aliases} onChange={(event) => setNewItem((current) => ({ ...current, aliases: event.target.value }))} /></Field><Field label="Low-stock threshold"><input type="number" min="0" step="any" value={newItem.low_stock_threshold} onChange={(event) => setNewItem((current) => ({ ...current, low_stock_threshold: event.target.value }))} /></Field><Field label="Notes" hint="Optional"><textarea rows="3" value={newItem.notes} onChange={(event) => setNewItem((current) => ({ ...current, notes: event.target.value }))} /></Field><div className="dialog__actions"><Button type="button" variant="ghost" onClick={() => setAddOpen(false)}>Cancel</Button><Button type="submit" loading={saving === 'new-item'}><Plus size={16} />Create at zero stock</Button></div></form></Dialog>
    </div>
  )
}
