import { describe, expect, it, vi } from "vitest";
import { fixture, model, output, lost } from "../testing/researchJudgeRecoveryFixture";
import { judgeResearch } from "./engine";
import { parseJudgeOutput, runBlindJudging } from "../judge/engine";
import { normalizeResearchJudgeOutput } from "../judge/researchNormalization";
import { getUncertainResearchJudges } from "./judgeRecovery";
import { RESEARCH_JUDGE_COMPLETION_AUTH, RESEARCH_JUDGE_REQUEST, ResearchJudgeCheckpointError } from "./judgeRequestRecovery";
import type { FrozenJudgeResultInput, JudgeScoreRecord } from "../judge/types";
import type { ResearchAssignmentRecord } from "./types";

const canonical = JSON.parse(output);
const aliased = JSON.stringify({ scores: canonical.scores, strong_matches: canonical.strongestMatches,
  major_misses_contradictions: canonical.majorMissesContradictions, confabulation_observations: canonical.confabulationObservations, concise_rationale: canonical.conciseRationale });
function multiple(count = 3, judges = 2) {
  const f = fixture(), bySession = new Map<string, JudgeScoreRecord[]>();
  f.project.config.judges = Array.from({ length: judges }, () => ({ providerConfigId: "pc", modelId: "m" }));
  const assignments = Array.from({ length: count }, (_, i) => ({ id: `a${i}`, researchProjectId: "r", sessionId: `s${i}`, targetId: "t", status: "SessionComplete", judgeOrder: i, anonymousSessionId: `BlindSession_${String(i).padStart(8,"0")}` })) as ResearchAssignmentRecord[];
  f.repo.listResearchAssignments = async () => assignments;
  f.repo.listJudgeScores = async id => structuredClone(bySession.get(id) ?? []);
  f.repo.recordFrozenJudgeResults = vi.fn(async (inputs: FrozenJudgeResultInput[]) => inputs.map(({ run, score }) => {
    const existing = bySession.get(run.sessionId) ?? [];
    if (existing.some(s => s.judgeIndex === run.judgeIndex)) throw new Error("Duplicate slot");
    const result = { ...score, judgeIndex: run.judgeIndex, modelRoute: run.modelRoute, total: 6, frozenAt: "t", createdAt: "t" };
    bySession.set(run.sessionId, [...existing, result].sort((a,b) => a.judgeIndex-b.judgeIndex)); return result;
  }));
  f.repo.updateResearchAssignment = async (id, _sessionId, status) => { assignments.find(a => a.id === id)!.status = status; };
  const run = (completeMissing = false, signal?: AbortSignal) => judgeResearch({ repository: f.repo, projectId: "r", completeMissing, signal,
    judgeRunner: input => runBlindJudging({ ...input, onAttemptStart: undefined, chat: f.chat }) });
  return { ...f, run, assignments, bySession };
}

