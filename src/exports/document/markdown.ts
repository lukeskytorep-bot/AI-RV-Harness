import type { ExportMetadataField, MarkdownExportDocumentInput, StandardExportMetadata } from "./types";
import { formatExportDateTime } from "./time";

const labels = {
  pl: {
    workspace: "Przestrzeń robocza",
    profile: "Profil",
    mode: "Tryb",
    protocol: "Protokół",
    viewerModel: "Model Viewera",
    monitorModel: "Model Monitora",
    judgeModels: "Modele Judge",
    state: "Stan",
    createdAt: "Utworzono",
    completedAt: "Zakończono",
    exportedAt: "Wyeksportowano",
  },
  en: {
    workspace: "Workspace",
    profile: "Profile",
    mode: "Mode",
    protocol: "Protocol",
    viewerModel: "Viewer model",
    monitorModel: "Monitor model",
    judgeModels: "Judge models",
    state: "Status",
    createdAt: "Created",
    completedAt: "Completed",
    exportedAt: "Exported",
  },
} as const;

export function standardMetadataFields(
  language: MarkdownExportDocumentInput["language"],
  metadata: StandardExportMetadata,
  additionalMetadata: ExportMetadataField[] = [],
): ExportMetadataField[] {
  const copy = labels[language];
  return compactFields([
    field(copy.workspace, metadata.workspace),
    field(copy.profile, metadata.profile),
    field(copy.mode, metadata.mode),
    field(copy.protocol, metadata.protocol),
    field(copy.viewerModel, metadata.viewerModel),
    field(copy.monitorModel, metadata.monitorModel),
    field(copy.judgeModels, uniqueNonEmpty(metadata.judgeModels).join(" · ")),
    field(copy.state, metadata.state),
    ...additionalMetadata,
    field(copy.createdAt, metadata.createdAt ? formatExportDateTime(metadata.createdAt, language) : undefined),
    field(copy.completedAt, metadata.completedAt ? formatExportDateTime(metadata.completedAt, language) : undefined),
    field(copy.exportedAt, formatExportDateTime(metadata.exportedAt, language)),
  ]);
}

export function renderMarkdownExportDocument(input: MarkdownExportDocumentInput): string {
  const metadata = standardMetadataFields(input.language, input.metadata, input.additionalMetadata);
  const lines = [
    `# ${input.title.trim()}`,
    "",
    ...metadata.map(({ label, value }) => `- ${label}: ${value}`),
    "",
    "---",
  ];
  const body = input.body?.trim();
  if (body) lines.push("", body);
  return `${lines.join("\n").trimEnd()}\n`;
}

function field(label: string, value: string | number | undefined): ExportMetadataField | null {
  if (value === undefined || (typeof value === "string" && !value.trim())) return null;
  return { label, value };
}

function compactFields(fields: Array<ExportMetadataField | null>): ExportMetadataField[] {
  return fields.filter((item): item is ExportMetadataField => item !== null);
}

function uniqueNonEmpty(values: string[] | undefined): string[] {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))];
}
