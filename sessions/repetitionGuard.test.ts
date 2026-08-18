import { describe, expect, it } from "vitest";
import { RepetitionGuard, analyzeRepetitiveOutput, detectRepetitiveOutput } from "./repetitionGuard";

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

  it("immediately stops an unmistakable long repeated line", () => {
    const loop = Array(6).fill("The same long perceptual sentence repeats without any new spatial or sensory information at all.").join("\n");
    expect(analyzeRepetitiveOutput(loop)).toEqual(expect.objectContaining({ severity: "stop", rule: "long-line-repeat" }));
  });

  it("warns once for a borderline pattern and stops if the next response repeats a borderline pattern", () => {
    const guard = new RepetitionGuard();
    const borderline = Array(3).fill("This moderately long perception repeats with enough words to deserve a diagnostic warning.").join("\n");
    expect(guard.inspect(borderline).severity).toBe("warning");
    expect(guard.inspect(borderline)).toEqual(expect.objectContaining({ severity: "stop", rule: "consecutive-long-line-repeat" }));
  });

  it("ignores repeated ASCII strokes inside fenced code blocks", () => {
    const drawing = `\`\`\`text\n${Array(8).fill("+------------------------------+").join("\n")}\n\`\`\``;
    expect(analyzeRepetitiveOutput(drawing).severity).toBe("clear");
  });
});
