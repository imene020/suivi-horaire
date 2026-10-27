-- Schéma SQL (PostgreSQL) pour l'application RH / suivi horaire ELENI
-- Conversion des collections Firestore en tables relationnelles
--
-- Nouvelle base : exécuter ce fichier tel quel.
-- Base existante : exécuter migrations/001_sync_schema.sql (idempotent).
-- Ce fichier est vérifié par tests/db.integration.test.ts, qui exécute le code
-- réel de src/lib/queries.ts contre une base créée à partir de lui.

-- Extension nécessaire pour gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Types énumérés
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'app_role') THEN
    CREATE TYPE app_role AS ENUM ('admin', 'employee', 'comptable');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'day_type') THEN
    CREATE TYPE day_type AS ENUM ('normal', 'conge', 'maladie', 'ferie_paye', 'ferie_non_paye', 'repos');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'work_mode') THEN
    CREATE TYPE work_mode AS ENUM ('presentiel', 'teletravail');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'leave_type') THEN
    CREATE TYPE leave_type AS ENUM ('conge', 'maladie');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'request_status') THEN
    CREATE TYPE request_status AS ENUM ('pending', 'approved', 'rejected');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'recurrence_type') THEN
    CREATE TYPE recurrence_type AS ENUM ('none', 'weekly', 'monthly');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'document_category') THEN
    CREATE TYPE document_category AS ENUM ('employe', 'paie', 'maladie', 'cv');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notification_type') THEN
    CREATE TYPE notification_type AS ENUM (
      'holiday', 'leave_request', 'leave_decision', 'team_leave',
      'payslip', 'salary', 'task', 'meeting', 'message', 'ocr_scan', 'info'
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ocr_status') THEN
    CREATE TYPE ocr_status AS ENUM ('pending', 'confirmed', 'rejected');
  END IF;
END$$;

-- Comptes utilisateurs
CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY,
  email text NOT NULL,
  full_name text NOT NULL,
  role app_role NOT NULL,
  function_title text,
  company text NOT NULL DEFAULT '',
  phone text,
  weekly_target_hours numeric NOT NULL DEFAULT 0,
  weekday_hours jsonb NOT NULL DEFAULT '{"0":0,"1":0,"2":0,"3":0,"4":0,"5":0,"6":0}'::jsonb,
  monthly_salary numeric NOT NULL DEFAULT 0,
  conge_days_per_month numeric NOT NULL DEFAULT 1.5,
  maladie_days_per_month numeric NOT NULL DEFAULT 0.5,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  password_hash text NOT NULL,
  qr_token text NOT NULL UNIQUE,
  pin_code text
);

-- Pointages / heures
CREATE TABLE IF NOT EXISTS time_entries (
  id text PRIMARY KEY,
  profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  entry_date date NOT NULL,
  day_type day_type NOT NULL DEFAULT 'normal',
  work_mode work_mode,
  start_time time,
  end_time time,
  break_minutes integer NOT NULL DEFAULT 0,
  break_start time,
  hours numeric NOT NULL DEFAULT 0,
  tasks text,
  remarks text,
  imported boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (profile_id, entry_date)
);

-- Soldes de congés/maladie
CREATE TABLE IF NOT EXISTS leave_balances (
  id text PRIMARY KEY,
  profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  year integer NOT NULL,
  leave_type leave_type NOT NULL,
  total numeric NOT NULL DEFAULT 0,
  used numeric NOT NULL DEFAULT 0,
  UNIQUE (profile_id, year, leave_type)
);

-- Demandes de congé/maladie
CREATE TABLE IF NOT EXISTS leave_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  leave_type leave_type NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  comment text,
  status request_status NOT NULL DEFAULT 'pending',
  admin_comment text,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz
);

-- Tâches employés
CREATE TABLE IF NOT EXISTS employee_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  task_date date NOT NULL,
  title text NOT NULL,
  description text,
  is_innovation boolean NOT NULL DEFAULT false,
  done boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Documents (métadonnées + contenu optionnel)
CREATE TABLE IF NOT EXISTS documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  original_name text NOT NULL,
  mime_type text NOT NULL,
  size integer NOT NULL DEFAULT 0,
  note text,
  category document_category NOT NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  content bytea
);

