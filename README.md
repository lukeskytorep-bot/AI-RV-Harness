# AI RV Harness

AI RV Harness is a local-first desktop workspace for AI conversations, blind Remote Viewing sessions, structured Training, telepathic exchange and controlled Research. It records procedures, evidence and evaluations; it does not establish that Remote Viewing works or that a model's impressions are accurate.

The application uses **Tauri 2, React, TypeScript, Rust and SQLite**. It has Polish and English interfaces and Windows/Linux packaging workflows.

## Which version does this describe?

This README describes the **`ai-rv-2` development source reviewed on 16 October 2026, through Training Continuity T5**. The package version is still **0.7.13**, the database schema is **31**, and **v0.7.14** names the development/release scope. A green implementation patch does not publish a release or prove desktop/provider acceptance.

The recorded public v0.7.13 baseline and its original verification remain under [release documentation](docs/releases/v0.7.13/). Use [GitHub Releases](https://github.com/lukeskytorep-bot/AI-RV-Harness/releases) for available downloads and their own compatibility notes. Do not assume that a development Actions artifact is a public release.

## What you can do

| Area | Purpose |
| --- | --- |
| Profiles | Configure AI identity, provider connection and default Viewer/model settings. |
| Conversations | Ordinary chat, selected sources/attachments and optional read-only Viewer Learning. |
| RV Sessions | Manual RV and automatic RCP, RV Lite or compatible custom protocols. |
| Training | Classic RV Training with learning, or a separate AI–AI telepathic workflow. |
| AI Center | AI identities, Monitor history, Field Guide and Viewer Notes. |
| Targets | 94 read-only factory Training targets in eight categories, My Targets and a separate telepathic target set. |
| Research | Freeze studies, run blinded assignments, freeze Judge scores before unblinding and export reproducibility records. |
| Settings | Connections, model capabilities, generation settings, appearance, diagnostics and backup/restore. |

Conversations and RV Sessions use separate typed Workspaces. New Profiles receive one of each. Historical `legacy_combined` Workspaces remain readable. Training and Research resolve a compatible technical RV Workspace without exposing another Workspace selector.

### Classic Training and memory

Full Training freezes one to ten rounds of eight category-balanced sessions before starting. Partial Training uses explicit category counts and may include My Targets. Resume retains the saved target order, Session identity and completed stages.

After Reveal, the sequence is **Viewer Review → Field Guide Update → Viewer Notes Reflection → optional Judge**. Field Guide and Viewer Notes have separate histories and separate durable limits: **at most two dispatched requests for each update in one session/packet**, including transport retry and repair. An invalid second proposal is recorded as `failed_preserved`; Training continues with the previous exact version, or with no version if the first notes were never created. A failure is not the model's `NO_CHANGE` decision.

Classic Training handles optional post-Reveal failures automatically. An unconfirmed Field Guide or Viewer Notes request preserves previous memory without resending that request or asking for confirmation. A provider failure or an unconfirmed request in optional Viewer Review skips learning for that session; no review text is invented. Detailed learning results remain in AI Center, not on the Training screen or its history cards. Stop, lost ownership, database failures and snapshot/hash corruption still interrupt execution and retain completed work. Blind-session recovery retains its own rules. Export also includes an interrupted first Session and its active checkpoint.

Only **classic Training** updates learning. Ordinary RV, Conversations, Research and AI–AI Telepathic Training consume allowed snapshots read-only. Learning belongs to an exact Profile/credential/provider/model/Viewer identity; it is never silently transferred to another route.

### Telepathic exchange and Training

The two telepathic surfaces share a role-safe engine. New `fixed_lead_v1` series freeze a selected lead, participants, routes, personal learning and per-round geography. Each round locks its own target. The lead may request up to three additional cycles, followed by Reveal and reflections. AI–AI Training supports 2–6 distinct Profiles. New decisions use `fixed_lead_guidance_v2`: one separately addressed `individual` instruction per active Viewer, or an explicit finish for that Viewer. The whole round can end with an empty instruction list. Identical questions must be repeated as separate addressed entries. Saved v1 decisions and requests keep their original contract, including accepted broadcasts. Historical series retain their recorded protocol and budget policy.

The operator can inspect the run; an AI receives only its permitted packet. Before Reveal, receivers do not receive the hidden target/geography or other receivers' blind answers. Opening history/export never calls a model. History uses paged summaries; this does not mean every planned history/refresh optimization is complete.

### Stop, Resume and native ownership

Stop cancels active work and prevents later dispatch. Resume is explicit, replays accepted stored work and starts at the first missing stage. End is a permanent user decision to stop further execution while retaining history; it does not falsely complete a run.

A finished but rejected response is distinguished from an unconfirmed request. `response_finished` proves that transport completed, not that the answer is usable. Earlier unknown physical attempts remain unknown even if a later attempt finished. Explicit retry authorization for an essential Viewer step never resets the learning allowance.

Classic owned desktop workflows use a Rust heartbeat every 10 seconds with a 45-second lease. Owner/version checks still reject stale writes. This removes reliance on one WebView timer; it does not keep a suspended or terminated process running. Telepathic and post-Reveal leases retain their own contracts.

## Output allowances

These are the current source preferences, **not guaranteed provider capacity**. Input context, endpoint/model limits and native reasoning consumption remain separate constraints.

| Operation | First / recovery preference |
| --- | --- |
| Conversation | 16,384 default; former unversioned 8,000/8,192 setting upgrades once, later deliberate reductions remain |
| Manual RV Viewer | 32,768 → 49,152 |
| Automatic blind RV / classic Training Viewer | 16,384 → 32,768 |
| New Research Viewer | Frozen Viewer policy, normally 16,384 → 32,768 |
| Judge and post-Reveal analytical work, including classic Training Review | 32,768 → 49,152 |
| Field Guide / Viewer Notes | Document capacity C + 32,768 → C + 49,152; C does not increase |
| Live Monitor | 16,384 → 32,768 |
| New fixed-lead Telepathy Reveal, shared comments and series reflection | 32,768 → 49,152 |
| Other new fixed-lead stages / sharing consent | 16,384 → 32,768 / 8,192 → 16,384 |

Locked Research and existing telepathic scopes keep their saved policy versions, including older allowances. See the [current workflow reference](docs/architecture/CURRENT_WORKFLOWS_v0.7.14_EN.md) for exact owners and compatibility rules.

## Providers, data and safety

Native adapters cover OpenRouter, OpenAI, Google, Anthropic, Z.AI, DeepSeek, Mistral, Blackbox and Custom OpenAI-compatible endpoints. Model discovery and supported reasoning controls are route-specific. An arbitrary model/deployment is not automatically compatible merely because it exposes an HTTP endpoint.

API secrets use native credential storage. Requests send the permitted prompt/attachments to the selected provider. Provider-native continuation is fingerprinted and kept outside visible evidence. A bounded final-channel candidate can be retained for rejected learning output; private reasoning is not substituted for a final answer. Literal `<think>` text inside JSON is data, not automatically a reasoning envelope.

The app seals blind evidence before Reveal, uses allowlisted Judge packets and a fixed **3 + 3 + 2 + 2** rubric, and freezes Research scores before unblinding. Archive/Restore and explicit Permanent Delete remain separate operations. Back up local data before testing upgrades. Usage/cost estimates are diagnostic; this branch has no hard SessionCostGuard spend authorization layer.

## For developers

Start with the **English [Developer Guide](docs/development/README.md)** and [CONTRIBUTING.md](CONTRIBUTING.md). Use Node **24** and the Rust stable/tooling required by the checked-in workflows.

```bash
npm ci
npm run tauri dev
```

Linux requires the native Tauri/WebKit packages listed in the Developer Guide; Windows requires its native build/WebView prerequisites. A browser-only preview (`npm run dev`) does not provide native credentials, SQLite, backup/restore or equivalent desktop acceptance.

The Developer Guide lists the complete frontend, source, architecture, compatibility, Rust, Clippy and cross-language bridge checks. Keep `Cargo.lock` committed and use `--locked`. Do not package `node_modules`, `dist`, Rust `target`, databases or private logs.

## Documentation

- [Documentation index](docs/README.md)
- [English user/wiki guide](docs/wiki/Home.md)
- [Current workflows and budgets — English](docs/architecture/CURRENT_WORKFLOWS_v0.7.14_EN.md) ([Polski](docs/architecture/CURRENT_WORKFLOWS_v0.7.14_PL.md))
- [Architecture and code ownership](docs/architecture/README.md)
- [Final desktop/runtime checklist](docs/architecture/FINAL_RUNTIME_SMOKE_v0.7.14_EN.md)
- [Historical release records](docs/releases/)

Current automated checks and historical release evidence are different records. The T1–T5 implementation scope is delivered; final Windows/provider smoke is recorded separately and is not implied by this documentation update.

## License and attribution

Application source: [MIT](LICENSE). Eligible protocols/documentation/content: [CC BY 4.0](CONTENT_LICENSE_CC_BY_4.0.md), unless a resource states otherwise. See [CREDITS.md](CREDITS.md), [PRIVACY.md](PRIVACY.md) and [SECURITY.md](SECURITY.md).
