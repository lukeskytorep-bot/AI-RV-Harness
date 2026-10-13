// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { getCopy } from "../i18n";
import { createDefaultSettings } from "../startupDefaults";
import type { AppRepository } from "../storage/repository";
import type { Profile, Workspace } from "../types";
import type { TelepathicTranscriptEvent } from "../telepathicExchange/types";
import { actualDisplayRun } from "../telepathicExchange/__fixtures__/readableRuns";
import { BrowserTelepathicExchangeRepository } from "../storage/browser/telepathicExchangeRepository";
import { telepathicExportDocument } from "../telepathicExchange/export";
import { TelepathicExchangePanel } from "../features/conversations/TelepathicExchangePanel";
import { TelepathicTrainingPanel } from "../features/training/TelepathicTrainingPanel";
import { TelepathicTranscript } from "./TelepathicTranscript";

vi.mock("./SafeMarkdown", async original => {
  const actual = await original<typeof import("./SafeMarkdown")>();
  return { SafeMarkdown: (props: { content: string }) => {
    if (props.content.startsWith("FORCE_ERROR\n")) throw new Error("Synthetic Markdown render fault");
    return <actual.SafeMarkdown {...props}/>;
  } };
});

for (const mode of ["conversation_exchange", "ai_ai_training"] as const) for (const language of ["pl", "en"] as const) for (const legacy of [false, true]) {
  it(`${mode}/${language}/${legacy ? "legacy" : "new"}: mounted readable cards, authorship, history refresh and export retain answers`, async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const { result: state } = await actualDisplayRun(language);
    state.config.mode = mode;
    if (mode === "conversation_exchange") state.config.participants[1].kind = "human";
    if (legacy) for (const event of state.transcript!) delete event.display;
    const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
    const data = new Map<string,string>(); const storage = { getItem: (key:string) => data.get(key) ?? null, setItem: (key:string,value:string) => {data.set(key,value);},get length(){return data.size;},clear:()=>data.clear(),key:(index:number)=>[...data.keys()][index]??null,removeItem:(key:string)=>{data.delete(key);} } as Storage;
    const store = new BrowserTelepathicExchangeRepository({ storage }); await store.saveTelepathicSeries(state);
    const repository = { getTelepathicSeries: store.getTelepathicSeries.bind(store), listTelepathicSeriesSummaries: store.listTelepathicSeriesSummaries.bind(store),
      getTelepathicSeriesLeaseState: store.getTelepathicSeriesLeaseState.bind(store), listProviderConfigs: async () => [], listProviderModels: async () => [] } as unknown as AppRepository;
    const profiles: Profile[] = [], workspaces: Workspace[] = [];
    const wait = (assert: () => unknown) => vi.waitFor(async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve,0)); }); assert(); }, { timeout: 3000 });
    const render = () => act(async () => root.render(mode === "conversation_exchange"
      ? <TelepathicExchangePanel copy={getCopy(language)} settings={{...createDefaultSettings(),interfaceLanguage:language,sessionLanguage:language}} profile={{id:"a",name:"a"} as Profile} workspace={{id:"w"} as Workspace} profiles={profiles} workspaces={workspaces} repository={repository}/>
      : <TelepathicTrainingPanel copy={getCopy(language)} settings={{...createDefaultSettings(),interfaceLanguage:language,sessionLanguage:language}} profiles={profiles} workspaces={workspaces} repository={repository}/>));
    try {
      await render(); await wait(() => expect(container.querySelectorAll(".telepathic-transcript-message").length).toBeGreaterThan(3));
      expect(container.textContent).not.toMatch(/FG PRIVATE|VN PRIVATE|READ-ONLY|OWN_BLIND_DATA|CONTRACT:|CURRENT_ROUND_DATA|RECEIVER ANSWERS AND REFLECTIONS/);
      expect(container.textContent).toContain("ACTUAL MODEL ANSWER with notes and system words");
      expect(container.textContent).toContain(language === "pl" ? "Kontroler programu" : "Program controller");
      expect(container.textContent).toContain(language === "pl" ? "Prowadzący — lead" : "Lead — lead");
      expect(container.textContent).toContain(language === "pl" ? "Refleksja po Revealu — a" : "Post-Reveal reflection — a");
      const doc = telepathicExportDocument(state); expect(doc).toContain("Describe motion"); expect(doc).toContain("ACTUAL MODEL ANSWER with notes and system words"); expect(doc).not.toMatch(/FG PRIVATE|VN PRIVATE|READ-ONLY|OWN_BLIND_DATA/);
      const rawEvidence = JSON.stringify((await store.getTelepathicSeries("display"))!.providerCalls); expect(rawEvidence).toContain("FG PRIVATE LEARNING"); expect(rawEvidence).toContain("VN PRIVATE LEARNING");
      if (mode === "conversation_exchange") {
        const hidden: TelepathicTranscriptEvent = { id:"new-hidden",seriesId:"display",roundId:state.rounds[0].assignment.roundId,sequence:999,stage:"sender_target",kind:"materials",authorId:"controller",recipientIds:["lead"],text:"HIDDEN RAW",display:{version:1,instruction:"HIDDEN DISPLAY"},createdAt:"t" };
        state.transcript!.push(hidden); delete state.rounds[0].revealedAt; await store.saveTelepathicSeries(state);
        await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label^="Open"],button[aria-label^="Otwórz"]')!.click());
        expect(container.textContent).not.toContain("HIDDEN DISPLAY"); expect(telepathicExportDocument(state)).not.toContain("HIDDEN DISPLAY");
        state.rounds[0].revealedAt = "t"; await store.saveTelepathicSeries(state);
        await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label^="Open"],button[aria-label^="Otwórz"]')!.click());
        expect(container.textContent).toContain("HIDDEN DISPLAY"); expect(telepathicExportDocument(state)).toContain("HIDDEN DISPLAY");
      }
    } finally { await act(async () => root.unmount()); container.remove(); }
  });
}