-- Réunions
CREATE TABLE IF NOT EXISTS meetings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  location text,
  meeting_link text,
  start_at timestamptz NOT NULL,
  end_at timestamptz,
  created_by uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  recurrence recurrence_type NOT NULL DEFAULT 'none',
  minutes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Participants aux réunions
CREATE TABLE IF NOT EXISTS meeting_participants (
  meeting_id uuid NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  full_name text,
  PRIMARY KEY (meeting_id, profile_id)
);

-- Pièces-jointes de réunions
CREATE TABLE IF NOT EXISTS meeting_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id uuid NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  original_name text NOT NULL,
  mime_type text NOT NULL,
  size integer NOT NULL DEFAULT 0,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  content bytea
);

-- Messages
CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  sender_name text NOT NULL,
  recipient_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  is_broadcast boolean NOT NULL DEFAULT false,
  -- Expéditeur + destinataire (expéditeur seul pour une annonce), pour lister les conversations.
  participant_ids text[] NOT NULL DEFAULT '{}',
  -- Comptes ayant lu le message.
  read_by text[] NOT NULL DEFAULT '{}'
);

-- Notifications
CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type notification_type NOT NULL,
  title text NOT NULL,
  body text,
  link text,
  read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Lignes OCR en attente de validation
CREATE TABLE IF NOT EXISTS ocr_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL,
  document_id uuid REFERENCES documents(id) ON DELETE SET NULL,
  profile_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  full_name text,
  entry_date date,
  start_time time,
  end_time time,
  break_minutes integer NOT NULL DEFAULT 0,
  hours numeric NOT NULL DEFAULT 0,
  raw_line text NOT NULL,
  valid boolean NOT NULL DEFAULT false,
  issues text[] NOT NULL DEFAULT '{}',
  status ocr_status NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Sessions (token en text : un cookie mal formé ne doit pas provoquer d'erreur SQL)
CREATE TABLE IF NOT EXISTS sessions (
  token text PRIMARY KEY,
  profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  expires bigint NOT NULL
);

-- Tokens de réinitialisation de mot de passe
CREATE TABLE IF NOT EXISTS password_resets (
  token text PRIMARY KEY,
  profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  expires bigint NOT NULL,
  used boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Tentatives de connexion / réinitialisation (limitation anti brute-force, src/lib/rate-limit.ts)
CREATE TABLE IF NOT EXISTS auth_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes recommandés
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_email_lower ON profiles (lower(email));
CREATE INDEX IF NOT EXISTS idx_time_entries_profile_id ON time_entries(profile_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_entry_date ON time_entries(entry_date);
CREATE INDEX IF NOT EXISTS idx_leave_balances_profile_year ON leave_balances(profile_id, year);
CREATE INDEX IF NOT EXISTS idx_leave_requests_profile_id ON leave_requests(profile_id);
CREATE INDEX IF NOT EXISTS idx_leave_requests_status ON leave_requests(status);
CREATE INDEX IF NOT EXISTS idx_documents_profile_id ON documents(profile_id);
CREATE INDEX IF NOT EXISTS idx_documents_category ON documents(category);
CREATE INDEX IF NOT EXISTS idx_meetings_start_at ON meetings(start_at);
CREATE INDEX IF NOT EXISTS idx_meetings_created_by ON meetings(created_by);
CREATE INDEX IF NOT EXISTS idx_meeting_participants_profile ON meeting_participants(profile_id);
CREATE INDEX IF NOT EXISTS idx_messages_participants ON messages USING gin (participant_ids);
CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_messages_recipient ON messages(recipient_id);
CREATE INDEX IF NOT EXISTS idx_notifications_profile_read ON notifications(profile_id, read);
CREATE INDEX IF NOT EXISTS idx_ocr_drafts_status ON ocr_drafts(status);
CREATE INDEX IF NOT EXISTS idx_ocr_drafts_batch ON ocr_drafts(batch_id);
CREATE INDEX IF NOT EXISTS idx_password_resets_profile ON password_resets(profile_id);
CREATE INDEX IF NOT EXISTS idx_sessions_profile ON sessions(profile_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires);
CREATE INDEX IF NOT EXISTS idx_auth_attempts_identifier ON auth_attempts(identifier, created_at);
