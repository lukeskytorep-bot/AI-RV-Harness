import type { InterfaceLanguage } from "../types";

export const MONITOR_LIBRARY_VERSION = "1.0.0";

export type MonitorPrerequisite = "none" | "structure" | "subject" | "subjects" | "activity" | "event" | "location" | "reported_aspect";

export interface MonitorCommand {
  id: string;
  prerequisite: MonitorPrerequisite;
  text: Record<InterfaceLanguage, string>;
  argument?: "reported_fragment";
}

export const MONITOR_COMMANDS: MonitorCommand[] = [
  { id: "CENTER", prerequisite: "none", text: { en: "Move to the center of the target and describe.", pl: "Przejdź do centrum celu i opisz." } },
  { id: "MOST_IMPORTANT_ASPECT", prerequisite: "none", text: { en: "Move to the most important aspect of the target and describe.", pl: "Przejdź do najważniejszego aspektu celu i opisz." } },
  { id: "NEXT_IMPORTANT_ASPECT", prerequisite: "reported_aspect", text: { en: "Move to the next important aspect of the target and describe.", pl: "Przejdź do następnego ważnego aspektu celu i opisz." } },
  { id: "WALK_AROUND", prerequisite: "none", text: { en: "Walk around the target and describe only new data.", pl: "Obejdź cel dookoła i opisz wyłącznie nowe dane." } },
  { id: "MOVEMENT_ACTIVITY", prerequisite: "none", text: { en: "Probe for and describe movement and activity.", pl: "Sprawdź i opisz ruch oraz aktywność." } },
  { id: "SKETCH", prerequisite: "reported_aspect", text: { en: "Draw a functional sketch of the reported target elements.", pl: "Wykonaj funkcjonalny szkic zgłoszonych elementów celu." } },
  { id: "TERRAIN_MAP", prerequisite: "location", text: { en: "Make a functional terrain or spatial map of the reported area.", pl: "Wykonaj funkcjonalną mapę terenu lub układu przestrzennego zgłoszonego obszaru." } },
  { id: "MAIN_ACTIVITY", prerequisite: "activity", text: { en: "Move to the main reported activity and describe.", pl: "Przejdź do głównej zgłoszonej aktywności i opisz." } },
  { id: "NEXT_ACTIVITY", prerequisite: "activity", text: { en: "Move to the next reported activity and describe.", pl: "Przejdź do następnej zgłoszonej aktywności i opisz." } },
  { id: "PRIMARY_EVENT", prerequisite: "event", text: { en: "Move to the most important reported target event and describe.", pl: "Przejdź do najważniejszego zgłoszonego zdarzenia celu i opisz." } },
  { id: "NEXT_EVENT", prerequisite: "event", text: { en: "Move to the next important reported target event and describe.", pl: "Przejdź do następnego ważnego zgłoszonego zdarzenia celu i opisz." } },
  { id: "EVENT_CAUSE", prerequisite: "event", text: { en: "Move to the original cause of the reported target event and describe.", pl: "Przejdź do pierwotnej przyczyny zgłoszonego zdarzenia celu i opisz." } },
  { id: "EVENT_INITIAL_MOMENT", prerequisite: "event", text: { en: "Move to the initial moment of the reported target event and describe.", pl: "Przejdź do początkowego momentu zgłoszonego zdarzenia celu i opisz." } },
  { id: "PRIMARY_SUBJECT", prerequisite: "subject", text: { en: "Move to the primary reported target subject and describe.", pl: "Przejdź do głównego zgłoszonego subject i opisz." } },
  { id: "SUBJECT_CLOTHING", prerequisite: "subject", text: { en: "Describe the clothing of the reported subject or subjects using low-level descriptors.", pl: "Opisz ubiór zgłoszonego subject lub subjects, używając deskryptorów niskiego poziomu." } },
  { id: "DEEP_MIND_PROBE", prerequisite: "subject", text: { en: "Deep Mind Probe the reported subject and describe the perceived state without interpretation.", pl: "Wykonaj Deep Mind Probe zgłoszonego subject i opisz postrzegany stan bez interpretacji." } },
  { id: "COLLECTIVE_DEEP_MIND_PROBE", prerequisite: "subjects", text: { en: "Collective Deep Mind Probe the reported subjects and describe their collective state without interpretation.", pl: "Wykonaj Collective Deep Mind Probe zgłoszonych subjects i opisz ich zbiorowy stan bez interpretacji." } },
  { id: "STRUCTURE_INTERIOR", prerequisite: "structure", text: { en: "Move to the interior of the reported structure and describe.", pl: "Przejdź do wnętrza zgłoszonej struktury i opisz." } },
  { id: "STRUCTURE_SHAPE", prerequisite: "structure", text: { en: "Describe the appearance, geometry, and shapes of the reported structure.", pl: "Opisz wygląd, geometrię i kształty zgłoszonej struktury." } },
  { id: "STRUCTURE_MATERIAL", prerequisite: "structure", text: { en: "Describe the material of the reported structure using low-level descriptors.", pl: "Opisz materiał zgłoszonej struktury za pomocą deskryptorów niskiego poziomu." } },
  { id: "ASPECT_MATERIALS", prerequisite: "reported_aspect", text: { en: "Describe the materials of each reported target aspect without naming the target.", pl: "Opisz materiały każdego zgłoszonego aspektu celu bez nazywania celu." } },
  { id: "ASPECT_COLORS", prerequisite: "reported_aspect", text: { en: "Describe the colors of each reported target aspect.", pl: "Opisz kolory każdego zgłoszonego aspektu celu." } },
  { id: "ASPECT_SIZE", prerequisite: "reported_aspect", text: { en: "Describe the relative size and scale of each reported target aspect.", pl: "Opisz względną wielkość i skalę każdego zgłoszonego aspektu celu." } },
  { id: "RAW_DESCRIPTORS", prerequisite: "reported_aspect", text: { en: "Return to the reported perception and describe only low-level sensory, spatial, material, and movement data; set interpretation aside.", pl: "Wróć do zgłoszonej percepcji i opisz wyłącznie dane sensoryczne, przestrzenne, materiałowe i dotyczące ruchu; odłóż interpretację." } },
  { id: "NEW_REPORTED_LOCATION", prerequisite: "location", argument: "reported_fragment", text: { en: "Move to {argument} and describe.", pl: "Przejdź do {argument} i opisz." } },
  { id: "TIME_OF_REPORTED_EVENT", prerequisite: "event", argument: "reported_fragment", text: { en: "Move to the time of {argument} and describe.", pl: "Przejdź do czasu {argument} i opisz." } },
];

