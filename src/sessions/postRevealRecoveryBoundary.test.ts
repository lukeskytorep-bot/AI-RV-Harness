import { describe, expect, it } from "vitest";
import fs from "node:fs";

const postReveal = fs.readFileSync(new URL("./postReveal.ts", import.meta.url), "utf8");
const recovery = fs.readFileSync(new URL("./postRevealRecovery.ts", import.meta.url), "utf8");
const panel = fs.readFileSync(new URL("../features/rvSessions/RvSessionPanel.tsx", import.meta.url), "utf8");
const sqliteSessions = fs.readFileSync(new URL("../storage/sqlite/sessionsRepository.ts", import.meta.url), "utf8");

describe("STEP 5B recovery hardening boundary", () => {
  it("uses durable repository ownership around automatic post-Reveal review", () => {
    expect(postReveal).toContain("withPostRevealReviewLease");
    expect(sqliteSessions).toContain("post_reveal_review_lease_version=post_reveal_review_lease_version+1");
    expect(sqliteSessions).toContain("post_reveal_review_lease_expires_at > strftime");
    expect(sqliteSessions).toContain("executePostRevealReviewFencedTransaction");
    expect(sqliteSessions).toContain("Post-Reveal review lease was lost before provider dispatch or checkpoint save.");
  });

  it("does not shadow the completion override with the computed completion result", () => {
    expect(recovery).toContain("completion?:");
    expect(recovery).toContain("const allCompleted = viewerDone && monitorDone;");
    expect(recovery).toContain("completed: allCompleted");
  });

  it("guards Resume synchronously before React state can render", () => {
    expect(panel).toContain("const postRevealBusyGuardRef = useRef(false);");
    expect(panel).toContain("if (!repository || postRevealBusyGuardRef.current) return;");
    expect(panel).toContain("postRevealBusyGuardRef.current = true;");
    expect(panel).toContain("postRevealBusyGuardRef.current = false;");
  });
});
