-- Fonction SECURITY DEFINER pour éviter la dépendance circulaire RLS
-- spot_groups SELECT ne peut pas interroger spot_group_invitations directement
-- car spot_group_invitations SELECT interroge spot_groups → boucle infinie
create or replace function public.get_my_pending_group_ids()
returns setof uuid language sql security definer stable set search_path = public
as $$ select group_id from public.spot_group_invitations where invitee_id = auth.uid() and status = 'pending' $$;

-- Remplacer la policy spot_groups SELECT par une version sans dépendance circulaire
drop policy if exists "spot_groups_select" on public.spot_groups;
create policy "spot_groups_select" on public.spot_groups for select using (
  creator_id = auth.uid()
  or id in (select get_my_group_ids())
  or id in (select get_my_pending_group_ids())
);
