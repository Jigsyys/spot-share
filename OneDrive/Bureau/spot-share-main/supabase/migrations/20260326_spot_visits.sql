-- Table pour enregistrer les visites d'un spot par les utilisateurs
create table if not exists public.spot_visits (
  spot_id uuid not null references public.spots(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  visited_at timestamptz not null default now(),
  primary key (spot_id, user_id)
);

-- Index pour requêtes par spot
create index if not exists idx_spot_visits_spot_id on public.spot_visits(spot_id);

-- RLS
alter table public.spot_visits enable row level security;

-- Tout le monde peut voir les visites (pour afficher les avatars)
create policy "spot_visits_select" on public.spot_visits
  for select using (true);

-- Un utilisateur peut insérer/supprimer uniquement ses propres visites
create policy "spot_visits_insert" on public.spot_visits
  for insert with check (auth.uid() = user_id);

create policy "spot_visits_delete" on public.spot_visits
  for delete using (auth.uid() = user_id);
