import type { RevealArtifactRecord } from "../sessions/types";

export type TargetCollection = "training" | "user";

export interface TargetRecord {
  id: string;
  collection: TargetCollection;
  title: string;
  revealText?: string;
  revealArtifactPath?: string;
  revealArtifacts?: RevealArtifactRecord[];
  tags: string[];
  sourceMetadata: Record<string, unknown>;
  contentHash?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTargetInput {
  id: string;
  collection: TargetCollection;
  title: string;
  revealText?: string;
  revealArtifactPath?: string;
  revealArtifacts?: RevealArtifactRecord[];
  tags?: string[];
  sourceMetadata?: Record<string, unknown>;
  contentHash?: string;
}

export interface UpdateTargetInput {
  title: string;
  revealText?: string;
  tags: string[];
  contentHash: string;
}

export interface TargetUsageInput {
  targetId: string;
  profileId?: string;
  researchProjectId?: string;
  sessionId?: string;
}

export interface TargetUsageRecord extends TargetUsageInput {
  id: string;
  usedAt: string;
}
