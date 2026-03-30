-- Activer le Realtime (notifications) pour les sorties
-- C'est ce qui permet d'envoyer la notification directement dans l'application 
-- sans que l'ami ait besoin de recharger la page.

ALTER PUBLICATION supabase_realtime ADD TABLE public.outings;
ALTER PUBLICATION supabase_realtime ADD TABLE public.outing_invitations;
