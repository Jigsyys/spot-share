-- Fix 1: spot_groups SELECT — allow invitees to see groups they're invited to
drop policy if exists "spot_groups_select" on public.spot_groups;
create policy "spot_groups_select" on public.spot_groups for select using (
  creator_id = auth.uid()
  or id in (select get_my_group_ids())
  or id in (
    select group_id from public.spot_group_invitations
    where invitee_id = auth.uid() and status = 'pending'
  )
);

-- Fix 2: spot_group_invitations DELETE — allow inviter or group creator to delete
create policy "spot_group_invitations_delete" on public.spot_group_invitations for delete using (
  inviter_id = auth.uid()
  or group_id in (select id from public.spot_groups where creator_id = auth.uid())
);
