-- Cover the composite user-scoped foreign keys used by the MR Phase 1 tables.

drop index if exists public.mr_set_families_table_item_id_idx;
drop index if exists public.mr_set_families_chair_item_id_idx;
drop index if exists public.mr_sale_items_item_id_idx;
drop index if exists public.mr_inventory_events_item_id_idx;
drop index if exists public.mr_inventory_events_related_sale_id_idx;
drop index if exists public.mr_item_prices_item_id_idx;

create index if not exists mr_set_families_table_item_user_idx
  on public.mr_set_families (table_item_id, user_id);
create index if not exists mr_set_families_chair_item_user_idx
  on public.mr_set_families (chair_item_id, user_id);
create index if not exists mr_sale_items_sale_user_idx
  on public.mr_sale_items (sale_id, user_id);
create index if not exists mr_sale_items_item_user_idx
  on public.mr_sale_items (item_id, user_id);
create index if not exists mr_inventory_events_item_user_idx
  on public.mr_inventory_events (item_id, user_id);
create index if not exists mr_inventory_events_sale_user_idx
  on public.mr_inventory_events (related_sale_id, user_id)
  where related_sale_id is not null;
create index if not exists mr_item_prices_item_user_idx
  on public.mr_item_prices (item_id, user_id);
