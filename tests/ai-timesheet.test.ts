import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  readTimesheetWithClaude,
  parseAiTimesheetJson,
  toParsedLines,
  buildPrompt,
  isAiReadingEnabled,
  AI_TIMESHEET_SCHEMA,
} from "@/lib/ai-timesheet";
import { matchEmployeeByName } from "@/lib/name-match";

const SAMPLE = {
  employee_name: "",
  notes: "Le 14/10 est marqué « congé ».",
  rows: [
    { date: "2026-10-12", start_time: "8h30", end_time: "17:15", break_minutes: 45, total_hours: 0, employee_name: "Amira B.", raw_text: "Lun 12/10  8h30 - 12h00 / 12h45 - 17h15  Amira B.", confidence: "high" },
    { date: "2026-10-13", start_time: "", end_time: "", break_minutes: 0, total_hours: 7.5, employee_name: "TRABELSI Youssef", raw_text: "13/10 ... 7h30", confidence: "low" },
    { date: "2026-02-30", start_time: "25:00", end_time: "12:00", break_minutes: 0, total_hours: 0, employee_name: "", raw_text: "30/02 ??", confidence: "medium" },
  ],
};

type Call = { url: string; init: RequestInit; body: Record<string, unknown> };

function fakeFetch(responses: Array<{ status: number; json?: unknown; text?: string }>) {
  const calls: Call[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init, body: JSON.parse(String(init.body)) });
    const r = responses[Math.min(calls.length - 1, responses.length - 1)];
    return new Response(r.json !== undefined ? JSON.stringify(r.json) : r.text ?? "", { status: r.status });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const ok = (payload: unknown, extra: Record<string, unknown> = {}) => ({
  status: 200,
  json: {
    stop_reason: "end_turn",
    content: [{ type: "thinking", thinking: "" }, { type: "text", text: JSON.stringify(payload) }],
    ...extra,
  },
});

describe("AI timesheet reading", () => {
  const env = { ...process.env };
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    delete process.env.ANTHROPIC_BASE_URL;
    delete process.env.ANTHROPIC_MODEL;
  });
  afterEach(() => {
    process.env = { ...env };
  });

  it("is only enabled when an API key is configured", () => {
    expect(isAiReadingEnabled()).toBe(true);
    delete process.env.ANTHROPIC_API_KEY;
    expect(isAiReadingEnabled()).toBe(false);
  });

  it("sends the image with a JSON schema and reads the text block (after thinking)", async () => {
    const { fn, calls } = fakeFetch([ok(SAMPLE)]);
    const result = await readTimesheetWithClaude(Buffer.from("img"), "image/jpeg", { today: "2026-10-28", employeeNames: ["Amira Ben Salah"] }, fn);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.anthropic.com/v1/messages");
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("test-key");
    expect(headers["anthropic-version"]).toBeTruthy();
    const body = calls[0].body as { model: string; output_config: { effort: string; format: { type: string; schema: unknown } }; messages: { content: { type: string; source?: { media_type: string; data: string } }[] }[] };
    expect(body.model).toBe("claude-sonnet-5-5");
    expect(body.output_config.effort).toBe("low");
    expect(body.output_config.format).toEqual({ type: "json_schema", schema: AI_TIMESHEET_SCHEMA });
    const image = body.messages[0].content[0];
    expect(image.type).toBe("image");
    expect(image.source).toEqual({ type: "base64", media_type: "image/jpeg", data: Buffer.from("img").toString("base64") });
    expect(JSON.stringify(body)).not.toContain("tool_choice"); // forced tool use is rejected by Sonnet 5.5

    expect(result.rows).toHaveLength(3);
    expect(result.notes).toContain("congé");
  });

  it("retries without structured outputs when the API rejects output_config.format", async () => {
    const { fn, calls } = fakeFetch([
      { status: 400, text: '{"type":"error","error":{"type":"invalid_request_error","message":"output_config.format: not supported"}}' },
      ok(SAMPLE),
    ]);
    const result = await readTimesheetWithClaude(Buffer.from("img"), "image/png", { today: "2026-10-28", employeeNames: [] }, fn);
    expect(calls).toHaveLength(2);
    expect((calls[1].body.output_config as Record<string, unknown>).format).toBeUndefined();
    expect(JSON.stringify(calls[1].body.messages)).toContain("JSON only");
    expect(result.rows[0].date).toBe("2026-10-12");
  });

  it("surfaces API errors so the caller can fall back to classic OCR", async () => {
    const { fn } = fakeFetch([{ status: 401, text: "invalid x-api-key" }]);
    await expect(readTimesheetWithClaude(Buffer.from("x"), "image/jpeg", { today: "2026-10-28", employeeNames: [] }, fn)).rejects.toThrow("401");
    const refusal = fakeFetch([ok(SAMPLE, { stop_reason: "refusal" })]);
    await expect(readTimesheetWithClaude(Buffer.from("x"), "image/jpeg", { today: "2026-10-28", employeeNames: [] }, refusal.fn)).rejects.toThrow("refusé");
    delete process.env.ANTHROPIC_API_KEY;
    await expect(readTimesheetWithClaude(Buffer.from("x"), "image/jpeg", { today: "2026-10-28", employeeNames: [] }, fn)).rejects.toThrow("ANTHROPIC_API_KEY");
  });

  it("uses a configurable base URL and model", async () => {
    process.env.ANTHROPIC_BASE_URL = "http://localhost:9999/";
    process.env.ANTHROPIC_MODEL = "claude-haiku-5-5";
    const { fn, calls } = fakeFetch([ok(SAMPLE)]);
    await readTimesheetWithClaude(Buffer.from("x"), "image/webp", { today: "2026-10-28", employeeNames: [] }, fn);
    expect(calls[0].url).toBe("http://localhost:9999/v1/messages");
    expect(calls[0].body.model).toBe("claude-haiku-5-5");
  });
});

