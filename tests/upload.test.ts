import { describe, it, expect } from "vitest";
import { uploadTooLarge, MAX_UPLOAD_BYTES, MAX_UPLOAD_ERROR } from "@/lib/constants";

describe("uploadTooLarge", () => {
  const form = (size: number) => {
    const fd = new FormData();
    fd.set("note", "x");
    fd.set("file", new File([new Uint8Array(size)], "scan.jpg", { type: "image/jpeg" }));
    return fd;
  };
  it("accepts files up to 4 MB (under Vercel's 4.5 MB request limit)", () => {
    expect(uploadTooLarge(form(MAX_UPLOAD_BYTES))).toBeNull();
    expect(MAX_UPLOAD_BYTES).toBeLessThan(4.5 * 1024 * 1024);
  });
  it("rejects larger files before they are sent", () => {
    expect(uploadTooLarge(form(MAX_UPLOAD_BYTES + 1))).toBe(MAX_UPLOAD_ERROR);
  });
});
