-- Performance indexes — niveau 1
-- Réduit les seq scans sur les requêtes les plus fréquentes au boot et en polling

-- followers : lookup par follower au boot (fetchFollowing)
CREATE INDEX IF NOT EXISTS idx_followers_follower_id
  ON public.followers (follower_id);

-- spot_reactions : count par spot_id + type (fetchLikeCounts, badge likes)
CREATE INDEX IF NOT EXISTS idx_spot_reactions_spot_id_type
  ON public.spot_reactions (spot_id, type);

-- outing_invitations : badge + feed invitations (invitee_id, status)
CREATE INDEX IF NOT EXISTS idx_outing_invitations_invitee_status
  ON public.outing_invitations (invitee_id, status);

-- friend_requests : badge notifs + feed (to_id, status) et (from_id, status)
CREATE INDEX IF NOT EXISTS idx_friend_requests_to_id_status
  ON public.friend_requests (to_id, status);
CREATE INDEX IF NOT EXISTS idx_friend_requests_from_id_status
  ON public.friend_requests (from_id, status);

-- outings : liste des sorties actives du créateur
CREATE INDEX IF NOT EXISTS idx_outings_creator_status
  ON public.outings (creator_id, status);

-- spots : filtre par user_id (mode "mine" + checkNewLikes)
CREATE INDEX IF NOT EXISTS idx_spots_user_id
  ON public.spots (user_id);
