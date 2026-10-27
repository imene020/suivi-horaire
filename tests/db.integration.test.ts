/**
 * Integration test: runs the real data layer (src/lib/queries.ts) against a real
 * Postgres database built from schema.sql.
 *
 * Skipped unless TEST_DATABASE_URL is set. The database it points to is WIPED
 * (schema `public` is dropped and recreated) — never point it at production.
 *
 *   TEST_DATABASE_URL=postgresql://postgres@localhost:5432/suivi_test npm test
 */
import { readFileSync } from "fs";
import path from "path";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { Pool } from "pg";

vi.mock("@neondatabase/serverless", async () => {
  const { makeNeonShim } = await import("./setup/neon-pg");
  return { neon: (url: string) => makeNeonShim(url) };
});

const TEST_DB = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DB)("data layer against schema.sql", () => {
  let q: typeof import("@/lib/queries");
  let rl: typeof import("@/lib/rate-limit");
  let admin: string;
  let alice: string;
  let bob: string;

  beforeAll(async () => {
    const pool = new Pool({ connectionString: TEST_DB });
    await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    // TEST_SCHEMA_FILES lets you check a migration path, e.g. "old-schema.sql,migrations/001_sync_schema.sql".
    const files = (process.env.TEST_SCHEMA_FILES || "schema.sql").split(",");
    for (const f of files) {
      await pool.query(readFileSync(path.resolve(__dirname, "..", f.trim()), "utf8"));
    }
    await pool.end();

    process.env.DATABASE_URL = TEST_DB;
    q = await import("@/lib/queries");
    rl = await import("@/lib/rate-limit");

    const base = {
      password: "password123",
      function_title: "Consultant",
      company: "Test",
      weekly_target_hours: 40,
      weekday_hours: { "0": 0, "1": 8, "2": 8, "3": 8, "4": 8, "5": 8, "6": 0 },
      monthly_salary: 1000,
      conge_days_per_month: 1.5,
      maladie_days_per_month: 0.5,
    };
    alice = (await q.createEmployeeProfile({ ...base, email: "alice@test.com", full_name: "Alice" })).id!;
    bob = (await q.createEmployeeProfile({ ...base, email: "bob@test.com", full_name: "Bob" })).id!;
    admin = (await q.createComptableProfile({ ...base, email: "boss@test.com", full_name: "Boss" })).id!;
    await q.updateAccount(admin, { role: "admin" });
  });

  it("finds profiles by email and id", async () => {
    const p = await q.findProfileByEmail("ALICE@test.com");
    expect(p?.id).toBe(alice);
    expect(p?.weekday_hours["1"]).toBe(8);
    expect((await q.findProfileById(bob))?.full_name).toBe("Bob");
    expect((await q.listAdmins()).map((a) => a.id)).toContain(admin);
  });

  it("stores and reads time entries with string dates and HH:MM times", async () => {
    const res = await q.upsertEntry({
      profile_id: alice,
      entry_date: "2026-10-05", // Monday
      day_type: "normal",
      work_mode: "presentiel",
      start_time: "08:00",
      end_time: "17:00",
      break_minutes: 60,
      tasks: "",
      remarks: "",
    });
    expect(res.hours).toBe(8);

    const entries = await q.getEntriesInRange(alice, "2026-10-01", "2026-10-31");
    expect(entries).toHaveLength(1);
    expect(entries[0].entry_date).toBe("2026-10-05");
    expect(entries[0].start_time).toBe("08:00");
    expect(entries[0].end_time).toBe("17:00");
    expect(entries[0].hours).toBe(8);
  });

  it("marks company holidays and approved leave", async () => {
    await q.bulkSetDayType(
      [{ profile_id: alice, entry_date: "2026-10-06", day_type: "ferie_paye", default_tasks: "Fête" }],
      ["ferie_paye", "ferie_non_paye", "repos"]
    );
    const e = await q.getEntryByDate(alice, "2026-10-06");
    expect(e?.day_type).toBe("ferie_paye");
    expect(e?.hours).toBe(8);

    const req = await q.createLeaveRequest({
      profile_id: alice,
      leave_type: "conge",
      start_date: "2026-10-12",
      end_date: "2026-10-13",
      comment: "vacances",
    });
    expect(req.start_date).toBe("2026-10-12");
    const fetched = await q.getLeaveRequestById(req.id);
    expect(fetched?.start_date).toBe("2026-10-12");
    expect(fetched?.end_date).toBe("2026-10-13");
    const decided = await q.decideLeaveRequest(req.id, "approved", "ok");
    expect(decided.request?.status).toBe("approved");
  });

  it("punches in, takes a break and punches out today", async () => {
    expect((await q.punchIn(bob, "teletravail")).error).toBeUndefined();
    expect((await q.startBreak(bob)).error).toBeUndefined();
    expect((await q.endBreak(bob)).error).toBeUndefined();
    const out = await q.punchOut(bob);
    expect(out.error).toBeUndefined();
    expect(out.entry?.start_time).toMatch(/^\d{2}:\d{2}$/);
    expect(out.entry?.work_mode).toBe("teletravail");
    expect((await q.punchIn(bob)).error).toBeDefined(); // already punched
  });

  it("imports hours without doubling them when the same rows are imported twice", async () => {
    const row = {
      profile_id: bob,
      entry_date: "2026-09-01",
      day_type: "normal" as const,
      start_time: "09:00",
      end_time: "13:00",
      break_minutes: 0,
      work_mode: "presentiel" as const,
      hours: 4,
      tasks: null,
      remarks: null,
    };
    await q.bulkImportTimeEntries([row]);
    await q.bulkImportTimeEntries([row]);
    const e = await q.getEntryByDate(bob, "2026-09-01");
    expect(e?.hours).toBe(4);
    expect(e?.imported).toBe(true);
    const imported = await q.listImportedEntries();
    expect(imported.some((r) => r.profile_id === bob && r.entry_date === "2026-09-01")).toBe(true);
  });

  it("stores document and attachment contents", async () => {
    const doc = await q.createDocument({
      profile_id: alice,
      original_name: "fiche.pdf",
      mime_type: "application/pdf",
      size: 3,
      buffer: Buffer.from("abc"),
      category: "paie",
      note: null,
    });
    const content = await q.getDocumentContent(doc.id);
    expect(content?.content.toString()).toBe("abc");
    expect(await q.listDocumentsByProfile(alice)).toHaveLength(1);
  });

  it("sends notifications to several profiles", async () => {
    await q.createNotifications([alice, bob], { type: "info", title: "Hello" });
    expect(await q.countUnreadNotifications(alice)).toBe(1);
    const list = await q.listNotifications(bob);
    expect(list[0].title).toBe("Hello");
    await q.markNotificationsRead(bob, [list[0].id]);
    expect(await q.countUnreadNotifications(bob)).toBe(0);
  });

  it("creates meetings with participants and attachments", async () => {
    const [m] = await q.createMeeting({
      title: "Weekly",
      description: "",
      location: "",
      meeting_link: "",
      start_at: "2026-10-20T09:00:00Z",
      end_at: "2026-10-20T10:00:00Z",
      created_by: admin,
      recurrence: "none",
      recurrence_until: null,
      participant_ids: [alice, bob],
    });
    expect(await q.listMeetingParticipants(m.id)).toHaveLength(2);
    const aliceProfile = (await q.findProfileById(alice))!;
    expect((await q.listMeetingsFor(aliceProfile)).map((x) => x.id)).toContain(m.id);

    await q.updateMeeting(m.id, {
      title: "Weekly 2",
      description: "",
      location: "",
      meeting_link: "",
      start_at: "2026-10-20T09:00:00Z",
      end_at: null,
      participant_ids: [alice],
    });
    expect(await q.listMeetingParticipants(m.id)).toHaveLength(1);

    const att = await q.createMeetingAttachment({
      meeting_id: m.id,
      original_name: "cr.pdf",
      mime_type: "application/pdf",
      size: 2,
      buffer: Buffer.from("hi"),
    });
    expect((await q.getMeetingAttachmentContent(att.id))?.content.toString()).toBe("hi");
  });

  it("handles direct messages, broadcasts and read state", async () => {
    await q.sendMessage({ sender_id: alice, recipient_id: bob, body: "salut" });
    await q.sendMessage({ sender_id: admin, recipient_id: null, body: "annonce" });
    expect(await q.countUnreadMessages(bob)).toBe(2);
    expect(await q.listConversation(alice, bob)).toHaveLength(1);
    const convs = await q.listConversationsFor(bob);
    expect(convs[0].profile_id).toBe(alice);
    expect(convs[0].unread).toBe(1);
    await q.markConversationRead(bob, alice);
    await q.markBroadcastRead(bob);
    expect(await q.countUnreadMessages(bob)).toBe(0);
  });

  it("manages tasks", async () => {
    const t = await q.createTask({ profile_id: alice, task_date: "2026-10-05", title: "Rapport", description: "", is_innovation: false });
    await q.setTaskDone(t.id, alice, true);
    const tasks = await q.listTasks(alice, "2026-10-01", "2026-10-31");
    expect(tasks[0].done).toBe(true);
    expect(tasks[0].task_date).toBe("2026-10-05");
  });

  it("stores OCR drafts and merges confirmed hours", async () => {
    const [d] = await q.createOcrDraftRows([
      {
        batch_id: "11111111-1111-1111-1111-111111111111",
        document_id: null,
        profile_id: alice,
        full_name: "Alice",
        entry_date: "2026-10-07",
        start_time: "08:00",
        end_time: "12:00",
        break_minutes: 0,
        hours: 4,
        raw_line: "07/10 08:00 12:00",
        valid: true,
        issues: [],
      },
    ]);
    const fetched = await q.getOcrDraftById(d.id);
    expect(fetched?.entry_date).toBe("2026-10-07");
    expect(fetched?.start_time).toBe("08:00");
    await q.updateOcrDraft(d.id, { hours: 4.5 });
    expect((await q.listOcrDrafts("pending"))[0].hours).toBe(4.5);
    await q.addHoursToTimeEntry(alice, "2026-10-07", { start_time: "08:00", end_time: "12:30", break_minutes: 0, hours: 4.5 });
    await q.setOcrDraftStatus([d.id], "confirmed");
    expect((await q.getEntryByDate(alice, "2026-10-07"))?.hours).toBe(4.5);
  });

  it("rate-limits failed logins", async () => {
    for (let i = 0; i < 3; i++) await rl.recordFailedAttempt("login:test");
    expect(await rl.isRateLimited("login:test", 3, 60_000)).toBe(true);
    await rl.clearAttempts("login:test");
    expect(await rl.isRateLimited("login:test", 3, 60_000)).toBe(false);
  });

  it("treats malformed session and reset tokens as invalid instead of crashing", async () => {
    expect(await q.findValidPasswordReset("not-a-uuid")).toBeNull();
    const { sql } = await import("@/lib/pg");
    const rows = await sql()`SELECT 1 FROM sessions WHERE token = ${"garbage-cookie"}`;
    expect(rows).toHaveLength(0);
  });

  it("resets passwords with a single-use token", async () => {
    const token = await q.createPasswordReset(alice);
    expect(await q.findValidPasswordReset(token)).not.toBeNull();
    expect((await q.resetPasswordWithToken(token, "newpassword1")).error).toBeUndefined();
    expect(await q.findValidPasswordReset(token)).toBeNull();
  });

  it("deletes a profile and everything that references it", async () => {
    await q.deleteProfile(bob);
    expect(await q.findProfileById(bob)).toBeNull();
    expect(await q.listConversation(alice, bob)).toHaveLength(0);
  });

  afterAll(async () => {
    const { sql } = await import("@/lib/pg");
    await (sql() as unknown as { end: () => Promise<void> }).end?.();
  });
});
