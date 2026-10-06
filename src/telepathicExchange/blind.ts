import { sha256Text } from "../application/sha256";
import type { TelepathicBlindSubmission } from "./types";

export const MAX_TECHNICAL_SUBMISSION_ATTEMPTS = 2;

export function createBlindSubmission(participantId: string): TelepathicBlindSubmission {
  return { participantId, status: "waiting", providerAttemptCount: 0 };
}

export function recordTechnicalAttempt(submission: TelepathicBlindSubmission): TelepathicBlindSubmission {
  if (submission.status === "sealed" || submission.status === "no_submission") return submission;
  const providerAttemptCount = Math.min(MAX_TECHNICAL_SUBMISSION_ATTEMPTS, submission.providerAttemptCount + 1);
  if (providerAttemptCount >= MAX_TECHNICAL_SUBMISSION_ATTEMPTS && !submission.first) {
    return { ...submission, providerAttemptCount, status: "no_submission" };
  }
  return { ...submission, providerAttemptCount };
}

export function recordFirstBlindResponse(submission: TelepathicBlindSubmission, text: string): TelepathicBlindSubmission {
  if (!text.trim()) throw new Error("First blind response cannot be empty.");
  if (submission.status === "sealed" || submission.status === "no_submission") {
    throw new Error("Blind response is already closed.");
  }
  return { ...submission, first: text, status: "first_complete" };
}

export function recordSecondBlindResponse(submission: TelepathicBlindSubmission, text: string): TelepathicBlindSubmission {
  if (!submission.first) throw new Error("Second look cannot be recorded before the first blind response.");
  if (submission.status === "sealed" || submission.status === "no_submission") {
    throw new Error("Blind response is already closed.");
  }
  return { ...submission, second: text, status: "second_complete" };
}

export async function sealBlindSubmission(
  submission: TelepathicBlindSubmission,
  now = new Date().toISOString(),
): Promise<TelepathicBlindSubmission> {
  if (submission.status === "no_submission") return { ...submission, sealedAt: now };
  if (!submission.first) throw new Error("Cannot seal a blind submission before the first response exists.");
  const contentSha256 = await sha256Text(JSON.stringify({ first: submission.first, second: submission.second ?? "" }));
  return { ...submission, status: "sealed", sealedAt: now, contentSha256 };
}
