import { useEffect, useMemo, useRef, useState } from 'react'
import { Coins, Leaf, Plus, Save, Settings2, SlidersHorizontal } from 'lucide-react'
import { Button, Card, Dialog, EmptyState, Field, PageHeader, SearchInput, SectionHeading, StatusBadge } from '../components/ui.jsx'
import { formatQuantity, toNumber } from '../lib/format.js'
import { readableError, supabase } from '../lib/supabase.js'

export default function Settings({ data, user, refresh, notify }) {
  const [search, setSearch] = useState('')
  const [itemDrafts, setItemDrafts] = useState({})
  const [feeDrafts, setFeeDrafts] = useState({})
  const [savingKey, setSavingKey] = useState(null)
  const saveLock = useRef(null)
  const [addOpen, setAddOpen] = useState(false)
  const [newItem, setNewItem] = useState({ name: '', gem_value_min: '', gem_value_max: '', is_farm_item: false })

  useEffect(() => {
    setItemDrafts(Object.fromEntries(data.items.map((item) => [item.id, {
      name: item.name,
      gem_value_min: item.gem_value_min ?? '',
      gem_value_max: item.gem_value_max ?? '',
      active: item.active,
      is_farm_item: item.is_farm_item,
    }])))
    setFeeDrafts(Object.fromEntries(data.platforms.map((platform) => [platform.id, platform.default_fee_pct ?? ''])))
  }, [data.items, data.platforms])

  const filteredItems = useMemo(() => data.items.filter((item) => item.name.toLowerCase().includes(search.toLowerCase())).sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name)), [data.items, search])

  const saveItem = async (item) => {
    if (saveLock.current) return
    const draft = itemDrafts[item.id]
    const min = draft.gem_value_min === '' ? null : Number(draft.gem_value_min)
    const max = draft.gem_value_max === '' ? null : Number(draft.gem_value_max)
    if (!draft.name.trim()) { notify('error', 'Item name cannot be empty.'); return }
    if ((min != null && (!Number.isFinite(min) || min < 0)) || (max != null && (!Number.isFinite(max) || max < 0)) || (min != null && max != null && min > max)) {
      notify('error', `Enter a valid Gem value range for ${item.name}.`)
      return
    }

    saveLock.current = `item-${item.id}`
    setSavingKey(`item-${item.id}`)
    try {
      const payload = {
        name: item.kind === 'currency' ? item.name : draft.name.trim(),
        gem_value_min: item.kind === 'currency' ? null : min,
        gem_value_max: item.kind === 'currency' ? null : (max ?? min),
        active: item.kind === 'currency' ? true : Boolean(draft.active),
        is_farm_item: item.kind === 'currency' ? false : Boolean(draft.is_farm_item),
        updated_at: new Date().toISOString(),
      }
      const { data: saved, error } = await supabase.from('rar_items').update(payload).eq('id', item.id).select('*').single()
      if (error) throw error
      if (!saved || saved.name !== payload.name || saved.active !== payload.active || saved.is_farm_item !== payload.is_farm_item) throw new Error('The saved item settings could not be verified.')
      await refresh()
      notify('success', `${saved.name} updated.`)
    } catch (error) {
      notify('error', readableError(error, `${item.name} could not be updated.`))
    } finally {
      saveLock.current = null
      setSavingKey(null)
    }
  }

  const addItem = async (event) => {
    event.preventDefault()
    if (saveLock.current) return
    const name = newItem.name.trim()
    const min = newItem.gem_value_min === '' ? null : Number(newItem.gem_value_min)
    const max = newItem.gem_value_max === '' ? null : Number(newItem.gem_value_max)
    if (!name) { notify('error', 'Enter an item name.'); return }
    if (data.items.some((item) => item.name.toLowerCase() === name.toLowerCase())) { notify('error', 'An item with this name already exists.'); return }
    if ((min != null && (!Number.isFinite(min) || min < 0)) || (max != null && (!Number.isFinite(max) || max < 0)) || (min != null && max != null && min > max)) { notify('error', 'Enter a valid Gem value range, or leave both values empty.'); return }

    saveLock.current = 'new-item'
    setSavingKey('new-item')
    try {
      const { data: saved, error } = await supabase.from('rar_items').insert({
        user_id: user.id,
        name,
        kind: 'item',
        stock: 0,
        gem_value_min: min,
        gem_value_max: max ?? min,
        is_farm_item: newItem.is_farm_item,
        active: true,
      }).select('*').single()
      if (error) throw error
      if (!saved?.id) throw new Error('The new item could not be verified.')
      await refresh()
      setAddOpen(false)
      setNewItem({ name: '', gem_value_min: '', gem_value_max: '', is_farm_item: false })
      notify('success', `${saved.name} added with zero starting stock.`)
    } catch (error) {
      notify('error', readableError(error, 'The item could not be added.'))
    } finally {
      saveLock.current = null
      setSavingKey(null)
    }
  }

  const saveFee = async (platform) => {
    if (saveLock.current) return
    const raw = feeDrafts[platform.id]
    const fee = raw === '' ? null : Number(raw)
    if (fee != null && (!Number.isFinite(fee) || fee < 0 || fee >= 100)) {
      notify('error', 'Fee guidance must be from 0 up to, but not including, 100%.')
      return
    }
    saveLock.current = `platform-${platform.id}`
    setSavingKey(`platform-${platform.id}`)
    try {
      const { data: saved, error } = await supabase.from('rar_platforms').update({ default_fee_pct: fee }).eq('id', platform.id).select('id,default_fee_pct').single()
      if (error) throw error
      if (!saved || (fee == null ? saved.default_fee_pct != null : toNumber(saved.default_fee_pct) !== fee)) throw new Error('The platform fee could not be verified after saving.')
      await refresh()
      notify('success', `${platform.name} fee guidance updated.`)
    } catch (error) {
      notify('error', readableError(error, `${platform.name} could not be updated.`))
    } finally {
      saveLock.current = null
      setSavingKey(null)
    }
  }

  return (
    <div className="page-stack">
      <PageHeader eyebrow="Prices & setup" title="Catalog controls" description="Maintain Gem values, farm eligibility, item availability, and marketplace fee guides." action={<Button onClick={() => setAddOpen(true)}><Plus size={18} />Add item</Button>} />

      <Card className="settings-card">
        <SectionHeading title="Item catalog" description="Disabling an item hides it from new transactions without deleting its history." action={<SearchInput value={search} onChange={setSearch} placeholder="Find an item…" />} />
        {filteredItems.length === 0 ? <EmptyState title="No matching items" description="Try a different search term." /> : (
          <div className="settings-items">
            {filteredItems.map((item) => {
              const draft = itemDrafts[item.id]
              if (!draft) return null
              return (
                <article className={`settings-item ${!draft.active ? 'is-disabled' : ''}`} key={item.id}>
                  <div className={`item-icon ${item.kind === 'currency' ? 'item-icon--gold' : ''}`}>{item.kind === 'currency' ? <Coins size={18} /> : item.name.slice(0, 1)}</div>
                  <div className="settings-item__name"><label><span>Name</span><input value={draft.name} disabled={item.kind === 'currency'} onChange={(event) => setItemDrafts((current) => ({ ...current, [item.id]: { ...current[item.id], name: event.target.value } }))} /></label><span>{formatQuantity(item.stock)} tracked · {item.kind}</span></div>
                  <div className="settings-item__values"><label><span>Gem min</span><input type="number" min="0" step="any" placeholder="Unknown" disabled={item.kind === 'currency'} value={draft.gem_value_min} onChange={(event) => setItemDrafts((current) => ({ ...current, [item.id]: { ...current[item.id], gem_value_min: event.target.value } }))} /></label><label><span>Gem max</span><input type="number" min="0" step="any" placeholder="Unknown" disabled={item.kind === 'currency'} value={draft.gem_value_max} onChange={(event) => setItemDrafts((current) => ({ ...current, [item.id]: { ...current[item.id], gem_value_max: event.target.value } }))} /></label></div>
                  <div className="settings-item__toggles"><label className="switch-row"><span><Leaf size={15} />Farm item</span><input type="checkbox" checked={Boolean(draft.is_farm_item)} disabled={item.kind === 'currency'} onChange={(event) => setItemDrafts((current) => ({ ...current, [item.id]: { ...current[item.id], is_farm_item: event.target.checked } }))} /><i /></label><label className="switch-row"><span>Active</span><input type="checkbox" checked={Boolean(draft.active)} disabled={item.kind === 'currency'} onChange={(event) => setItemDrafts((current) => ({ ...current, [item.id]: { ...current[item.id], active: event.target.checked } }))} /><i /></label></div>
                  <div className="settings-item__action"><StatusBadge tone={draft.active ? 'success' : 'neutral'}>{draft.active ? 'Enabled' : 'Disabled'}</StatusBadge><Button size="small" variant="secondary" loading={savingKey === `item-${item.id}`} disabled={Boolean(savingKey) && savingKey !== `item-${item.id}`} onClick={() => saveItem(item)}><Save size={15} />Save</Button></div>
                </article>
              )
            })}
          </div>
        )}
      </Card>

      <Card className="settings-card">
        <SectionHeading title="Platform fee guidance" description="Used only as an optional estimate when recording a sale; actual fee remains editable." action={<SlidersHorizontal size={20} />} />
        <div className="platform-settings">
          {data.platforms.map((platform) => <div key={platform.id}><span className="platform-chip">{platform.name.slice(0, 1)}</span><div><strong>{platform.name}</strong><small>{feeDrafts[platform.id] === '' ? 'Manual fee entry' : `${feeDrafts[platform.id]}% suggested fee`}</small></div><label><input type="number" min="0" max="99.99" step="any" placeholder="Manual" value={feeDrafts[platform.id] ?? ''} onChange={(event) => setFeeDrafts((current) => ({ ...current, [platform.id]: event.target.value }))} /><span>%</span></label><Button size="small" variant="ghost" loading={savingKey === `platform-${platform.id}`} disabled={Boolean(savingKey) && savingKey !== `platform-${platform.id}`} onClick={() => saveFee(platform)}>Save</Button></div>)}
        </div>
      </Card>

      <Dialog open={addOpen} title="Add a new item" description="New items start with zero stock. Use Purchases, Farming, or Stocktake to add units." onClose={() => !savingKey && setAddOpen(false)}>
        <form className="form-stack" onSubmit={addItem}>
          <Field label="Item name"><input autoFocus value={newItem.name} onChange={(event) => setNewItem((current) => ({ ...current, name: event.target.value }))} placeholder="e.g. Golden Counter" required /></Field>
          <div className="form-grid form-grid--2"><Field label="Gem value minimum"><input type="number" min="0" step="any" value={newItem.gem_value_min} onChange={(event) => setNewItem((current) => ({ ...current, gem_value_min: event.target.value }))} placeholder="Unknown" /></Field><Field label="Gem value maximum"><input type="number" min="0" step="any" value={newItem.gem_value_max} onChange={(event) => setNewItem((current) => ({ ...current, gem_value_max: event.target.value }))} placeholder="Same as minimum" /></Field></div>
          <label className="checkbox-card"><input type="checkbox" checked={newItem.is_farm_item} onChange={(event) => setNewItem((current) => ({ ...current, is_farm_item: event.target.checked }))} /><span><Leaf size={18} /><div><strong>Farm item</strong><small>Include this item in every farm cycle.</small></div></span></label>
          <div className="dialog__actions"><Button type="button" variant="ghost" onClick={() => setAddOpen(false)}>Cancel</Button><Button type="submit" loading={savingKey === 'new-item'}><Plus size={17} />Add item</Button></div>
        </form>
      </Dialog>
    </div>
  )
}
