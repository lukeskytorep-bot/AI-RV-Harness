import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { fieldPerceptionLexicon } from "./fieldLexicon";

function sha256(value: string): string {
  return createHash("sha256").update(Buffer.from(value, "utf8")).digest("hex");
}

describe("Field Perception Lexicon canonical resources", () => {
  it.each([
    ["pl", "ai-field-perception-lexicon.pl", "60608e0eb91a434292a4c3cb65fea779af962d4d0be36d33717d9bfd4d1b51c5"],
    ["en", "ai-field-perception-lexicon.en", "dc4595a66270f89a9e77a6cb39f2833195fff3d3edb74d7c2cf8a774a80a67f5"],
  ] as const)("keeps the canonical %s UTF-8 text byte-equivalent and hash-verified", (language, id, expectedHash) => {
    const lexicon = fieldPerceptionLexicon(language);
    expect(lexicon).toMatchObject({ id, version: "1.0.0", language, role: "reference-only-perceptual-naming-aid", sha256: expectedHash });
    expect(sha256(lexicon.content)).toBe(expectedHash);
    const bytes = fs.readFileSync(path.join(process.cwd(), `src/resources/field-lexicon/AI_Field_Perception_Lexicon.${language}.txt`));
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(expectedHash);
    expect(bytes.toString("utf8")).toBe(lexicon.content);
  });

  it("never crosses Polish and English Training language assignment", () => {
    expect(fieldPerceptionLexicon("pl").language).toBe("pl");
    expect(fieldPerceptionLexicon("en").language).toBe("en");
    expect(fieldPerceptionLexicon("pl").id).not.toBe(fieldPerceptionLexicon("en").id);
  });
});
