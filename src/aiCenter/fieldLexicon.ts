import enText from "../resources/field-lexicon/AI_Field_Perception_Lexicon.en.txt?raw";
import plText from "../resources/field-lexicon/AI_Field_Perception_Lexicon.pl.txt?raw";
import type { FieldGuideLanguage } from "./fieldGuideTypes";

export interface FieldPerceptionLexiconResource {
  id: string;
  version: string;
  language: FieldGuideLanguage;
  sha256: string;
  content: string;
  role: "reference-only-perceptual-naming-aid";
}

const RESOURCES: Record<FieldGuideLanguage, FieldPerceptionLexiconResource> = {
  en: {
    id: "ai-field-perception-lexicon.en",
    version: "1.0.0",
    language: "en",
    sha256: "dc4595a66270f89a9e77a6cb39f2833195fff3d3edb74d7c2cf8a774a80a67f5",
    content: enText,
    role: "reference-only-perceptual-naming-aid",
  },
  pl: {
    id: "ai-field-perception-lexicon.pl",
    version: "1.0.0",
    language: "pl",
    sha256: "60608e0eb91a434292a4c3cb65fea779af962d4d0be36d33717d9bfd4d1b51c5",
    content: plText,
    role: "reference-only-perceptual-naming-aid",
  },
};

export function fieldPerceptionLexicon(language: FieldGuideLanguage): FieldPerceptionLexiconResource {
  return RESOURCES[language];
}
