-- Migration 001 : aligne une base existante sur ce qu'attend le code (src/lib/queries.ts).
--
-- Idempotent : peut être exécutée plusieurs fois sans effet de bord. Chaque étape
-- vérifie d'abord ce qui existe, donc elle fonctionne aussi bien sur une base créée
-- avec l'ancien schema.sql que sur une base issue de la migration Firestore.
--
-- À exécuter une fois dans la console SQL Neon (ou psql) AVANT de déployer cette version.
-- Conseil : créer d'abord une branche Neon pour tester, ou faire une sauvegarde.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. Table de limitation des tentatives de connexion (utilisée par le login).
CREATE TABLE IF NOT EXISTS auth_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_auth_attempts_identifier ON auth_attempts(identifier, created_at);

-- 2. time_entries.imported (marque les heures issues d'un import de fichier).
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS imported boolean NOT NULL DEFAULT false;

-- 3. messages : participants et lecteurs stockés dans le message.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS participant_ids text[] NOT NULL DEFAULT '{}';
ALTER TABLE messages ADD COLUMN IF NOT EXISTS read_by text[] NOT NULL DEFAULT '{}';
UPDATE messages
SET participant_ids = CASE
  WHEN recipient_id IS NULL THEN ARRAY[sender_id::text]
  ELSE ARRAY[sender_id::text, recipient_id::text]
END
WHERE cardinality(participant_ids) = 0;

-- 4. Contenu des fichiers : le code lit/écrit la colonne `content`.
--    Ancien schema.sql : `file_data` -> renommée en `content`.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['documents', 'meeting_attachments'] LOOP
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema = current_schema() AND table_name = t AND column_name = 'file_data')
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema = current_schema() AND table_name = t AND column_name = 'content') THEN
      EXECUTE format('ALTER TABLE %I RENAME COLUMN file_data TO content', t);
    END IF;
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS content bytea', t);
  END LOOP;
END$$;

-- 5. profiles.email_lower : le code ne la renseigne pas (il compare lower(email)).
--    Si elle existe, on la rend facultative pour que la création de comptes fonctionne.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = current_schema() AND table_name = 'profiles' AND column_name = 'email_lower') THEN
    ALTER TABLE profiles ALTER COLUMN email_lower DROP NOT NULL;
  END IF;
END$$;
ALTER TABLE profiles ALTER COLUMN company SET DEFAULT '';

-- 6. Unicité des emails sans tenir compte de la casse.
DO $$
BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_email_lower ON profiles (lower(email));
EXCEPTION WHEN unique_violation THEN
  RAISE NOTICE 'Index idx_profiles_email_lower non créé : des emails en double existent. Requête pour les trouver : SELECT lower(email), count(*) FROM profiles GROUP BY 1 HAVING count(*) > 1;';
END$$;

-- 7. Jetons de session / réinitialisation en text : avec une colonne uuid, un cookie ou
--    un lien mal formé provoque une erreur SQL (page 500) au lieu d'un simple refus.
ALTER TABLE sessions ALTER COLUMN token DROP DEFAULT;
ALTER TABLE sessions ALTER COLUMN token TYPE text;
ALTER TABLE password_resets ALTER COLUMN token DROP DEFAULT;
ALTER TABLE password_resets ALTER COLUMN token TYPE text;

-- 8. Tables plus utilisées par le code (remplacées par messages.participant_ids / read_by).
--    Non supprimées automatiquement par prudence ; à supprimer à la main si vides :
--    DROP TABLE IF EXISTS message_participants; DROP TABLE IF EXISTS message_reads;
