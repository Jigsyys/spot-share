-- Table many-to-many : spots ↔ groupes
create table if not exists public.spot_group_spots (
  spot_id uuid not null references public.spots(id) on delete cascade,
  group_id uuid not null references public.spot_groups(id) on delete cascade,
  added_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (spot_id, group_id)
);

-- RLS
alter table public.spot_group_spots enable row level security;

-- Visible si membre du groupe
create policy "spot_group_spots_select" on public.spot_group_spots for select using (
  group_id in (select get_my_group_ids())
);

-- N'importe quel membre peut ajouter un spot au groupe
create policy "spot_group_spots_insert" on public.spot_group_spots for insert with check (
  added_by = auth.uid()
  and group_id in (select get_my_group_ids())
);

-- Le créateur du spot ou l'ajouteur peut retirer
create policy "spot_group_spots_delete" on public.spot_group_spots for delete using (
  added_by = auth.uid()
  or spot_id in (select id from public.spots where user_id = auth.uid())
);

-- Realtime
alter table public.spot_group_spots replica identity full;
alter publication supabase_realtime add table public.spot_group_spots;
