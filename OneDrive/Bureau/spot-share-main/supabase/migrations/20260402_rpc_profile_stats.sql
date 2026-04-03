-- RPC : get_profile_stats
-- Regroupe en 1 seul appel : profil + followers + following + total likes reçus
-- Utilisé par ProfileModal.tsx (stale-while-revalidate cache)

CREATE OR REPLACE FUNCTION public.get_profile_stats(p_user_id uuid)
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT json_build_object(
    'username',        p.username,
    'avatar_url',      p.avatar_url,
    'is_ghost_mode',   p.is_ghost_mode,
    'followers_count', (SELECT COUNT(*) FROM public.followers WHERE following_id = p_user_id),
    'following_count', (SELECT COUNT(*) FROM public.followers WHERE follower_id  = p_user_id),
    'total_likes',     (
      SELECT COUNT(*)
      FROM public.spot_reactions sr
      JOIN public.spots s ON s.id = sr.spot_id
      WHERE s.user_id = p_user_id
        AND sr.user_id != p_user_id
    )
  )
  FROM public.profiles p
  WHERE p.id = p_user_id;
$$;

GRANT EXECUTE ON FUNCTION public.get_profile_stats(uuid) TO authenticated;
