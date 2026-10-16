import { expect, it } from "vitest";
import { trainingLearningSettlements } from "./learningSummary";
import { learningWarningText, type LearningSettlement } from "../aiCenter/learningExecution";
const settlement: LearningSettlement = { kind: "viewer_notes", sessionId: "s", packetHash: "p", auditId: "a", settlement: "failed_preserved", version: null, attempts: 2, status: "FAILED_PARSE", failureMessage: "Invalid JSON" };
it("T5 merges checkpoint/run/event settlements once while retaining distinct memory stages", () => {
 const other = { ...settlement, kind: "field_guide" as const, auditId: "fg" };
 const result = trainingLearningSettlements({ learningSettlements: [settlement], activeTargetCheckpoint: { sessionId: "s", targetId: "t", stage: "review_completed", learningSettlements: [settlement, other] } }, [settlement]);
 expect(result).toEqual([settlement, other]);
});
for (const pl of [false, true]) it(`T5 ${pl}: absent notes are not described as an existing retained version`, () => {
 expect(learningWarningText(settlement, pl)).toContain(pl ? "nadal brak zapisanej wersji" : "no saved version exists");
 expect(learningWarningText({ ...settlement, version: { id: "v1", contentSha256: "hash" } }, pl)).toContain(pl ? "zachowano poprzednią wersję" : "previous version retained");
 expect(learningWarningText(settlement, pl)).toContain("Invalid JSON");
});
