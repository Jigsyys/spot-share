-- ─── Helper function (SECURITY DEFINER to avoid RLS recursion) ───────────────
-- Must be created before any policy that references spot_group_members indirectly
create or replace function public.get_my_group_ids()
returns setof uuid language sql security definer stable set search_path = public
as $$ select group_id from public.spot_group_members where user_id = auth.uid() $$;

-- ─── RLS spots (nouvelle policy) ─────────────────────────────────────────────
-- Supprimer les policies existantes sur spots si elles existent
drop policy if exists "spots_select" on public.spots;

alter table public.spots enable row level security;

create policy "spots_select" on public.spots for select using (
  -- Toujours visible par le créateur
  user_id = auth.uid()
  or (
    -- Spots "friends" : visible si l'utilisateur suit le créateur
    (visibility = 'friends' or visibility is null)
    and user_id in (
      select following_id from public.followers where follower_id = auth.uid()
    )
  )
  or (
    -- Spots "group" : visible si membre du groupe (uses SECURITY DEFINER to avoid recursion)
    visibility = 'group'
    and group_id in (select get_my_group_ids())
  )
);

-- Insert / update / delete : uniquement par le propriétaire (inchangé)
create policy "spots_insert" on public.spots for insert with check (user_id = auth.uid());
create policy "spots_update" on public.spots for update using (user_id = auth.uid());
create policy "spots_delete" on public.spots for delete using (user_id = auth.uid());

-- ─── RLS spot_groups ─────────────────────────────────────────────────────────
alter table public.spot_groups enable row level security;

-- Creator can always see their own group (needed for insert().select() pattern)
create policy "spot_groups_select" on public.spot_groups for select using (
  creator_id = auth.uid()
  or id in (select get_my_group_ids())
);
create policy "spot_groups_insert" on public.spot_groups for insert with check (creator_id = auth.uid());
create policy "spot_groups_update" on public.spot_groups for update using (creator_id = auth.uid());
create policy "spot_groups_delete" on public.spot_groups for delete using (creator_id = auth.uid());

-- ─── RLS spot_group_members ──────────────────────────────────────────────────
alter table public.spot_group_members enable row level security;

-- Uses SECURITY DEFINER function to avoid self-referential recursion
create policy "spot_group_members_select" on public.spot_group_members for select using (
  group_id in (select get_my_group_ids())
);
create policy "spot_group_members_insert" on public.spot_group_members for insert with check (
  group_id in (select id from public.spot_groups where creator_id = auth.uid())
  or user_id = auth.uid() -- pour s'ajouter soi-même en acceptant une invitation
);
create policy "spot_group_members_delete" on public.spot_group_members for delete using (
  user_id = auth.uid()
  or group_id in (select id from public.spot_groups where creator_id = auth.uid())
);

-- ─── RLS spot_group_invitations ──────────────────────────────────────────────
alter table public.spot_group_invitations enable row level security;

create policy "spot_group_invitations_select" on public.spot_group_invitations for select using (
  invitee_id = auth.uid()
  or group_id in (select id from public.spot_groups where creator_id = auth.uid())
);
-- Any group member can invite (not just the creator)
create policy "spot_group_invitations_insert" on public.spot_group_invitations for insert with check (
  inviter_id = auth.uid()
  and group_id in (select get_my_group_ids())
);
create policy "spot_group_invitations_update" on public.spot_group_invitations for update using (
  invitee_id = auth.uid()
  or group_id in (select id from public.spot_groups where creator_id = auth.uid())
);

-- ─── Realtime ─────────────────────────────────────────────────────────────────
alter table public.spot_group_invitations replica identity full;
alter publication supabase_realtime add table public.spot_group_invitations;
