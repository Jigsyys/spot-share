-- Grants pour les tables outings et outing_invitations
GRANT SELECT, INSERT, UPDATE ON public.outings TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.outing_invitations TO authenticated;
