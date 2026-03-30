-- ============================================================
-- FIX: Politique RLS pour la table followers
-- Colle ce script dans Supabase SQL Editor et appuie sur Run
-- ============================================================

-- 1. S'assurer que la table followers existe avec les bonnes colonnes
CREATE TABLE IF NOT EXISTS public.followers (
  follower_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  following_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at   timestamptz DEFAULT now(),
  PRIMARY KEY (follower_id, following_id)
);

-- 2. Activer RLS
ALTER TABLE public.followers ENABLE ROW LEVEL SECURITY;

-- 3. Supprimer les anciennes politiques potentiellement mal configurées
DROP POLICY IF EXISTS "followers_select" ON public.followers;
DROP POLICY IF EXISTS "followers_insert" ON public.followers;
DROP POLICY IF EXISTS "followers_delete" ON public.followers;
DROP POLICY IF EXISTS "Users can view followers"  ON public.followers;
DROP POLICY IF EXISTS "Users can insert own follow" ON public.followers;
DROP POLICY IF EXISTS "Users can delete own follow" ON public.followers;

-- 4. SELECT : tout utilisateur authentifié peut lire la table
CREATE POLICY "followers_select"
  ON public.followers FOR SELECT
  TO authenticated
  USING (true);

-- 5. INSERT : on peut créer une ligne uniquement si on est le follower
CREATE POLICY "followers_insert"
  ON public.followers FOR INSERT
  TO authenticated
  WITH CHECK (follower_id = auth.uid());

-- 6. DELETE : on peut supprimer uniquement ses propres follows
CREATE POLICY "followers_delete"
  ON public.followers FOR DELETE
  TO authenticated
  USING (follower_id = auth.uid());

-- ============================================================
-- FIX: Politique RLS pour la table friend_requests
-- ============================================================

CREATE TABLE IF NOT EXISTS public.friend_requests (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  to_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status     text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
  created_at timestamptz DEFAULT now(),
  UNIQUE (from_id, to_id)
);

ALTER TABLE public.friend_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fr_select"  ON public.friend_requests;
DROP POLICY IF EXISTS "fr_insert"  ON public.friend_requests;
DROP POLICY IF EXISTS "fr_update"  ON public.friend_requests;
DROP POLICY IF EXISTS "fr_delete"  ON public.friend_requests;

-- SELECT : voir les demandes qu'on a envoyées ou reçues
CREATE POLICY "fr_select"
  ON public.friend_requests FOR SELECT
  TO authenticated
  USING (from_id = auth.uid() OR to_id = auth.uid());

-- INSERT : envoyer une demande avec son propre ID
CREATE POLICY "fr_insert"
  ON public.friend_requests FOR INSERT
  TO authenticated
  WITH CHECK (from_id = auth.uid());

-- UPDATE : seul le destinataire peut accepter/refuser
CREATE POLICY "fr_update"
  ON public.friend_requests FOR UPDATE
  TO authenticated
  USING (to_id = auth.uid());

-- DELETE : l'envoyeur peut annuler sa demande
CREATE POLICY "fr_delete"
  ON public.friend_requests FOR DELETE
  TO authenticated
  USING (from_id = auth.uid());

-- ============================================================
-- FIX suivant : le mutual follow doit s'insérer même si on
-- n'est PAS le follower (quand on accepte, on insère les 2).
-- On crée une fonction sécurisée SECURITY DEFINER pour ça.
-- ============================================================

CREATE OR REPLACE FUNCTION public.accept_friend_request(request_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_from_id uuid;
  v_to_id   uuid;
BEGIN
  -- Récupérer les IDs depuis la demande
  SELECT from_id, to_id
  INTO v_from_id, v_to_id
  FROM friend_requests
  WHERE id = request_id AND to_id = auth.uid() AND status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Demande introuvable ou accès refusé';
  END IF;

  -- Mettre à jour le statut
  UPDATE friend_requests SET status = 'accepted' WHERE id = request_id;

  -- Créer le suivi mutuel (fonctionne même avec la politique RLS restrictive)
  INSERT INTO followers (follower_id, following_id)
  VALUES (v_to_id, v_from_id), (v_from_id, v_to_id)
  ON CONFLICT DO NOTHING;
END;
$$;

-- Donner accès à la fonction aux utilisateurs authentifiés
GRANT EXECUTE ON FUNCTION public.accept_friend_request(uuid) TO authenticated;
