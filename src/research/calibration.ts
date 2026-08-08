import type { ProviderConfig } from "../providers/types";
import type { Profile } from "../types";
import type { ResearchProjectRecord, ResearchResults } from "./types";

export interface CalibrationHistoryItem {
  projectId: string;
  projectName: string;
  profileId: string;
  providerConfigId: string;
  providerLabel: string;
  credentialHint?: string;
  modelId: string;
  tested: string[];
  bestObserved: string[];
  n: number;
  completedAt: string;
  historical: boolean;
}

export function buildCalibrationHistory(
  projects: ResearchProjectRecord[],
  resultsByProject: ReadonlyMap<string, ResearchResults>,
  profile: Profile,
  providers: ProviderConfig[],
): CalibrationHistoryItem[] {
  return projects.flatMap((project) => {
    if (project.state !== "Complete" || project.templateType !== "reasoning") return [];
    const results = resultsByProject.get(project.id);
    if (!results) return [];
    const conditions = project.config.conditions.filter((condition) => condition.profileId === profile.id);
    if (!conditions.length) return [];
    const providerConfigIds = [...new Set(conditions.map((condition) => condition.providerConfigId))];
    const modelIds = [...new Set(conditions.map((condition) => condition.modelId))];
    if (providerConfigIds.length !== 1 || modelIds.length !== 1) return [];
    const provider = providers.find((item) => item.id === providerConfigIds[0]);
    const matchingStats = results.conditions.filter((stat) => conditions.some((condition) => condition.key === stat.conditionKey));
    if (!matchingStats.length) return [];
    const bestMean = Math.max(...matchingStats.map((stat) => stat.meanTotal));
    const bestKeys = new Set(matchingStats.filter((stat) => stat.meanTotal === bestMean).map((stat) => stat.conditionKey));
    const currentProvider = providers.find((item) => item.credentialId === profile.credentialId);
    return [{
      projectId: project.id,
      projectName: project.name,
      profileId: profile.id,
      providerConfigId: providerConfigIds[0],
      providerLabel: provider?.label ?? providerConfigIds[0],
      ...(provider?.credentialHint ? { credentialHint: provider.credentialHint } : {}),
      modelId: modelIds[0],
      tested: conditions.map((condition) => condition.label),
      bestObserved: conditions.filter((condition) => bestKeys.has(condition.key)).map((condition) => condition.label),
      n: matchingStats.reduce((sum, stat) => sum + stat.n, 0),
      completedAt: results.computedAt || project.updatedAt,
      historical: !currentProvider || currentProvider.id !== providerConfigIds[0],
    }];
  }).sort((a, b) => b.completedAt.localeCompare(a.completedAt));
}