describe("parsing and mapping", () => {
  it("tolerates text or code fences around the JSON and fills safe defaults", () => {
    const parsed = parseAiTimesheetJson("Voici :\n```json\n" + JSON.stringify({ rows: [{ date: "2026-10-12", confidence: "weird" }] }) + "\n```");
    expect(parsed.rows[0]).toMatchObject({ date: "2026-10-12", start_time: "", break_minutes: 0, confidence: "low" });
    expect(() => parseAiTimesheetJson("pas de json")).toThrow();
  });

  it("recomputes hours from the times, keeps written totals otherwise, and rejects impossible values", () => {
    const [a, b, c] = toParsedLines(parseAiTimesheetJson(JSON.stringify(SAMPLE)));
    expect(a).toMatchObject({ entry_date: "2026-10-12", start_time: "08:30", end_time: "17:15", break_minutes: 45, hours: 8, employee_name: "Amira B.", confidence: "high" });
    expect(b).toMatchObject({ entry_date: "2026-10-13", start_time: null, hours: 7.5, confidence: "low" });
    expect(c).toMatchObject({ entry_date: null, start_time: null, end_time: "12:00" }); // 30 Feb and 25:00 rejected
  });

  it("uses the sheet's name for rows without one", () => {
    const lines = toParsedLines(parseAiTimesheetJson(JSON.stringify({ employee_name: "Karim Jaziri", rows: [{ date: "2026-10-12", start_time: "08:00", end_time: "16:00" }] })));
    expect(lines[0].employee_name).toBe("Karim Jaziri");
  });

  it("puts today's date and the employee list in the prompt", () => {
    const p = buildPrompt("2026-10-28", ["Amira Ben Salah", "Karim Jaziri"]);
    expect(p).toContain("Today is 2026-10-28");
    expect(p).toContain("Amira Ben Salah, Karim Jaziri");
  });
});

describe("matchEmployeeByName", () => {
  const team = [
    { id: "1", full_name: "Amira Ben Salah" },
    { id: "2", full_name: "Youssef Trabelsi" },
    { id: "3", full_name: "Amira Gharbi" },
  ];
  it("matches handwritten variants", () => {
    expect(matchEmployeeByName(team, "TRABELSI Youssef")?.id).toBe("2");
    expect(matchEmployeeByName(team, "youssef")?.id).toBe("2");
    expect(matchEmployeeByName(team, "Amira B.")?.id).toBe("1");
    expect(matchEmployeeByName(team, "amira ben-salah")?.id).toBe("1");
    expect(matchEmployeeByName(team, "Amira Gharbi")?.id).toBe("3");
  });
  it("refuses ambiguous or unknown names rather than guessing", () => {
    expect(matchEmployeeByName(team, "Amira")).toBeNull();
    expect(matchEmployeeByName(team, "Salma")).toBeNull();
    expect(matchEmployeeByName(team, "")).toBeNull();
  });
});

