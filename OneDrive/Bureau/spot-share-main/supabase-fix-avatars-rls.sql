-- Fix RLS policies pour le bucket "avatars"
-- À coller dans Supabase → SQL Editor → Run

-- 1. Supprimer les anciennes policies si elles existent
DROP POLICY IF EXISTS "Avatar upload by owner" ON storage.objects;
DROP POLICY IF EXISTS "Avatar update by owner" ON storage.objects;
DROP POLICY IF EXISTS "Avatar delete by owner" ON storage.objects;
DROP POLICY IF EXISTS "Avatar public read" ON storage.objects;

-- 2. Lecture publique (tout le monde peut voir les avatars)
CREATE POLICY "Avatar public read"
ON storage.objects FOR SELECT
USING (bucket_id = 'avatars');

-- 3. Upload : utilisateur connecté peut uploader dans son propre dossier
CREATE POLICY "Avatar upload by owner"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'avatars');

-- 4. Mise à jour : utilisateur connecté peut modifier ses propres fichiers
CREATE POLICY "Avatar update by owner"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);

-- 5. Suppression : utilisateur connecté peut supprimer ses propres fichiers
CREATE POLICY "Avatar delete by owner"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);