describe("Research Judge completion", () => {
  it("normalizes only the four documented aliases without changing scores or narrative", async () => {
    expect(() => parseJudgeOutput(aliased)).toThrow(/strongestMatches/);
    const normalized = normalizeResearchJudgeOutput(aliased);
    expect(parseJudgeOutput(normalized.content)).toEqual(parseJudgeOutput(output));
    expect(normalized.trace?.aliases).toHaveLength(4);
    const f = fixture(); f.chat.mockResolvedValue({ content: aliased, finishReason: "stop", usage: {} });
    await f.run(); expect(f.chat).toHaveBeenCalledTimes(1);
    const events = await f.repo.listSessionEvents("s");
    expect(events.find(e => e.eventType === RESEARCH_JUDGE_REQUEST && e.metadata?.status === "received")?.metadata?.response).toMatchObject({ content: aliased });
    expect(events.find(e => e.eventType === "RESEARCH_JUDGE_NORMALIZED")?.metadata?.version).toBe("research-judge-aliases/v1");
    expect((await f.repo.listJudgeScores("s"))[0].narrative).toEqual(canonical && parseJudgeOutput(output).narrative);
  });
  it.each([
    { ...JSON.parse(aliased), strongestMatches: ["conflict"] },
    { ...JSON.parse(aliased), scores: undefined },
    { ...JSON.parse(aliased), scores: { ...canonical.scores, gestalt: 4 } },
    { ...JSON.parse(aliased), concise_rationale: undefined },
    { scores: canonical.scores, unknown_matches: [] },
  ])("rejects ambiguous, missing and invalid values without a formatter request", async value => {
    const f = fixture(); f.chat.mockResolvedValue({ content: JSON.stringify(value), finishReason: "stop", usage: {} });
    await expect(f.run()).rejects.toThrow(); expect(f.chat).toHaveBeenCalledTimes(1);
    expect(await f.repo.listJudgeScores("s")).toHaveLength(0);
  });
  it("keeps ordinary RV parsing strict unless Research explicitly opts in", async () => {
    const f = fixture(); f.chat.mockResolvedValue({ content: aliased, finishReason: "stop", usage: {} });
    await expect(runBlindJudging({ repository: f.repo, sessionId: "s", language: "en", judges: [{ providerConfig: (await f.repo.listProviderConfigs())[0], model }], chat: f.chat })).rejects.toThrow(/strongestMatches/);
    expect(f.chat).toHaveBeenCalledTimes(1);
  });
  it("recovers an already validation-blocked historical response locally without API or new authorization", async () => {
    const f = fixture(); f.project.state = "Judging";
    await f.repo.appendSessionEvent("s", { eventType: "RESEARCH_JUDGE_RESPONSE", role: "controller", content: aliased, metadata: { modelRoute: model.route, finishReason: "stop" } });
    await f.repo.appendSessionEvent("s", { eventType: "RESEARCH_JUDGE_VALIDATION_BLOCK", role: "controller", content: "Judge field strongestMatches must be a text array.", metadata: { modelRoute: model.route, judgeIndex: 1 } });
    await f.run(); expect(f.chat).not.toHaveBeenCalled(); expect(f.project.state).toBe("ScoresFrozen");
    expect(await getUncertainResearchJudges(f.repo,"r")).toHaveLength(0);
    expect((await f.repo.listSessionEvents("s")).some(e => e.eventType === RESEARCH_JUDGE_COMPLETION_AUTH)).toBe(false);
  });
  it("a failure on session five leaves 95/96 scores, including the independent same-route Judge", async () => {
    const f = multiple(48);
    f.chat.mockImplementation(async () => ({ content: f.chat.mock.calls.length === 9 ? JSON.stringify({ ...canonical, strongestMatches: null }) : output, finishReason: "stop", usage: {} }));
    await expect(f.run()).rejects.toThrow(/incomplete/);
    expect(f.chat).toHaveBeenCalledTimes(96); expect([...f.bySession.values()].flat()).toHaveLength(95);
    expect(f.bySession.get("s4")!.map(s => s.judgeIndex)).toEqual([2]);
    expect(f.project.state).toBe("Judging");
    expect(await getUncertainResearchJudges(f.repo, "r")).toEqual([{ sessionId: "s4", modelRoute: model.route }]);
    const existing = structuredClone([...f.bySession.entries()]);
    await expect(f.run()).rejects.toThrow(/incomplete/); expect(f.chat).toHaveBeenCalledTimes(96);
    expect([...f.bySession.entries()]).toEqual(existing);
    await f.run(true); expect(f.chat).toHaveBeenCalledTimes(97); expect(f.project.state).toBe("ScoresFrozen");
    expect(f.bySession.get("s4")!.map(s => s.judgeIndex)).toEqual([1,2]);
    expect((await f.repo.listSessionEvents("s4")).filter(e => e.eventType === RESEARCH_JUDGE_COMPLETION_AUTH)).toHaveLength(1);
  });
  it("completion limits survive restart and another allowance requires another explicit action", async () => {
    const f = multiple(1,1); f.chat.mockRejectedValue(lost());
    await expect(f.run()).rejects.toThrow(); expect(f.chat).toHaveBeenCalledTimes(2);
    await expect(f.run(true)).rejects.toThrow(); expect(f.chat).toHaveBeenCalledTimes(4);
    Object.defineProperty(f.repo, "recoveryOwner", { value: {}, configurable: true });
    await expect(f.run()).rejects.toThrow(); expect(f.chat).toHaveBeenCalledTimes(4);
    const events = await f.repo.listSessionEvents("s0");
    expect(events.filter(e => e.eventType === RESEARCH_JUDGE_COMPLETION_AUTH)).toHaveLength(1);
    f.chat.mockResolvedValue({ content: output, finishReason: "stop", usage: {} });
    await f.run(true); expect(f.chat).toHaveBeenCalledTimes(5); expect(f.project.state).toBe("ScoresFrozen");
    const auth = (await f.repo.listSessionEvents("s0")).filter(e => e.eventType === RESEARCH_JUDGE_COMPLETION_AUTH);
    expect(auth).toHaveLength(2); expect(auth[1].metadata?.previousId).toBe(auth[0].metadata?.completionId);
    expect((await f.repo.listSessionEvents("s0")).filter(e => e.eventType === RESEARCH_JUDGE_REQUEST && e.metadata?.status === "retry_granted")).toHaveLength(2);
  });
  it("a failed authorization write cannot dispatch a new request", async () => {
    const f = multiple(1,1); f.chat.mockRejectedValue(lost()); await expect(f.run()).rejects.toThrow();
    const save = f.repo.appendSessionEvent.bind(f.repo);
    f.repo.appendSessionEvent = async (id, e) => { if (e.eventType === RESEARCH_JUDGE_COMPLETION_AUTH) throw new Error("disk full"); return save(id,e); };
    await expect(f.run(true)).rejects.toBeInstanceOf(ResearchJudgeCheckpointError); expect(f.chat).toHaveBeenCalledTimes(2);
  });
  it("STOP, freeze failure, checkpoint failure and request mismatch halt the entire queue", async () => {
    for (const failure of ["stop", "freeze", "checkpoint", "mismatch"]) {
      const f = multiple(), stop = new AbortController();
      if (failure === "stop") f.chat.mockImplementation(async () => { stop.abort(); throw lost(); });
      if (failure === "freeze") f.repo.recordFrozenJudgeResults = async () => { throw new Error("disk full"); };
      if (failure === "checkpoint") {
        const save = f.repo.appendSessionEvent.bind(f.repo);
        f.repo.appendSessionEvent = async (id,e) => { if (e.eventType === RESEARCH_JUDGE_REQUEST && e.metadata?.status === "received") throw new Error("disk full"); return save(id,e); };
      }
      if (failure === "mismatch") {
        f.repo.recordFrozenJudgeResults = vi.fn().mockRejectedValueOnce(new Error("disk full"));
        await expect(f.run()).rejects.toThrow(); f.chat.mockClear();
        f.repo.getViewerEvidence = async () => "Changed frozen evidence";
      }
      await expect(f.run(false,stop.signal)).rejects.toThrow();
      expect(f.chat).toHaveBeenCalledTimes(failure === "mismatch" ? 0 : 1);
    }
  });
  it("End remains authoritative and no completion clears its marker", async () => {
    const f = multiple(); const marker = { reason: "user_finished", endedAt: "t", stateAtEnd: "Judging", phase: "judging" } as const;
    f.repo.getResearchExecutionTermination = async () => marker;
    await expect(f.run(true)).rejects.toThrow(/ended by the user/); expect(f.chat).not.toHaveBeenCalled();
    expect(await f.repo.getResearchExecutionTermination("r")).toBe(marker);
  });
});

