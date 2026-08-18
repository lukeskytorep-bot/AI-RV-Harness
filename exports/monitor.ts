import type { MonitorInterventionRecord, MonitorRunRecord } from "../monitor/types";
import type { AppRepository } from "../storage/repository";
import { writeExportPackage } from "./native";

export async function exportMonitorRun(
  repository: AppRepository,
  workspaceId: string,
  run: MonitorRunRecord,
  interventions: MonitorInterventionRecord[],
): Promise<string> {
  const session = (await repository.listRvSessions(workspaceId)).find((item) => item.id === run.sessionId);
  if (!session) throw new Error("Associated RV session was not found.");
  const exportId = `RV_Harness_Monitor_${run.id.replace(/[^A-Za-z0-9_-]/g, "_")}_${Date.now()}`;
  const technical = {
    schemaVersion: 1,
    run: {
      id: run.id,
      sessionId: run.sessionId,
      sessionCode: run.sessionCode,
      modelRoute: run.modelRoute,
      promptVersionId: run.promptVersionId,
      libraryVersion: run.libraryVersion,
      maxInterventions: run.maxInterventions,
      createdAt: run.createdAt,
    },
    session: { id: session.id, sessionCode: session.sessionCode, state: session.state },
    interventions,
    safety: { targetRevealIncluded: false, apiKeysIncluded: false },
  };
  const content = `${JSON.stringify(technical, null, 2)}\n`;
  const hash = await sha256Text(content);
  const directory = await writeExportPackage({
    exportId,
    files: [
      { relativePath: "monitor_run.json", content },
      { relativePath: "viewer_pre_reveal.md", content: session.preRevealTranscript },
      { relativePath: "manifest.json", content: `${JSON.stringify({ schemaVersion: 1, monitorRunId: run.id, monitorRunSha256: hash, targetRevealIncluded: false }, null, 2)}\n` },
    ],
  });
  await repository.recordExport(workspaceId, undefined, "monitor_run", directory, hash);
  return directory;
}

async function sha256Text(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}
