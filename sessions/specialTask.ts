import type { InterfaceLanguage } from "../types";

export const SPECIAL_TASK_OPTIONS = [
  "main_subject",
  "subject_a",
  "subject_b",
  "subject_c",
  "main_activity",
  "main_event",
  "structure_a",
  "object_a",
  "object_b",
] as const;

export type SpecialTaskOption = typeof SPECIAL_TASK_OPTIONS[number];

export interface SpecialTaskInput {
  selectedOptions: SpecialTaskOption[];
  customText?: string;
}

const optionText: Record<SpecialTaskOption, Record<InterfaceLanguage, string>> = {
  main_subject: { pl: "Przejdź do głównej osoby lub istoty i opisz.", en: "Move to the primary subject and describe." },
  subject_a: { pl: "Przejdź do Subject A i opisz.", en: "Move to Subject A and describe." },
  subject_b: { pl: "Przejdź do Subject B i opisz.", en: "Move to Subject B and describe." },
  subject_c: { pl: "Przejdź do Subject C i opisz.", en: "Move to Subject C and describe." },
  main_activity: { pl: "Przejdź do głównej aktywności dowolnego rodzaju i opisz.", en: "Move to the primary activity of any kind and describe." },
  main_event: { pl: "Przejdź do głównego zdarzenia i opisz.", en: "Move to the primary event and describe." },
  structure_a: { pl: "Przejdź do Structure A i opisz.", en: "Move to Structure A and describe." },
  object_a: { pl: "Przejdź do Object A i opisz.", en: "Move to Object A and describe." },
  object_b: { pl: "Przejdź do Object B i opisz.", en: "Move to Object B and describe." },
};

export function renderSpecialTask(task: SpecialTaskInput | undefined, language: InterfaceLanguage): string | undefined {
  if (!task) return undefined;
  const lines = task.selectedOptions.map((option) => `- ${optionText[option][language]}`);
  if (task.customText?.trim()) lines.push(`- ${task.customText.trim()}`);
  return lines.length ? lines.join("\n") : undefined;
}

export function specialTaskUsesMappedLabels(task: SpecialTaskInput | undefined): boolean {
  if (!task) return false;
  return task.selectedOptions.some((option) => /^(subject_[abc]|structure_a|object_[ab])$/.test(option))
    || /\b(?:Subject\s+[ABC]|Structure\s+A|Object\s+[AB])\b/i.test(task.customText ?? "");
}