it("long malformed Markdown stays inside its card; equal text remains distinct for recipients and raw HTML is not enabled", async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement("div"); const root = createRoot(container);
  const event = (id:string,authorId:string,text:string,sequence:number): TelepathicTranscriptEvent => ({id,seriesId:"s",roundId:"r",sequence,stage:"receiver_first",kind:"response",authorId,recipientIds:[],text,createdAt:"t"});
  const broken = event("broken","lead","# Heading\n| A | B |\n|---|---|\n|x|y|\n```\n<svg><script>PRIVATE_EXECUTION</script></svg>\n" + "long text ".repeat(300),1);
  const a = event("a","a","# NEXT CARD\nnotes system boundary remain participant words",2);
  const b = event("b","b",a.text,3);
  try {
    await act(async () => root.render(<TelepathicTranscript seriesId="s" roundId="r" leadId="lead" participants={[{id:"lead",displayName:"DevStral"},{id:"a",displayName:"Leo"},{id:"b",displayName:"Gemma"}]} events={[broken,a,a,b]} pl={false}/>));
    expect(container.querySelectorAll(".telepathic-transcript-message")).toHaveLength(3);
    expect([...container.querySelectorAll(".markdown-content h1")].filter(node => node.textContent === "NEXT CARD")).toHaveLength(2);
    expect(container.querySelector("script")).toBeNull(); expect(container.querySelectorAll(".markdown-content svg")).toHaveLength(0);
    expect(container.textContent).toContain("Response — Leo"); expect(container.textContent).toContain("Response — Gemma");
  } finally { await act(async () => root.unmount()); }
});

it("a local Markdown render fault falls back to escaped text and resets on new content", async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement("div"); const root = createRoot(container); const error = vi.spyOn(console,"error").mockImplementation(() => undefined);
  const event: TelepathicTranscriptEvent = {id:"fault",seriesId:"s",roundId:"r",sequence:1,stage:"receiver_first",kind:"response",authorId:"a",recipientIds:[],text:"FORCE_ERROR\n<script>escaped</script>",createdAt:"t"};
  const render = () => act(async () => root.render(<TelepathicTranscript seriesId="s" roundId="r" leadId="a" participants={[{id:"a",displayName:"A"}]} events={[event]} pl={false}/>));
  try {
    await render(); expect(container.querySelector(".telepathic-raw-fallback")?.textContent).toBe(event.text); expect(container.querySelector("script")).toBeNull();
    event.text = "# Recovered"; await render(); expect(container.querySelector(".telepathic-raw-fallback")).toBeNull(); expect(container.querySelector(".markdown-content h1")?.textContent).toBe("Recovered");
  } finally { await act(async () => root.unmount()); error.mockRestore(); }
});