it("rejects orphaned completion receipts and invalid authorization chains before any request", async () => {
  for (const orphan of [true,false]) {
    const f = multiple(1,1);
    await f.repo.appendSessionEvent("s0", { eventType: orphan ? RESEARCH_JUDGE_REQUEST : RESEARCH_JUDGE_COMPLETION_AUTH, role: "controller", metadata: { modelRoute: model.route, judgeIndex: 1, version: 1, completionId: "orphan", previousFailureEventId: "missing" } });
    await expect(f.run(true)).rejects.toThrow(/authorization/); expect(f.chat).not.toHaveBeenCalled();
  }
});

it("a completion authorization with a lost commit acknowledgement is reused after restart", async () => {
 const f = multiple(1,1);f.chat.mockRejectedValue(lost());await expect(f.run()).rejects.toThrow();
 const save=f.repo.appendSessionEvent.bind(f.repo);let broken=true;
 f.repo.appendSessionEvent=async(id,e)=>{await save(id,e);if(broken && e.eventType===RESEARCH_JUDGE_COMPLETION_AUTH)throw new Error("ack lost");};
 await expect(f.run(true)).rejects.toBeInstanceOf(ResearchJudgeCheckpointError);expect(f.chat).toHaveBeenCalledTimes(2);
 broken=false;f.chat.mockResolvedValue({content:output,finishReason:"stop",usage:{}});await f.run();expect(f.chat).toHaveBeenCalledTimes(3);
 expect((await f.repo.listSessionEvents("s0")).filter(e=>e.eventType===RESEARCH_JUDGE_COMPLETION_AUTH)).toHaveLength(1);
});
