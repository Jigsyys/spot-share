-- ============================================================
-- Sorties (outings) entre amis
-- ============================================================

-- Table principale des sorties
create table if not exists public.outings (
  id            uuid primary key default gen_random_uuid(),
  creator_id    uuid not null references auth.users(id) on delete cascade,
  title         text not null,
  description   text,
  location_name text,
  spot_id       uuid references public.spots(id) on delete set null,
  scheduled_at  timestamptz,
  status        text not null default 'active'
                  check (status in ('active', 'cancelled', 'completed')),
  created_at    timestamptz not null default now()
);

-- Invitations liées à chaque sortie
create table if not exists public.outing_invitations (
  id           uuid primary key default gen_random_uuid(),
  outing_id    uuid not null references public.outings(id) on delete cascade,
  invitee_id   uuid not null references auth.users(id) on delete cascade,
  status       text not null default 'pending'
                 check (status in ('pending', 'accepted', 'declined')),
  responded_at timestamptz,
  created_at   timestamptz not null default now(),
  unique (outing_id, invitee_id)
);

-- ── RLS ──────────────────────────────────────────────────────

alter table public.outings enable row level security;
alter table public.outing_invitations enable row level security;

-- outings : lecture (créateur ou invité)
create policy "outings_select" on public.outings
  for select using (
    creator_id = auth.uid()
    or id in (
      select outing_id from public.outing_invitations
      where invitee_id = auth.uid()
    )
  );

-- outings : création (uniquement pour soi)
create policy "outings_insert" on public.outings
  for insert with check (creator_id = auth.uid());

-- outings : mise à jour / annulation (créateur uniquement)
create policy "outings_update" on public.outings
  for update using (creator_id = auth.uid());

-- outing_invitations : lecture (invité ou créateur de la sortie)
create policy "outing_invitations_select" on public.outing_invitations
  for select using (
    invitee_id = auth.uid()
    or outing_id in (
      select id from public.outings where creator_id = auth.uid()
    )
  );

-- outing_invitations : insertion (créateur de la sortie uniquement)
create policy "outing_invitations_insert" on public.outing_invitations
  for insert with check (
    outing_id in (
      select id from public.outings where creator_id = auth.uid()
    )
  );

-- outing_invitations : réponse (invité uniquement)
create policy "outing_invitations_update" on public.outing_invitations
  for update using (invitee_id = auth.uid());

-- ── Index ────────────────────────────────────────────────────

create index if not exists outings_creator_id_idx
  on public.outings(creator_id);

create index if not exists outings_scheduled_at_idx
  on public.outings(scheduled_at);

create index if not exists outing_invitations_invitee_id_idx
  on public.outing_invitations(invitee_id);

create index if not exists outing_invitations_outing_id_idx
  on public.outing_invitations(outing_id);
