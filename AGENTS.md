<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Project notes

## Verification
- Typecheck: `npx tsc --noEmit` (run `npm run build` once first: Next generates the global `LayoutProps` type)
- Lint: `npx eslint src`
- Tests: `npm test` (unit tests in `tests/`; the DB integration test runs only when `TEST_DATABASE_URL` points to a throwaway Postgres — it wipes it)
- Build: `npm run build`

## Environment variables
- Postgres (Neon), see `src/lib/pg.ts` and `src/lib/queries.ts`:
  - `DATABASE_URL` or `POSTGRES_URL` (pooled connection string, e.g. `postgresql://…@…-pooler.…neon.tech/…`).
  - File contents (documents, meeting attachments) are stored in the DB itself (`bytea` column `content`).
  - Schema: `schema.sql` for a new DB, `migrations/*.sql` for an existing one. Keep both in sync with `queries.ts`; `tests/db.integration.test.ts` checks it.
  - Row mappers normalize dates to `YYYY-MM-DD` and times to `HH:MM` (`toDateOnly`, `toHHMM` in `src/lib/pg.ts`) so the code works whether columns are `date`/`time` or `text` (legacy Firestore import). Don't cast params to `uuid`/`text` explicitly in INSERTs; let Postgres infer from the column.
  - `SEED_DEMO=true` + `DEMO_PASSWORD` to seed demo accounts (admin@demo.com / employe@demo.com) outside development.
- `APP_URL`: public base URL used in emailed links (password reset). Never build links from the request Host header.
- `NEXT_PUBLIC_APP_TIME_ZONE` (default `Africa/Tunis`): company time zone. Use `todayStr()`, `nowHHMM()`, `nowInAppTimeZone()` from `src/lib/date.ts` for "today"/punch times; never `new Date().toISOString().slice(0, 10)` (UTC) or server-local `getHours()`.
- First admin: `node scripts/create-admin.mjs <email> "<name>"`. All env vars are listed in `.env.example`.
- Email notifications (`src/lib/mail.ts`, nodemailer over SMTP). If `SMTP_HOST` is missing, emails are only logged to the console:
  - `SMTP_HOST`, `SMTP_PORT` (default 587, 465 = TLS implicit), `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` (e.g. `"Suivi Horaire <no-reply@example.com>"`).

## Business rules
- `computeDayHours` (`src/lib/hours.ts`): congé/maladie = standard weekday hours; férié payé = standard hours + worked hours if the employee punched; férié non payé/repos = 0 paid hours, worked hours are converted into leave (recovery) days by `countRecoveryDays` (`src/lib/leaves.ts`). Covered by `tests/hours.test.ts`.
- Imports (CSV/Excel and OCR) ADD hours to the existing day. CSV/Excel: `isAlreadyImported` skips a row identical to one already imported so re-importing a file doesn't double hours. OCR: a draft can be confirmed only once (`status = 'pending'`), but scanning the same sheet twice creates new drafts — the reviewer must reject them.
- Punching on a férié/repos day keeps the day type (`punchIn` in `src/lib/queries.ts`); marking a day as férié/repos keeps existing punch times (`bulkSetDayType`).
- Emails are sent with `after()` from server actions: new non-working day (to all employees), leave request decision (to the employee), new leave request (to admins).
