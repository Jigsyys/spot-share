-- Fonction appelée par le client pour supprimer son propre compte.
-- SECURITY DEFINER : s'exécute avec les droits du propriétaire (postgres)
-- ce qui permet de supprimer depuis auth.users.
-- Le ON DELETE CASCADE sur toutes les tables publiques (spots, profiles,
-- followers, friend_requests, spot_reactions, spot_visits, outings,
-- outing_invitations) assure le nettoyage complet en cascade.

CREATE OR REPLACE FUNCTION public.delete_user()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  -- Nettoyer explicitement les relations many-to-many sans FK directe
  DELETE FROM public.followers
    WHERE follower_id = auth.uid() OR following_id = auth.uid();

  DELETE FROM public.friend_requests
    WHERE from_id = auth.uid() OR to_id = auth.uid();

  -- Supprimer le compte auth → cascade sur toutes les tables liées
  DELETE FROM auth.users WHERE id = auth.uid();
$$;

GRANT EXECUTE ON FUNCTION public.delete_user() TO authenticated;
