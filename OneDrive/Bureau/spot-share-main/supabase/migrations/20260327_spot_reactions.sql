-- Table pour les réactions aux spots : ❤️ like public + 🔖 save privé (visible par ses amis)
create table if not exists public.spot_reactions (
  spot_id    uuid not null references public.spots(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  type       text not null check (type in ('love', 'save')),
  created_at timestamptz not null default now(),
  primary key (spot_id, user_id, type)
);

create index if not exists idx_spot_reactions_spot_id on public.spot_reactions(spot_id);
create index if not exists idx_spot_reactions_user_id on public.spot_reactions(user_id);

alter table public.spot_reactions enable row level security;

-- ❤️ Love : visible par tout le monde
-- 🔖 Save : visible uniquement par le propriétaire ET ses abonnés (pour le "match silencieux")
create policy "spot_reactions_select" on public.spot_reactions
  for select using (
    type = 'love'
    or auth.uid() = user_id
    or (
      type = 'save'
      and exists (
        select 1 from public.followers
        where follower_id = auth.uid()
          and following_id = user_id
      )
    )
  );

-- Chacun peut gérer ses propres réactions
create policy "spot_reactions_insert" on public.spot_reactions
  for insert with check (auth.uid() = user_id);

create policy "spot_reactions_delete" on public.spot_reactions
  for delete using (auth.uid() = user_id);
