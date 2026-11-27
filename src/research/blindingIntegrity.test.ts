import { expect, it } from "vitest";
import { targetCodeConfig } from "../testing/targetCodeFixture";
import { buildResearchLockPlan, hashBlindingMapping, stableStringify } from "./planner";
import { sha256Text } from "../application/sha256";
import { indexLockedResearchConditions, validateResearchBlindingMappings } from "./blindingIntegrity";
import type { ResearchProjectRecord } from "./types";

async function fixture() {
  const config = targetCodeConfig();
  config.repetitions = 2;
  const project = { id: "r", templateType: config.templateType, config } as ResearchProjectRecord;
  const plan = await buildResearchLockPlan(project.id, config);
  const { conditionById } = indexLockedResearchConditions(project, plan.conditions);
  return { project, ...plan, conditionById };
}

it("validates a complete plan and retains the original hash projection including null order", async () => {
  const f = await fixture();
  const { anonymousSessionId, conditionId, pairKey, mappingHash } = f.mappings[0];
  expect(mappingHash).toBe(await sha256Text(stableStringify({ anonymousSessionId, conditionId, pairKey, pairOrder: null })));
  expect((await validateResearchBlindingMappings(f.project, f.assignments, f.mappings, f.conditionById)).size).toBe(4);
});

it.each(["condition", "pair", "order", "missing", "duplicate", "orphan", "foreign", "unknown", "duplicate session", "incomplete pair", "missing repetition"] as const)(
  "refuses %s drift in a locked Research plan",
  async damage => {
    const f = await fixture();
    const first = f.mappings[0];
    switch (damage) {
      case "condition": first.conditionId = f.mappings[1].conditionId; break;
      case "pair": first.pairKey = f.mappings[2].pairKey; break;
      case "order": first.pairOrder = "FIRST"; break;
      case "missing": f.mappings.shift(); break;
      case "duplicate": f.mappings[1].anonymousSessionId = first.anonymousSessionId; break;
      case "orphan": first.anonymousSessionId = "BlindSession_ORPHAN"; break;
      case "foreign": first.researchProjectId = "other"; break;
      case "unknown": first.conditionId = "other"; break;
      case "duplicate session": f.assignments[0].sessionId = f.assignments[1].sessionId = "same"; break;
      case "incomplete pair":
        first.pairKey = "new-pair";
        first.mappingHash = await hashBlindingMapping(first);
        break;
      case "missing repetition":
        f.mappings.splice(0, 2);
        f.assignments.splice(0, 2);
        break;
    }
    await expect(validateResearchBlindingMappings(f.project, f.assignments, f.mappings, f.conditionById)).rejects.toThrow();
  },
);
