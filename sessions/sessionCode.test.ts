import { describe, expect, it } from "vitest";
import { createSessionCode } from "./sessionCode";

describe("session code", () => {
  it("uses a sanitized non-secret prefix and random suffix", () => {
    expect(createSessionCode(" lab 7 ")).toMatch(/^LAB7-[A-F0-9]{10}$/);
    expect(createSessionCode("***")).toMatch(/^RVH-[A-F0-9]{10}$/);
  });
});