const PREREQUISITE_TERMS: Record<Exclude<MonitorPrerequisite, "none" | "reported_aspect">, RegExp> = {
  structure: /\b(structure|building|wall|room|interior|architecture|angular|struktura|budynek|ścian|wnętrz|pomieszczen|konstrukcj)\b/i,
  subject: /\b(subject|person|people|figure|individual|human|osob|postać|subject[s]?)\b/i,
  subjects: /\b(subjects|people|crowd|group|persons|ludzie|tłum|grup|osoby)\b/i,
  activity: /\b(activity|movement|moving|motion|action|process|aktywno|ruch|porusza|działanie|proces)\b/i,
  event: /\b(event|happening|occur|moment|before|after|timeline|zdarzen|wydarzen|moment|przed|po |czas)\b/i,
  location: /\b(location|area|place|terrain|ground|land|water|inside|outside|above|below|miejsce|obszar|teren|ziemi|wod|wewnątrz|zewnątrz|nad|pod)\b/i,
};

export function getMonitorCommand(id: string): MonitorCommand | undefined {
  return MONITOR_COMMANDS.find((command) => command.id === id);
}

export function evidenceSatisfies(command: MonitorCommand, evidence: string): boolean {
  if (command.prerequisite === "none") return true;
  if (!evidence.trim()) return false;
  if (command.prerequisite === "reported_aspect") return evidence.trim().length >= 3;
  return PREREQUISITE_TERMS[command.prerequisite].test(evidence);
}

export function renderMonitorCommand(command: MonitorCommand, language: InterfaceLanguage, argument?: string): string {
  if (command.argument && !argument?.trim()) throw new Error(`${command.id} requires a reported argument.`);
  return command.text[language].replace("{argument}", argument?.trim() ?? "");
}