describe("Gemini (free tier) provider", () => {
  const env = { ...process.env };
  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    process.env.GEMINI_API_KEY = "gem-key";
    delete process.env.GEMINI_BASE_URL;
    delete process.env.GEMINI_MODEL;
  });
  afterEach(() => {
    process.env = { ...env };
  });

  const geminiOk = (payload: unknown, extra: Record<string, unknown> = {}) => ({
    status: 200,
    json: {
      candidates: [
        {
          content: { role: "model", parts: [{ text: "thinking about the sheet…", thought: true }, { text: JSON.stringify(payload) }] },
          finishReason: "STOP",
          ...extra,
        },
      ],
    },
  });

  it("picks the configured provider, Claude first", async () => {
    const { aiProvider } = await import("@/lib/ai-timesheet");
    expect(aiProvider()).toBe("gemini");
    process.env.ANTHROPIC_API_KEY = "x";
    expect(aiProvider()).toBe("claude");
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GEMINI_API_KEY;
    expect(aiProvider()).toBeNull();
  });

  it("sends the image inline with a JSON schema and ignores thought parts", async () => {
    const { readTimesheetWithAi } = await import("@/lib/ai-timesheet");
    const { fn, calls } = fakeFetch([geminiOk(SAMPLE)]);
    const { provider, sheet } = await readTimesheetWithAi(Buffer.from("img"), "image/jpeg", { today: "2026-10-28", employeeNames: ["Amira Ben Salah"] }, fn);

    expect(provider).toBe("gemini");
    expect(calls[0].url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent");
    expect((calls[0].init.headers as Record<string, string>)["x-goog-api-key"]).toBe("gem-key");
    const body = calls[0].body as {
      systemInstruction: { parts: { text: string }[] };
      contents: { parts: { inline_data?: { mime_type: string; data: string }; text?: string }[] }[];
      generationConfig: { responseMimeType: string; responseJsonSchema: unknown; temperature: number };
    };
    expect(body.contents[0].parts[0].inline_data).toEqual({ mime_type: "image/jpeg", data: Buffer.from("img").toString("base64") });
    expect(body.contents[0].parts[1].text).toContain("Today is 2026-10-28");
    expect(body.systemInstruction.parts[0].text).toContain("timesheets");
    expect(body.generationConfig.responseMimeType).toBe("application/json");
    expect(body.generationConfig.responseJsonSchema).toEqual(AI_TIMESHEET_SCHEMA);
    expect(body.generationConfig.temperature).toBe(0);
    expect(sheet.rows).toHaveLength(3);
    expect(toParsedLines(sheet)[0]).toMatchObject({ start_time: "08:30", hours: 8 });
  });

  it("retries without the schema when the API rejects it", async () => {
    const { readTimesheetWithGemini } = await import("@/lib/ai-timesheet");
    const { fn, calls } = fakeFetch([
      { status: 400, text: '{"error":{"code":400,"message":"Invalid JSON payload received. Unknown name \\"responseJsonSchema\\""}}' },
      geminiOk(SAMPLE),
    ]);
    const sheet = await readTimesheetWithGemini(Buffer.from("x"), "image/png", { today: "2026-10-28", employeeNames: [] }, fn);
    expect(calls).toHaveLength(2);
    const cfg = (calls[1].body as { generationConfig: Record<string, unknown> }).generationConfig;
    expect(cfg.responseJsonSchema).toBeUndefined();
    expect(cfg.responseMimeType).toBe("application/json");
    expect(JSON.stringify(calls[1].body)).toContain("JSON only");
    expect(sheet.rows[0].date).toBe("2026-10-12");
  });

  it("reports quota, refusals and truncation clearly", async () => {
    const { readTimesheetWithGemini } = await import("@/lib/ai-timesheet");
    const opts = { today: "2026-10-28", employeeNames: [] };
    await expect(readTimesheetWithGemini(Buffer.from("x"), "image/jpeg", opts, fakeFetch([{ status: 429, text: "RESOURCE_EXHAUSTED" }]).fn)).rejects.toThrow("429");
    await expect(readTimesheetWithGemini(Buffer.from("x"), "image/jpeg", opts, fakeFetch([{ status: 200, json: { promptFeedback: { blockReason: "SAFETY" } } }]).fn)).rejects.toThrow("refusé");
    await expect(readTimesheetWithGemini(Buffer.from("x"), "image/jpeg", opts, fakeFetch([geminiOk(SAMPLE, { finishReason: "MAX_TOKENS" })]).fn)).rejects.toThrow("trop longue");
    await expect(readTimesheetWithGemini(Buffer.from("x"), "image/jpeg", opts, fakeFetch([{ status: 200, json: { candidates: [{ finishReason: "OTHER" }] } }]).fn)).rejects.toThrow("vide");
  });

  it("uses a configurable model and base URL", async () => {
    process.env.GEMINI_MODEL = "gemini-3.5-flash-lite";
    process.env.GEMINI_BASE_URL = "http://localhost:9912/";
    const { readTimesheetWithGemini } = await import("@/lib/ai-timesheet");
    const { fn, calls } = fakeFetch([geminiOk(SAMPLE)]);
    await readTimesheetWithGemini(Buffer.from("x"), "image/webp", { today: "2026-10-28", employeeNames: [] }, fn);
    expect(calls[0].url).toBe("http://localhost:9912/v1beta/models/gemini-3.5-flash-lite:generateContent");
  });
});
