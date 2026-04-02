-- ═══════════════════════════════════════════════════════
-- Table activities
-- ═══════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.activities (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type           text NOT NULL CHECK (type IN ('spot_added','reaction','friend_request_accepted','outing_invite')),
  actor_id       uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  target_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  spot_id        uuid REFERENCES public.spots(id) ON DELETE SET NULL,
  outing_id      uuid REFERENCES public.outings(id) ON DELETE SET NULL,
  read_at        timestamptz,
  created_at     timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_activities_target
  ON public.activities(target_user_id, created_at DESC);

-- ═══════════════════════════════════════════════════════
-- Table push_subscriptions
-- ═══════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  user_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  endpoint   text NOT NULL,
  p256dh     text NOT NULL,
  auth       text NOT NULL,
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (user_id, endpoint)
);

-- ═══════════════════════════════════════════════════════
-- RLS
-- ═══════════════════════════════════════════════════════
ALTER TABLE public.activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

-- activities : lire uniquement ses propres notifs
CREATE POLICY "activities_select_own" ON public.activities
  FOR SELECT USING (target_user_id = auth.uid());

-- activities : marquer comme lu (UPDATE read_at)
CREATE POLICY "activities_update_own" ON public.activities
  FOR UPDATE USING (target_user_id = auth.uid());

-- push_subscriptions : CRUD sur ses propres rows
CREATE POLICY "push_sub_all_own" ON public.push_subscriptions
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ═══════════════════════════════════════════════════════
-- Grants pour les triggers SECURITY DEFINER
-- ═══════════════════════════════════════════════════════
GRANT INSERT ON public.activities TO postgres;

-- ═══════════════════════════════════════════════════════
-- Trigger 1 : reaction → activity (avec cooldown 15min)
-- ═══════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.on_reaction_inserted()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_owner uuid;
BEGIN
  SELECT user_id INTO v_owner FROM spots WHERE id = NEW.spot_id;
  IF v_owner IS NULL OR v_owner = NEW.user_id THEN RETURN NEW; END IF;
  IF EXISTS (
    SELECT 1 FROM activities
    WHERE target_user_id = v_owner AND type = 'reaction'
      AND spot_id = NEW.spot_id
      AND created_at > now() - interval '15 minutes'
  ) THEN RETURN NEW; END IF;

  INSERT INTO activities (type, actor_id, target_user_id, spot_id)
  VALUES ('reaction', NEW.user_id, v_owner, NEW.spot_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reaction_inserted ON public.spot_reactions;
CREATE TRIGGER trg_reaction_inserted
  AFTER INSERT ON public.spot_reactions
  FOR EACH ROW EXECUTE FUNCTION public.on_reaction_inserted();

-- ═══════════════════════════════════════════════════════
-- Trigger 2 : spot ajouté → activity pour tous les followers
-- ═══════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.on_spot_inserted()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO activities (type, actor_id, target_user_id, spot_id)
  SELECT 'spot_added', NEW.user_id, f.follower_id, NEW.id
  FROM followers f
  WHERE f.following_id = NEW.user_id
    AND f.follower_id != NEW.user_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_spot_inserted ON public.spots;
CREATE TRIGGER trg_spot_inserted
  AFTER INSERT ON public.spots
  FOR EACH ROW EXECUTE FUNCTION public.on_spot_inserted();

-- ═══════════════════════════════════════════════════════
-- Trigger 3 : demande d'ami acceptée
-- ═══════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.on_friend_request_accepted()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'accepted' AND OLD.status = 'pending' THEN
    INSERT INTO activities (type, actor_id, target_user_id)
    VALUES ('friend_request_accepted', NEW.to_id, NEW.from_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_friend_request_accepted ON public.friend_requests;
CREATE TRIGGER trg_friend_request_accepted
  AFTER UPDATE ON public.friend_requests
  FOR EACH ROW EXECUTE FUNCTION public.on_friend_request_accepted();

-- ═══════════════════════════════════════════════════════
-- Trigger 4 : invitation à une sortie
-- ═══════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.on_outing_invite_inserted()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_creator uuid;
  v_spot    uuid;
BEGIN
  SELECT creator_id, spot_id INTO v_creator, v_spot FROM outings WHERE id = NEW.outing_id;
  IF v_creator IS NULL THEN RETURN NEW; END IF;

  INSERT INTO activities (type, actor_id, target_user_id, spot_id, outing_id)
  VALUES ('outing_invite', v_creator, NEW.invitee_id, v_spot, NEW.outing_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_outing_invite_inserted ON public.outing_invitations;
CREATE TRIGGER trg_outing_invite_inserted
  AFTER INSERT ON public.outing_invitations
  FOR EACH ROW EXECUTE FUNCTION public.on_outing_invite_inserted();

-- ═══════════════════════════════════════════════════════
-- Realtime sur activities
-- ═══════════════════════════════════════════════════════
ALTER TABLE public.activities REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE activities;

-- ═══════════════════════════════════════════════════════
-- Cleanup : supprimer les activities > 60 jours
-- ═══════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.cleanup_old_activities()
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM public.activities WHERE created_at < now() - interval '60 days';
$$;
