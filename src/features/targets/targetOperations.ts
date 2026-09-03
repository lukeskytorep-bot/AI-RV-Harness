import { storeTargetArtifact } from "../../artifacts/native";
import { createId, type AppRepository } from "../../storage/repository";
import { createUserTarget, updateUserTarget } from "../../targets/service";
import type { TargetRecord, TargetUsageRecord } from "../../targets/types";

export interface TargetLibraryState {
  targets: TargetRecord[];
  usage: TargetUsageRecord[];
  researchLockedTargetIds: string[];
}

export interface CreateFeatureTargetInput {
  title: string;
  revealText: string;
  tags: string[];
  images: File[];
  targetKind: "general" | "telepathic";
}

interface CreateFeatureTargetDependencies {
  createTargetId: () => string;
  storeArtifact: typeof storeTargetArtifact;
}

const defaultCreateDependencies: CreateFeatureTargetDependencies = {
  createTargetId: () => createId("target"),
  storeArtifact: storeTargetArtifact,
};

export async function loadTargetLibrary(repository: AppRepository): Promise<TargetLibraryState> {
  const [targets, usage, projects] = await Promise.all([
    repository.listTargets(),
    repository.listTargetUsage(),
    repository.listResearchProjects(),
  ]);
  const assignments = (
    await Promise.all(projects.map((project) => repository.listResearchAssignments(project.id)))
  ).flat();

  return {
    targets,
    usage,
    researchLockedTargetIds: [...new Set(assignments.map((assignment) => assignment.targetId))],
  };
}

export async function createFeatureTarget(
  repository: AppRepository,
  input: CreateFeatureTargetInput,
  dependencies: CreateFeatureTargetDependencies = defaultCreateDependencies,
): Promise<TargetRecord> {
  const targetId = dependencies.createTargetId();
  const revealArtifacts = input.images.length
    ? await Promise.all(input.images.map((file) => dependencies.storeArtifact(targetId, file)))
    : [];

  return createUserTarget(repository, {
    id: targetId,
    title: input.title,
    ...(input.revealText.trim() ? { revealText: input.revealText } : {}),
    ...(revealArtifacts.length ? { revealArtifacts } : {}),
    tags: input.tags,
    targetKind: input.targetKind,
  });
}

export async function updateFeatureTarget(
  repository: AppRepository,
  target: TargetRecord,
  values: { title: string; revealText: string; tags: string[] },
): Promise<void> {
  await updateUserTarget(repository, target, values);
}

export async function deleteFeatureTarget(repository: AppRepository, targetId: string): Promise<void> {
  await repository.deleteTarget(targetId);
}
