# Suivi Horaire — App RH

Application web de suivi des heures de travail, congés et maladie, inspirée du fichier Excel `Administration - Suivi horaire`. Trois espaces : **Admin RH**, **Employé** et **Comptable**.

## Stack

- **Next.js 16** (App Router, Server Actions, TypeScript)
- **PostgreSQL sur Neon** (driver `@neondatabase/serverless`), requêtes SQL dans `src/lib/queries.ts`
- Authentification maison : mots de passe hachés (scrypt), sessions en base (`sessions`)
- **Tailwind CSS** — interface ; PWA installable
- Emails via SMTP (nodemailer), OCR via Google Vision ou Tesseract.js

## 1. Base de données

1. Crée un projet sur [neon.tech](https://neon.tech) et récupère la chaîne de connexion *pooled*.
2. **Nouvelle base** : exécute `schema.sql` dans l'éditeur SQL Neon.
3. **Base existante** (mise à jour) : exécute `migrations/001_sync_schema.sql`. Elle est idempotente (on peut la relancer sans risque). Conseil : la tester d'abord sur une branche Neon.

## 2. Variables d'environnement

Copie `.env.example` en `.env.local` et remplis au minimum `DATABASE_URL` (et `APP_URL` en production). Toutes les variables sont décrites dans `.env.example`.

## 3. Créer le premier compte Admin RH

```bash
npm install
DATABASE_URL="postgresql://..." node scripts/create-admin.mjs admin@example.com "Admin RH"
```

Le mot de passe est demandé au clavier. Connecte-toi ensuite avec cet email : tu arrives sur `/admin`.

En développement (`npm run dev`), des comptes démo sont aussi créés automatiquement : `admin@demo.com` / `admin123` et `employe@demo.com` / `employe123`.

## 4. Lancer en local

```bash
npm install
npm run dev
```

Ouvre [http://localhost:3000](http://localhost:3000).

## 5. Vérifications

```bash
npx tsc --noEmit   # types
npx eslint src     # lint
npm test           # tests unitaires (calcul des heures, congés, dates/fuseaux)
npm run build      # build de production
```

Test d'intégration de la base (exécute le vrai code de `src/lib/queries.ts` contre un Postgres créé à partir de `schema.sql`) :

```bash
# ⚠️ La base indiquée est entièrement effacée : utiliser une base de test locale, jamais la production.
TEST_DATABASE_URL=postgresql://postgres@localhost:5432/suivi_test npm test
```

## Fonctionnalités

- **Employé** : pointage (arrivée, pause, départ, présentiel/télétravail), historique des heures, résumé hebdomadaire vs objectif, demandes de congé/maladie, tâches du jour, documents, calendrier, messagerie, réunions.
- **Admin RH** : gestion des employés et des comptes, validation des congés, jours fériés/repos (import des fériés tunisiens), correction des heures, fiches de paie, réunions (comptes rendus, pièces jointes), annonces, import d'heures depuis CSV/Excel ou par photo de feuille papier (avec relecture avant validation).
  - **Vue d'ensemble** : qui est là aujourd'hui (bureau, télétravail, pause, absents) et **Points à vérifier** : détection automatique, sur 30 jours, des départs non pointés, heures payées incohérentes (ex. import en double), journées anormalement longues, jours ouvrés sans aucun pointage, arrivées inhabituelles (comparées aux habitudes de chaque employé : médiane et écart absolu médian) et soldes de congé dépassés (`src/lib/anomalies.ts`).
  - **Lecture des feuilles par IA** : avec `ANTHROPIC_API_KEY`, l'import par scan utilise Claude (vision) : écriture manuscrite, feuilles à plusieurs employés (noms rapprochés des comptes), année déduite, lignes douteuses signalées. Sans clé, ou en cas d'erreur, l'OCR classique prend le relais (`src/lib/ai-timesheet.ts`).
- **Comptable** : consultation des heures et des salaires, et **export de paie Excel** (aussi pour la RH) : synthèse par employé, détail jour par jour et points à vérifier, prêt à imprimer (`/api/exports/payroll`).

## Règles de calcul (`src/lib/hours.ts`, `src/lib/leaves.ts`)

- Jour normal : heures = Fin − Début − Pause.
- Congé / Maladie : heures standard du jour de la semaine de l'employé.
- Férié payé : heures standard + heures réellement travaillées si l'employé a pointé.
- Férié non payé / Repos : 0 heure payée ; les heures travaillées ces jours-là sont converties en jours de congé (heures ÷ heures standard du jour, 8 h si le jour n'en a pas).
- Congés : droit mensuel fixe (non reportable) + jours de récupération − jours pris.
- Toutes les dates « aujourd'hui » et les heures de pointage sont calculées dans le fuseau de l'entreprise (`Africa/Tunis` par défaut, voir `NEXT_PUBLIC_APP_TIME_ZONE`).

## Déploiement

Déployable sur Vercel. Renseigner les variables d'environnement de `.env.example` dans les paramètres du projet, et exécuter la migration SQL sur la base avant de déployer une nouvelle version qui en contient une.
