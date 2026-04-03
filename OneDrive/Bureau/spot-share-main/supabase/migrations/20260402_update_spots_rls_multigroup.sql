-- Étendre spots_select pour inclure les spots accessibles via spot_group_spots
drop policy if exists "spots_select" on public.spots;
create policy "spots_select" on public.spots for select using (
  user_id = auth.uid()
  or (
    (visibility = 'friends' or visibility is null)
    and user_id in (select following_id from public.followers where follower_id = auth.uid())
  )
  or (
    visibility = 'group'
    and group_id in (select get_my_group_ids())
  )
  or id in (
    select spot_id from public.spot_group_spots
    where group_id in (select get_my_group_ids())
  )
);
