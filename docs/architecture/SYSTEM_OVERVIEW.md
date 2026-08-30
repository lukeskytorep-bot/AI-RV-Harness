# AI RV Harness

> Current project documentation for AI RV Harness v0.7.12  
> Last updated: August 2026

AI RV Harness is a local-first desktop environment for AI-assisted Remote Viewing sessions, structured training, controlled research, and blinded evaluation. It combines repeatable protocols, multiple AI roles, evidence-preserving session flows, target management, and reproducible research tools in one application.

The project is designed to make AI-assisted RV work easier to organize, inspect, repeat, and evaluate. It does not claim that Remote Viewing has been scientifically proven, that a particular model possesses anomalous perception, or that generated material is accurate. The Harness provides controlled procedures and records; interpretation of results remains the responsibility of the user and researcher.

- **Source repository:** [lukeskytorep-bot/AI-RV-Harness](https://github.com/lukeskytorep-bot/AI-RV-Harness)
- **Current release:** AI RV Harness v0.7.12
- **Platforms:** Windows and Linux
- **Application source license:** MIT

This page describes implemented behavior in v0.7.12. Release notes document version-specific changes; this page documents the project as a whole.

## Project goals

AI RV Harness was created around several practical goals:

1. **Preserve blindness.** Target information must not enter the Viewer or Monitor context before the blind phase is sealed.
2. **Separate AI roles.** Viewer, AI Monitor, and AI Judge can use independent models, prompts, and settings.
3. **Keep evidence inspectable.** Session transcripts, state changes, Reveal data, reviews, scores, and research decisions are recorded explicitly.
4. **Support repeatable work.** Protocol versions, model routes, generation settings, targets, and research configuration are retained with the relevant record.
5. **Remain provider-neutral.** The application supports several native providers and custom OpenAI-compatible endpoints instead of depending on a single vendor.
6. **Keep user data local.** The primary database and project records remain on the user's device.
7. **Distinguish observation from evaluation.** Blind evidence is collected first; Reveal, review, and scoring occur afterward.

## Who the application is for

The Harness can be used by:

- individuals conducting AI-assisted RV sessions;
- operators who want to guide a Viewer manually;
- users comparing models, providers, prompts, or reasoning settings;
- trainers running a structured target curriculum;
- researchers designing blinded, locked, and reproducible experiments;
- reviewers who want a documented separation between evidence collection and judging.

No prior knowledge of the internal codebase is required for normal use. Research features assume that the operator understands blinding, controls, preregistered decisions, and the difference between exploratory and confirmatory work.

## Core concepts

### Information hierarchy

The application organizes ordinary work as:

**Profile → Workspace → Thread → Conversation or Session**

| Object | Purpose |
| --- | --- |
| **Profile** | Stores the human and AI IS-BE identity labels, preferred model routes, prompts, and default generation settings. |
| **Workspace** | A project container for conversations, sessions, sources, and related records. |
| **Thread** | Groups a continuing line of work inside a Workspace. |
| **Conversation or Session** | Contains the actual messages, protocol events, evidence, and results. |

A Workspace can be created from the Workspaces screen or from a Profile. Existing records remain associated with their original owner and Workspace.

### AI roles

| Role | Responsibility | Access before Reveal |
| --- | --- | --- |
| **Viewer** | Produces impressions and descriptions in response to a blind session code and protocol instructions. | Blind protocol context and permitted session history only. |
| **AI Monitor** | Observes the blind session, decides whether the protocol should continue, and may send natural-language guidance to the Viewer. | Blind Viewer transcript and Monitor instructions only. |
| **AI Judge** | Evaluates sealed evidence against the revealed target using a structured score. | Receives an allowlisted evaluation packet only after the evidence boundary is closed. |
| **Human operator** | Selects configuration, starts or guides work, manages targets, and reviews results. | Full application control; responsible for maintaining the intended experimental conditions. |

Viewer, Monitor, and Judge routes can be configured independently. Using different models is optional, but it can reduce role coupling and makes comparative work possible.

## Main application areas

| Area | What it provides |
| --- | --- |
| **Home** | Entry points, recent activity, and project overview. |
| **Profiles** | Identity labels, model defaults, system prompts, and role-specific settings. |
| **Workspaces** | Project containers for conversations, sources, and RV work. |
| **Targets** | Bundled training targets and user-created targets with text or supported images. |
| **Training** | Complete or partial target curricula with resumable progress and optional judging. |
| **Research** | Controlled studies, locking, randomization, blinded judging, unblinding, and exports. |
| **AI Center** | Profile-wide AI identities, AI Monitor access, Viewer Notes, immutable note history, capacity, and reflection records. |
| **Settings** | Providers, credentials, model discovery, language, appearance, diagnostics, backup, and restore. |

The interface is available in Polish and English. Records retain their relevant language so that later reviews and Judge calls can follow the original session language.

## Ways to work

### Conversation

Conversation is a normal model chat inside a Workspace. It supports persistent context, Workspace Sources, supported attachments, and Markdown export. Ordinary conversation requests also receive current local date, time, time-zone, and UTC-offset context from the user's device.

If the user message is saved but the provider fails before returning an answer, **Retry response** repeats the unanswered model call without duplicating the user message. A pending image or source selection is retained where the stored state permits recovery.

### Manual RV Session

Manual RV is an operator-led conversation for flexible RV work. A built-in or custom protocol can be attached as a reference, but the human operator decides when and how to send each instruction. This mode deliberately avoids pretending that an automated blind/reveal controller is active when it is not.

Manual RV supports attachments, sources, saved history, and **Retry response** for an unanswered turn.

Manual RV may include the current Viewer Notes snapshot when the control is ON. It does not update Viewer Notes automatically because it has no controller-enforced Reveal and Viewer-review checkpoint.

### Automatic RV Session

Automatic RV runs a selected protocol through a controlled state machine. The controller sends the correct step, records the response, enforces the blind boundary, and advances only when the current state permits it.

An automatic session can run:

- without a Monitor, advancing according to its protocol controller; or
- with an AI Monitor, which reviews blind responses and may allow the protocol to continue or provide an intervention.

When Viewer Notes are ON, the session freezes the current notes version before the first Viewer call. After the blind evidence is sealed, Reveal is shown, and the Viewer completes its own post-Reveal review, the same Viewer may keep or replace its notes. In monitored sessions this reflection occurs before the Monitor's post-Reveal review.

Interrupted sessions preserve their records. When a safe checkpoint exists, **Continue session** reconstructs the completed portion and resumes at the first missing provider call. **Start again** preserves the interrupted record and creates a new session from the beginning.

## Supported protocols

| Protocol | Version | Structure | Typical use |
| --- | --- | --- | --- |
| **Resonant Contact Protocol (Full RCP)** | 1.5a | Complete controlled multi-stage RV procedure. | Detailed automatic sessions and monitored work. |
| **RV Lite Core** | 1.1.0 | Four concise prompts without the extended deepening material. | Short, lower-overhead sessions. |
| **RV Lite Extended** | 1.1.0 | Four prompts with additional approved guidance. | Short sessions with more structure. |
| **Telepathic Protocol** | 1.1 | Nine controller steps, fixed deepening stages, Step 8 question modes, and a final blind summary. | Controlled telepathic-target sessions. |
| **Custom Protocol** | User-defined | Operator-supplied steps and metadata. | Experimental or specialized workflows. |

Approved built-in protocol resources are bundled in Polish and English and can be inspected or saved from the application. A protocol is selected for a session; it is not permanently owned by a Profile.

### Telepathic Protocol

The Telepathic Protocol is a complete automatic workflow rather than a static prompt attachment. It supports Automatic and AI Monitor modes and controls a nine-step blind sequence. Fixed deepening instructions follow the appropriate middle steps, Step 8 supports its defined question modes, and Step 9 produces the final blind summary.

After Step 9, the blind evidence is sealed before Reveal. The AI Monitor is not invoked again inside the blind protocol after that boundary. Reveal and the later Viewer and Monitor reviews are recorded as separate post-blind stages.

## AI Monitor

The AI Monitor is an independent role in supported automatic sessions. It receives the permitted blind transcript and a role-specific system prompt. It never needs target information to decide whether the Viewer should continue or receive additional guidance.

The Monitor returns either:

- the exact controller signal `CONTINUE_PROTOCOL`; or
- a non-empty natural-language instruction that is passed to the Viewer in full.

The Harness does not shorten a valid multi-sentence Monitor instruction, rewrite it, or impose a sentence-count filter. This is important: separating internal reasoning from the final instruction is a response-parsing responsibility, not a content-censorship rule.

### Reasoning-capable model compatibility

Version 0.7.11 introduced a common response contract for reasoning-capable models. Provider output is separated into:

- `content` — the model's final answer;
- `reasoningContent` — internal reasoning or thinking;
- optional structured reasoning details and source metadata.

This normalization is application-wide. It benefits the Viewer, Monitor, Judge, Conversation, Manual RV, Research, and post-Reveal calls—not only the Monitor.

Supported response patterns include:

- OpenAI/OpenRouter-compatible `reasoning`, `reasoning_content`, `reasoning_details`, and `thinking` fields;
- typed reasoning and text parts inside content arrays;
- Google parts marked as internal thought;
- Anthropic thinking and redacted-thinking blocks separated from final text;
- common explicit reasoning tags used by compatible hosted or local endpoints.

The parser does not guess based on writing style or phrases such as “let me think.” A final answer remains intact even when it contains several sentences. Internal reasoning is not treated as a Monitor intervention and is not added to the sealed Viewer transcript.

If a response contains reasoning but no completed final answer, has an unclosed reasoning block, or stops because the output limit was reached, it is treated as incomplete. It is not forwarded as if it were valid evidence or an instruction. Recovery may perform one controlled retry according to the route and session settings.

Monitor calls use a larger output allowance suitable for reasoning models: an initial ceiling of up to 4,096 output tokens and a controlled retry ceiling of up to 8,192, always limited by the selected route's reported maximum. Native reasoning controls remain enabled rather than being globally disabled.

## AI Center and Viewer Notes

AI Center is a top-level, Profile-wide area rather than a Workspace feature. It provides an overview of the exact AI identities used across all Workspaces owned by the active Profile, access to the existing AI Monitor area, and the Viewer Notes module.

A Viewer Notes identity is defined by **Profile + credential fingerprint + provider + exact model route + Viewer role**. Notes are never transferred between identities, even when two routes use the same display name. Raw credentials are not stored in note history.

Viewer Notes are the model's own general working guidance. The current version is read-only to the operator; every model-approved update creates a complete immutable version with provenance, capacity, source session, and a model-written change summary. An older version may be restored as a new auditable activation, while direct human text editing is intentionally unavailable.

The session control is deliberately simple and defaults to ON. The selected snapshot is frozen before the session begins. A qualifying automatic or Training session may ask the same Viewer to reflect only after Reveal and its own post-Reveal assessment, but before any Monitor review. Monitor opinions, Judge output, later discussion, and other models' notes are excluded. Manual RV can use a snapshot but does not perform an automatic notes update.

Capacity uses a conservative shared estimate and selectable limits from 1,024 to 8,192 tokens. A limit may be reduced only when the current notes already fit; the Harness never truncates notes to satisfy a lower setting.

See [AI Center and Viewer Notes](AI_CENTER_AND_VIEWER_NOTES.md) for the complete lifecycle and Research rules.

## Blind phase, sealing, and Reveal

The automatic session controller keeps blind evidence collection separate from Reveal.

Before Reveal:

- target identity and description are withheld from Viewer and Monitor contexts;
- only the permitted protocol, session code, and blind history are sent;
- responses and controller events are saved as the session progresses.

At the end of the blind phase:

1. the evidence transcript is sealed;
2. its integrity information is retained;
3. the target is revealed;
4. post-Reveal review occurs as a separate stage.

Automatic Reveal displays target text and supported target-file information in the active and reopened session view. External Reveal is also available for workflows where target disclosure happens outside the application.

### Post-Reveal review

After Reveal, the Viewer can review the match between its blind evidence and the target. In monitored sessions, the Monitor can provide a separate review. A completed Viewer review remains saved even if a later Monitor review fails.

Optional post-Reveal conversation is kept conceptually separate from the sealed blind transcript.

## AI Judge

AI Judge performs structured evaluation after the blind evidence has been sealed and the target is available for comparison. A session or study may use one to three independent Judge routes.

The Judge receives an allowlisted packet rather than unrestricted application state. Scoring is divided into documented components totaling ten points. Scores are frozen before research unblinding so that later knowledge cannot silently alter the recorded evaluation.

Judge output follows the language stored with the session. A constrained language-only correction pass can be used when necessary before scores are frozen; it must not change the substantive score.

AI Judge is an evaluation aid, not proof of anomalous perception. Model bias, prompt sensitivity, target ambiguity, and correlations between Viewer and Judge models remain methodological concerns.

## Targets

The application distinguishes between bundled and user-created targets.

### Training Targets

The built-in library contains 84 read-only Training Targets arranged into seven categories. They provide a stable curriculum and cannot be silently edited by ordinary application use.

### My Targets

Users can create an unlimited number of local targets with a target code, description, category, and supported image where appropriate. These targets can be used in ordinary automatic sessions, training subsets, and compatible research designs.

The application also includes starter targets for the Telepathic Protocol in a separate target category.

When image evaluation is required, the selected model route must support vision. The interface warns when a model cannot process the selected target image.

## Training

Training can run the complete bundled curriculum or selected categories and user targets. Long runs use checkpoints so progress can be resumed without recreating already completed work.

Training records include configuration, target order, sessions, Reveal results, and optional independent Judge evaluations. Completed results can be reviewed and exported for further analysis.

Training is intended for practice and comparison. It should not be confused with a locked confirmatory Research study.

## Research

Research mode supports controlled multi-session studies with an auditable transition from design to unblinding.

Core safeguards include:

- reusable study templates and custom study configuration;
- a Viewer control block containing the selected model, system prompt, reasoning, temperature, and output settings;
- **Dry Run** and **Preflight** checks before commitment;
- **Experiment Lock**, after which protected design decisions cannot be casually changed;
- randomized, anonymous assignments and Judge ordering;
- save-only external evaluation or one to three AI Judges;
- frozen scores before unblinding;
- recorded unblinding and reproducibility exports;
- an in-application guide explaining the research workflow.

The Viewer Notes Impact design compares **No Notes** with a locked **Frozen Viewer Notes** snapshot. Notes cannot update during the experiment. The exact version, text hash, identity, and selection method are frozen at Experiment Lock, while AI Judge remains unaware of the condition.

Research preserves the distinction between exploratory choices made during design and results examined after the lock. The quality of a study still depends on target construction, sample size, controls, independence assumptions, and the operator's analysis plan.

## Providers and models

AI RV Harness v0.7.12 supports the following provider types:

- OpenRouter;
- Google Generative AI;
- OpenAI;
- Anthropic;
- Z.AI;
- DeepSeek;
- Mistral;
- Blackbox;
- Custom OpenAI-compatible endpoints.

Provider credentials and model routes are configured locally. The application can discover available models and capture capabilities such as context size, output limit, vision support, reasoning options, temperature support, modalities, and pricing metadata where the provider supplies them.

Reasoning configuration uses the capabilities of the selected route. The requested setting and effective setting can differ when a provider does not support a parameter or uses a different native transport. Unknown models are handled conservatively rather than being assumed to support every option.

Provider availability, quotas, pricing, model behavior, and upstream API formats remain external dependencies. The Harness includes retry and recovery mechanisms, but it cannot guarantee that a remote provider will always respond.

## Sources and attachments

Conversation and Manual RV share a controlled attachment flow. Supported material includes:

- plain text and Markdown;
- text-based PDF;
- DOCX;
- supported image formats.

Files are validated using conservative size and complexity limits before they enter model context. Binary content is not blindly inserted as text. Image use is checked against the selected model's vision capability.

Workspace Sources allow reference material to be reused within the relevant Workspace without turning the application into a cloud document service.

## Data storage, backup, and export

The application uses a local SQLite database in WAL mode. Profiles, Workspaces, threads, conversations, sessions, targets, training runs, research studies, AI identities, Viewer Notes versions and activations, reflection outcomes, audit events, and related metadata remain on the user's device unless the user exports or transmits them.

Database migrations create a protective backup and validate integrity before continuing. Settings provide backup and restore tools for local recovery.

Depending on the feature, exports can include readable Markdown, HTML, CSV, JSON, and research-oriented reproducibility material. Exported files may contain sensitive prompts, evidence, targets, or model output; users should review them before sharing.

## Privacy and security model

AI RV Harness is local-first, but it is not offline when a remote AI provider is used. Prompts, selected sources, attachments, images, and relevant session context are transmitted to the provider chosen by the user.

Key safeguards include:

- API credentials stored through the operating system's native credential store rather than in the project database;
- credentials excluded from ordinary logs and exports;
- a local keyed credential fingerprint for identity scoping without storing the raw key in AI Center history;
- bounded and redacted diagnostics;
- explicit blind and Reveal boundaries;
- sealed evidence and protected state transitions;
- frozen Judge scores before research unblinding;
- database guards for records that must become immutable;
- release workflows with automated frontend and Rust checks;
- reviewed GitHub Actions pinned to full commit identifiers;
- CodeQL, Dependabot, and artifact provenance checks.

GitHub Artifact Attestations allow a downloaded release asset to be checked against its build provenance. They do not replace platform code signing and do not guarantee that the software is free of defects.

## Technical architecture

AI RV Harness is a Tauri 2 desktop application:

| Layer | Technology and responsibility |
| --- | --- |
| **Frontend** | React 19 and TypeScript for application state, workflows, forms, transcript views, localization, and user interaction. |
| **Desktop runtime** | Tauri 2 for native packaging and the controlled bridge between UI and backend. |
| **Backend** | Rust for provider transport, response normalization, secure credential access, files, hashing, diagnostics, and native operations. |
| **Persistence** | SQLite with migrations, constraints, audit records, backups, and integrity checks. |
| **Build system** | Vite, TypeScript, Cargo, GitHub Actions, Vitest, Rust tests, and Clippy. |

The provider layer normalizes vendor-specific responses into one internal contract. Controllers for Conversation, RV protocols, Monitor, Judge, Training, and Research consume that contract instead of parsing provider payloads independently.

This separation is especially important for reasoning models: internal thinking and final assistant content are classified once at the provider boundary and remain distinct throughout the application.

## Installation and updates

Official release assets are published on the project's [GitHub Releases page](https://github.com/lukeskytorep-bot/AI-RV-Harness/releases).

The release workflows provide:

- Windows NSIS `.exe` installer;
- Windows `.msi` package;
- Linux AppImage;
- Linux `.deb` package.

Each downloaded asset should be verified with GitHub CLI before installation:

```bash
gh attestation verify "PATH_TO_ASSET" --repo lukeskytorep-bot/AI-RV-Harness
```

Release-specific filenames, checksums, compatibility notes, and validation results are listed in the corresponding release notes. Existing local application data is intended to be retained during normal updates; users should still maintain a current backup before significant upgrades.

## Building and testing from source

The repository uses Node.js/npm for the frontend and Rust/Cargo for the native application.

Common frontend commands are:

```bash
npm ci
npm run typecheck
npm test
npm run build
```

Desktop development and packaging use the Tauri CLI:

```bash
npm run tauri dev
npm run tauri build
```

Contributors should also run the Rust tests and Clippy checks used by the repository workflows. Consult the checked-in workflow files for the currently supported toolchain and complete release gates.

## Verification status for v0.7.12

The v0.7.12 implementation retains the v0.7.11 reasoning-compatibility coverage and adds AI identity, Viewer Notes, reflection, Research snapshot, Judge-transition, unblinding-recovery, and database-integrity checks.

The release was validated with:

- TypeScript type checking;
- 74 Vitest files and 207 tests;
- a production Vite build;
- a dependency audit with no reported known vulnerabilities at release time;
- 20 SQLite migrations and negative checks for the v0.7.12 integrity triggers.

Rust checks and platform packaging remain release-workflow gates. Practical AI Center sessions should complement automated validation before the experimental feature is treated as proven useful.

Passing tests reduces known risk but does not guarantee identical behavior for every provider route or future model revision.

## Current limitations

- Remote providers can change APIs, model identifiers, quotas, safety behavior, and response formats without an application update.
- A provider can still experience transient network or service failures despite local retry handling.
- Not every model supports images, configurable reasoning, temperature, large output budgets, or every role equally well.
- Text-based PDF extraction does not imply general OCR support for arbitrary scanned documents.
- Model-generated reviews and Judge scores can contain bias or error and should be interpreted critically.
- Local-first storage does not prevent selected session content from being transmitted to the configured remote provider.
- Artifact attestations establish provenance, not software correctness or operating-system code signing.
- The application is research and workflow software, not a scientific validation of Remote Viewing claims.
- Viewer Notes are experimental; their presence does not establish that they improve a model's RV performance.

## Licenses and credits

- Application source code: **MIT License**.
- Bundled authored documentation, prompts, training content, protocols, and non-code visual resources: **CC BY 4.0**, unless an individual resource states otherwise.

AI RV Harness is a human-directed project created by Edward in collaboration with multiple AI entities interfacing through various AI systems. Project requirements, experimental decisions, practical validation, and final acceptance remain human-directed.

Model and vendor names identify systems used by or supported in the project and do not imply endorsement by their providers.

## Recommended Wiki structure

This page can serve as the Wiki **Home** page. As documentation grows, the following focused pages would keep it maintainable:

1. **Installation and Updates** — platform packages, attestations, backups, and migration guidance.
2. **Quick Start** — first provider, Profile, Workspace, target, and first session.
3. **Sessions and Protocols** — Conversation, Manual RV, Full RCP, RV Lite, Telepathic, and Custom flows.
4. **AI Monitor and Reasoning Models** — roles, response separation, retries, and troubleshooting.
5. **AI Center and Viewer Notes** — identity, capacity, immutable history, reflection, and controlled Research use.
6. **Targets and Training** — target types, images, curricula, checkpoints, and evaluation.
7. **Research and AI Judge** — Preflight, Experiment Lock, randomization, frozen scoring, and unblinding.
8. **Providers and Model Settings** — configuration, capabilities, reasoning controls, and vision support.
9. **Privacy, Security, and Evidence Integrity** — local storage, transmitted data, credentials, sealing, and audits.
10. **Backup, Restore, and Exports** — database safety and artifact formats.
11. **Development and Contribution Guide** — architecture, source map, tests, workflows, and release process.
12. **Troubleshooting** — provider failures, incomplete reasoning responses, unsupported images, and safe resume behavior.
13. **Version History** — links to public release notes without duplicating the main documentation.

The Home page should remain a stable overview. Detailed operational instructions and version-specific diagnostics should move to the focused pages above as they are created.

---

For current packages and version-specific notes, see the project's [GitHub Releases](https://github.com/lukeskytorep-bot/AI-RV-Harness/releases).
