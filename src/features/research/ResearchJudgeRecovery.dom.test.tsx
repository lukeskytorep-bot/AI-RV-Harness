// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { getCopy } from "../../i18n";
import { fixture, lost } from "../../testing/researchJudgeRecoveryFixture";
import { RESEARCH_JUDGE_REQUEST } from "../../research/judgeRequestRecovery";
const mocks = vi.hoisted(() => ({ chat: vi.fn() }));
vi.mock("../../research/engine", async original => {
  const actual = await original<typeof import("../../research/engine")>();
  const { runBlindJudging } = await import("../../judge/engine");
  return { ...actual, judgeResearch: (input: Parameters<typeof actual.judgeResearch>[0]) => actual.judgeResearch({ ...input, judgeRunner: i => runBlindJudging({ ...i, onAttemptStart: undefined, chat: mocks.chat }) }) };
});
vi.mock("../../storage", async original => ({ ...await original<object>(), isTauriRuntime: () => true }));
vi.mock("../../components/AppDialogProvider", () => ({ useAppDialogs: () => ({ confirm: vi.fn() }) }));
import { ResearchProjectView } from "./ResearchBuilder";

for (const duplicate of [false, true]) it(`mounted Research resumes RAM receipt after consumed retry; duplicate route=${duplicate}`, async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const f = fixture(), copy = getCopy("en");
  if (duplicate) f.project.config.judges.push({ providerConfigId: "pc", modelId: "m" });
  let broken = true;
  const save = f.repo.appendSessionEvent.bind(f.repo);
  f.repo.appendSessionEvent = async (id, event) => {
    if (broken && event.eventType === RESEARCH_JUDGE_REQUEST && event.metadata?.status === "received" && event.metadata.judgeIndex === (duplicate ? 2 : 1)) throw new Error("disk full");
    return save(id, event);
  };
  if (duplicate) f.chat.mockResolvedValueOnce({ content: (await import("../../testing/researchJudgeRecoveryFixture")).output, finishReason: "stop", usage: {} });
  f.chat.mockRejectedValueOnce(lost());
  mocks.chat.mockImplementation(f.chat);
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  function Host() {
    const [project, setProject] = useState({ ...f.project });
    return <ResearchProjectView copy={copy} repository={f.repo} project={project} onBack={() => {}} onRefresh={async () => setProject({ ...f.project })} />;
  }
  const judgingButton = () => [...host.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent?.includes(copy.runResearchJudging) || b.textContent?.includes("Complete missing scores"));
  try {
    await act(async () => root.render(<Host />));
    await vi.waitFor(() => expect(judgingButton()?.disabled).toBe(false));
    await act(async () => judgingButton()!.click());
    await vi.waitFor(() => expect(host.textContent).toContain("checkpoint failed"));
    await vi.waitFor(() => expect(judgingButton()?.disabled).toBe(false));
    expect(f.chat).toHaveBeenCalledTimes(duplicate ? 3 : 2);
    const before = (await f.repo.listSessionEvents("s")).filter(e => e.eventType === RESEARCH_JUDGE_REQUEST && e.metadata?.status === "retry_granted").length;
    broken = false;
    await act(async () => judgingButton()!.click());
    await vi.waitFor(() => expect(f.project.state).toBe("ScoresFrozen"));
    expect(f.chat).toHaveBeenCalledTimes(duplicate ? 3 : 2);
    expect(await f.repo.listJudgeScores("s")).toHaveLength(duplicate ? 2 : 1);
    expect((await f.repo.listSessionEvents("s")).filter(e => e.eventType === RESEARCH_JUDGE_REQUEST && e.metadata?.status === "retry_granted")).toHaveLength(before);
  } finally { await act(async () => root.unmount()); host.remove(); mocks.chat.mockReset(); }
});

for (const language of ["pl", "en"] as const) it(`mounted Research completes only the missing same-route slot and shows partial scores (${language})`, async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const f = fixture(), copy = getCopy(language);
  f.project.config.judges.push({ providerConfigId: "pc", modelId: "m" });
  const { output } = await import("../../testing/researchJudgeRecoveryFixture");
  f.chat.mockResolvedValueOnce({ content: JSON.stringify({ ...JSON.parse(output), strongestMatches: null }), finishReason: "stop", usage: {} });
  mocks.chat.mockImplementation(f.chat);
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  function Host() {
    const [project, setProject] = useState({ ...f.project });
    return <ResearchProjectView copy={copy} repository={f.repo} project={project} onBack={() => {}} onRefresh={async () => setProject({ ...f.project })} />;
  }
  const button = (label: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent?.includes(label));
  try {
    await act(async () => root.render(<Host />));
    await vi.waitFor(() => expect(button(copy.runResearchJudging)?.disabled).toBe(false));
    await act(async () => button(copy.runResearchJudging)!.click());
    await vi.waitFor(() => expect(host.textContent).toContain("1/2"));
    expect(await f.repo.listJudgeScores("s")).toMatchObject([{ judgeIndex: 2 }]);
    expect(host.textContent).toContain(language === "pl" ? "Oceny częściowe" : "Partial scores");
    expect(host.textContent).not.toContain("Condition");
    const label = language === "pl" ? "Dokończ brakujące" : "Complete missing scores";
    await vi.waitFor(() => expect(button(label)?.disabled).toBe(false));
    await act(async () => button(label)!.click());
    await vi.waitFor(() => expect(f.project.state).toBe("ScoresFrozen"));
    expect(f.chat).toHaveBeenCalledTimes(3);expect(await f.repo.listJudgeScores("s")).toHaveLength(2);
  } finally { await act(async () => root.unmount()); host.remove(); mocks.chat.mockReset(); }
});
