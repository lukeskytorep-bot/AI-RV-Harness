import { DatabaseSync } from "node:sqlite";
import { SqliteSessionsRepository } from "../storage/sqlite/sessionsRepository";
import { describe, expect, it } from "vitest";
import { monitorInstructionPairs, monitorInstructionMarkdown } from "./monitorInterventions";
import { readableBlindTranscript, reconstructAcceptedBlindTranscript } from "./blindTranscriptEvidence";
import type { SessionEventRecord } from "./types";

function event(sequenceNumber: number, eventType: string, content = "Observe movement.", metadata: Record<string, unknown> = {}): SessionEventRecord {
  return { id: `e${sequenceNumber}`, sessionId: "s", sequenceNumber, eventType, content, metadata, createdAt: "now" };
}
function pair(step = 3, exchangeNumber = 1, identity?: string) {
  const stepId = `telepathic:step:${step}:monitor_intervention:exchange:${exchangeNumber}`;
  return [
    event(1, "MONITOR_INTERVENTION", undefined, { step, exchangeNumber, ...(identity ? { interventionId: identity, viewerStepId: stepId } : {}) }),
    event(2, "CONTROLLER_STEP", undefined, { step, exchangeNumber, source: "monitor_intervention", ...(identity ? { interventionId: identity, stepId } : {}) }),
  ];
}
describe("Monitor intervention identity and read-only projection", () => {
  it.each([undefined, "linked-id"])("pairs one exact logical instruction (%s) without editing durable events", identity => {
    const events = pair(3, 1, identity), original = structuredClone(events);
    expect(monitorInstructionPairs(events)).toEqual([{ monitor: events[0], controller: events[1], identical: true }]);
    expect(events).toEqual(original);
  });
  it.each(["sessionId", "step", "exchangeNumber", "passIndex", "interventionId", "stepId"])("does not hide instructions with conflicting %s", field => {
    const events = pair(3, 1, "linked-id");
    if (field === "sessionId") events[1].sessionId = "other";
    else events[1].metadata = { ...events[1].metadata, [field]: field === "step" ? 4 : field === "exchangeNumber" ? 2 : field === "passIndex" ? 2 : "wrong" };
    expect(monitorInstructionPairs(events)).toHaveLength(0);
  });
  it("does not guess a legacy pair across an intervening response or a different instruction", () => {
    const events = pair();
    expect(monitorInstructionPairs([events[0], event(2, "VIEWER_RESPONSE"), { ...events[1], sequenceNumber: 3 }])).toHaveLength(0);
    expect(monitorInstructionPairs([events[0], event(2, "CONTROLLER_STEP", "Other step", { step: 4 }), { ...events[1], sequenceNumber: 3 }])).toHaveLength(0);
  });
  it("preserves duplicate IDs as ambiguous instead of collapsing separate records", () => {
    const events = pair(3, 1, "linked-id");
    expect(monitorInstructionPairs([...events, { ...events[1], id: "duplicate-controller", sequenceNumber: 3 }])).toHaveLength(0);
  });
  it("never deduplicates a normal Controller step or a RCP intervention by text", () => {
    const events = pair();events[1].metadata = { step: 3 };
    expect(monitorInstructionPairs(events)).toHaveLength(0);
    expect(monitorInstructionPairs([event(1, "MONITOR_INTERVENTION", undefined, { phase: 3, exchangeNumber: 1 }), event(2, "CONTROLLER_STEP", undefined, { phase: 3, exchangeNumber: 1, source: "monitor_intervention" })])).toHaveLength(0);
  });
  it.each([false, true])("keeps the pre-entered T9 question identity (%s)", linked => {
    const events = [
      event(1, "MONITOR_INTERVENTION", "Intention?", { step: 8, exchangeNumber: 2, source: "operator_predefined_t9", ...(linked ? { interventionId: "t9", viewerStepId: "telepathic:step:8:monitor:question:2" } : {}) }),
      event(2, "CONTROLLER_STEP", "T9 — tasking question 2\nIntention?", { step: 8, questionNumber: 2, telepathicPhase: "T9", source: "monitor", ...(linked ? { interventionId: "t9", stepId: "telepathic:step:8:monitor:question:2" } : {}) }),
    ];
    expect(monitorInstructionPairs(events)).toEqual([{ monitor: events[0], controller: events[1], identical: false }]);
  });
  it.each(["pl", "en"] as const)("preserves actual T9 instructions in a %s read-only export of old sealed evidence", language => {
    const events = pair(8);events[1].content = "T9 — tasking question 1\nObserve movement.";
    events.push(event(3, "VIEWER_RESPONSE", "Blind answer", { step: 8, exchangeNumber: 1, source: "monitor_intervention", telepathicPhase: "T9", accepted: true }));
    const original = structuredClone(events);
    const legacy = reconstructAcceptedBlindTranscript(events, language, false)!;
    const projected = readableBlindTranscript(events, legacy, language);
    expect(projected).toContain(language === "pl" ? "Faktycznie wysłana instrukcja" : "Actually sent instruction");
    expect(projected).toContain(events[1].content);expect(projected).toContain("Blind answer");
    expect(readableBlindTranscript(events, legacy + "\nUnknown accepted material", language)).toBe(legacy + "\nUnknown accepted material");
    expect(events).toEqual(original);
  });
  it("keeps one instruction in the canonical readable block when texts are identical", () => {
    expect(monitorInstructionMarkdown("Observe movement.", "Observe movement.", "en").match(/Observe movement\./g)).toHaveLength(1);
  });
});

it("round-trips intervention identity and both original instruction records through real SQLite", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("CREATE TABLE session_events(id TEXT PRIMARY KEY, session_id TEXT, sequence_number INTEGER, event_type TEXT, role TEXT, content TEXT, metadata_json TEXT, created_at TEXT)");
    const bind = (query: string, values: unknown[] = []) => ({ statement: db.prepare(query.replace(/\$(\d+)/g, "?$1")), parameters: Object.fromEntries(values.map((value, index) => [String(index + 1), value])) });
    const repository = new SqliteSessionsRepository({
      isResearchScoresFrozen: async () => false,
      select: async <T>(query: string, values: unknown[] = []) => { const { statement, parameters } = bind(query, values); return statement.all(parameters as never) as T; },
      executeWrite: async (query, values = []) => { const { statement, parameters } = bind(query, values); return { rowsAffected: Number(statement.run(parameters as never).changes) }; },
      executeTransaction: async () => { throw new Error("This event-only test must not use a transaction path"); },
    });
    const original = pair(3, 1, "persisted-link");
    for (const event of original) await repository.appendSessionEvent("s", event);
    const loaded = await repository.listSessionEvents("s");
    expect(loaded.map(event => ({ content: event.content, metadata: event.metadata }))).toEqual(original.map(event => ({ content: event.content, metadata: event.metadata })));
    expect(monitorInstructionPairs(loaded)).toHaveLength(1);
    expect(loaded).toHaveLength(2);
    expect(db.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
  } finally { db.close(); }
});
