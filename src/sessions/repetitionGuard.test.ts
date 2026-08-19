import { describe, expect, it } from "vitest";
import { analyzeRepetitiveOutput, detectRepetitiveOutput, sanitizeRepetitiveOutput } from "./repetitionGuard";

const sixTouches = `## Phase 1

${Array.from({ length: 6 }, (_, index) => `**TOUCH ${index + 1}**

**1. Echo Dot**
A distinct contact fragment ${index + 1} that remains still but has its own spatial quality.

**2. Contact Category**
Structure

**3. Primitive Descriptor**
Hard

**4. Advanced Descriptor**
Natural

**5. Forming**
Line ${index + 1}, static.`).join("\n\n---\n\n")}`;

describe("repetition guard", () => {
  it("does not mistake the mandatory six-Touch form for a generation loop", () => {
    expect(analyzeRepetitiveOutput(sixTouches)).toEqual({ severity: "clear" });
    expect(detectRepetitiveOutput(sixTouches)).toBe(false);
  });

  it("detects only an unmistakable run of at least sixty identical lines", () => {
    const loop = Array(60).fill("The same long perceptual sentence repeats without any new spatial or sensory information at all.").join("\n");
    expect(analyzeRepetitiveOutput(loop)).toEqual(expect.objectContaining({ severity: "stop", rule: "consecutive-identical-lines" }));
  });

  it("keeps the repeated Polish RV descriptor which previously caused a false stop", () => {
    const valid = Array.from({ length: 12 }, (_, index) => `DOTYK [${index + 1}]\n1. Echo Dot: odrębny punkt kontaktu.\n2. Kategoria kontaktu: struktura.\n3. Deskryptor prymitywny: twarde.\n4. Deskryptor zaawansowany: sztuczne - wykonane przez człowieka.\n5. Formowanie: element ${index + 1}.`).join("\n\n");
    expect(analyzeRepetitiveOutput(valid)).toEqual({ severity: "clear" });
    expect(sanitizeRepetitiveOutput(valid, "pl")).toEqual(expect.objectContaining({ truncated: false, content: valid }));
  });

  it("truncates a clear runaway but preserves the session instead of aborting it", () => {
    const valid = "Useful perceptual evidence before the provider loop.";
    const loop = `${valid}\n${Array(65).fill("identical runaway line").join("\n")}`;
    const result = sanitizeRepetitiveOutput(loop, "en");
    expect(result.truncated).toBe(true);
    expect(result.content).toContain(valid);
    expect(result.content).toContain("OUTPUT TRUNCATED");
    expect(result.content.length).toBeLessThan(loop.length);
  });

  it("ignores repeated ASCII strokes inside fenced code blocks", () => {
    const drawing = `\`\`\`text\n${Array(8).fill("+------------------------------+").join("\n")}\n\`\`\``;
    expect(analyzeRepetitiveOutput(drawing).severity).toBe("clear");
  });
});
