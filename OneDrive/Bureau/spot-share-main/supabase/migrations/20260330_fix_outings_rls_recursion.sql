-- Fix récursion infinie dans les politiques RLS des outings
-- Problème : outings_select → outing_invitations → outing_invitations_select → outings → boucle !
-- Solution : SECURITY DEFINER function qui bypass le RLS pour vérifier le créateur

-- 1. Fonction helper qui lit outings SANS déclencher le RLS (SECURITY DEFINER)
CREATE OR REPLACE FUNCTION public.get_outing_creator_id(p_outing_id uuid)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT creator_id FROM public.outings WHERE id = p_outing_id;
$$;

-- 2. Supprimer et recréer les policies qui causaient la récursion

-- outings : lecture — liste d'abord par creator_id, puis vérifie les invitations (sens unique)
DROP POLICY IF EXISTS "outings_select" ON public.outings;
CREATE POLICY "outings_select" ON public.outings
  FOR SELECT USING (
    creator_id = auth.uid()
    OR id IN (
      SELECT outing_id FROM public.outing_invitations
      WHERE invitee_id = auth.uid()
      -- Note: on ne vérifie PAS outings ici → pas de récursion
    )
  );

-- outing_invitations : lecture — utilise la fonction SECURITY DEFINER, pas de subquery sur outings
DROP POLICY IF EXISTS "outing_invitations_select" ON public.outing_invitations;
CREATE POLICY "outing_invitations_select" ON public.outing_invitations
  FOR SELECT USING (
    invitee_id = auth.uid()
    OR public.get_outing_creator_id(outing_id) = auth.uid()
    -- get_outing_creator_id bypasse le RLS → pas de récursion
  );

-- outing_invitations : insertion — utilise aussi la fonction SECURITY DEFINER
DROP POLICY IF EXISTS "outing_invitations_insert" ON public.outing_invitations;
CREATE POLICY "outing_invitations_insert" ON public.outing_invitations
  FOR INSERT WITH CHECK (
    public.get_outing_creator_id(outing_id) = auth.uid()
  );

-- outing_invitations : réponse (invité uniquement, pas de référence à outings)
DROP POLICY IF EXISTS "outing_invitations_update" ON public.outing_invitations;
CREATE POLICY "outing_invitations_update" ON public.outing_invitations
  FOR UPDATE USING (invitee_id = auth.uid());
