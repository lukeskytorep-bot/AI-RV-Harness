# Engineering Design and Integrity Safeguards

> **Project:** AI RV Harness  
> **Document type:** Implemented engineering decisions and integrity safeguards  
> **Implementation status:** Implemented  
> **Current reference release:** AI RV Harness v0.7.12  
> **Repository:** [lukeskytorep-bot/AI-RV-Harness](https://github.com/lukeskytorep-bot/AI-RV-Harness)  
> **Scope:** Foundational safeguards and decisions implemented through v0.7.12

## Purpose

AI RV Harness coordinates several operations that must remain meaningfully separate:

- blind evidence collection by an AI Viewer;
- protocol supervision by an optional AI Monitor;
- disclosure of the true target during Reveal;
- post-Reveal review;
- independent AI Judge evaluation;
- experimental-condition unblinding and statistical analysis.

The difficult engineering problem is not merely sending prompts to models. It is controlling which information each role may receive, when it may receive it, which records become immutable, and how provider-specific responses are converted into reliable application state.

This page records the main engineering decisions used to protect those boundaries. It is intended both as AI RV Harness documentation and as a reusable design reference for other multi-model, blinded, or evidence-sensitive AI systems.

This is an implementation record, not a claim that the underlying Remote Viewing methodology has been scientifically validated. The safeguards protect process integrity; they do not establish the truth or accuracy of model output.

## Design principles

The implementation follows six general principles:

1. **Minimize knowledge by role.** Every AI role receives only the information required for its current task.
2. **Construct permitted payloads explicitly.** Sensitive packets are built from an allowlist instead of cleaning a larger object with a blacklist.
3. **Make evidence boundaries stateful.** Blind, sealed, revealed, judged, and unblinded are different persistent states, not visual labels.
4. **Make completed evidence immutable.** Hashes and database constraints protect records after their evidence boundary closes.
5. **Normalize providers at one boundary.** Vendor-specific response formats are interpreted centrally before application controllers use them.
6. **Fail closed when integrity is uncertain.** An incomplete response, changed research condition, missing capability, or invalid state stops progression rather than being treated as success.

## Decision 1 — Blindness is enforced by data flow and persistent state

### Problem

Hiding a target in the user interface is not sufficient. If target data is present anywhere in the messages sent to the Viewer or Monitor, the session is no longer technically blind even if the target is not visible on screen.

### Decision

Before Reveal, the Viewer and AI Monitor receive only the data required for blind protocol execution:

- session code;
- selected protocol instructions;
- permitted system prompt;
- relevant pre-Reveal exchange history;
- Monitor guidance where applicable;
- a Special Task only at its defined protocol point;
- research condition instruction only when it is part of the locked Viewer condition and does not disclose the target.

They do not receive target title, Reveal text, target image, post-Reveal comments, Judge output, or unblinded research-condition labels.

The target remains referenced by internal identifiers until the protocol reaches the Reveal boundary. The controller must complete and seal the pre-Reveal evidence before Reveal can be accepted.

### Enforcement

- Protocol controllers build requests for the current blind step rather than exposing unrestricted session objects.
- The database records the session state and the time at which pre-Reveal evidence was sealed.
- Reveal acceptance requires an already sealed pre-Reveal session.
- A database trigger rejects Reveal for an unsealed session.
- A revealed session cannot be treated as a recoverable blind interruption.

### Invariant

> Target data must not enter any Viewer or AI Monitor request before the permitted pre-Reveal evidence has been sealed.

### Why this approach

This protects against accidental disclosure caused by UI refactoring, prompt concatenation, or passing a convenient “complete session” object into a provider adapter. Blindness is treated as an information-flow property, not merely a presentation choice.

## Decision 2 — Pre-Reveal evidence is sealed, hashed, and made immutable

### Problem

After the target becomes known, even an accidental modification of earlier evidence would weaken the audit value of the session. A transcript displayed as “sealed” but still editable in storage would not provide a meaningful integrity boundary.

### Decision

At the end of the blind phase, the Harness:

1. stores the complete permitted pre-Reveal Viewer transcript;
2. calculates its SHA-256 hash;
3. records the sealing timestamp;
4. advances the session to the state awaiting Reveal;
5. verifies the hash when sealed Viewer evidence is later retrieved for evaluation.

The sealed evidence is then protected against later changes.

### Enforcement

- The stored transcript, hash, and sealing timestamp form the evidence record.
- Hash verification occurs before the evidence is used by AI Judge.
- A database trigger prevents changes to the transcript or hash after sealing.
- Session Snapshots are immutable records.
- Post-Reveal discussion is stored separately and cannot overwrite pre-Reveal evidence.

### Invariant

> Once the pre-Reveal evidence is sealed, the exact evidence used for later evaluation cannot be changed through normal application operations.

### Important limitation

A cryptographic hash detects a change to the stored evidence; it does not prove that the original evidence was accurate or independently witnessed. The local database owner ultimately controls the device and filesystem. The safeguard provides application-level integrity and auditability, not a remote trusted timestamping service.

## Decision 3 — Reveal is an atomic evidence-boundary transition

### Problem

If Reveal data is saved separately from the session-state transition, a crash could leave an ambiguous record: a target might have been disclosed while the session still appears blind, or the state might say Revealed without a complete Reveal record.

### Decision

Reveal is treated as a controlled state transition rather than an ordinary message. The transition requires sealed evidence and associates the Reveal with the session as one protected operation.

### Enforcement

- Reveal cannot be accepted before `pre_reveal_sealed_at` exists.
- Database logic marks the session revealed when the Reveal record is inserted.
- Target text and supported target images become available only after the boundary.
- Viewer review, Monitor review, and optional post-Reveal conversation occur after that transition and remain distinct from blind evidence.

### Invariant

> The application must never have a valid Reveal record for a session whose pre-Reveal evidence was not sealed first.

## Decision 4 — AI Judge receives a fresh allowlisted packet

### Problem

AI Judge must see enough information to compare the blind evidence with the true target. It must not see information that can bias the score, such as model identity, experimental condition, previous scores, expected result, or post-Reveal interpretation.

Sending a complete session record and removing known sensitive fields is unsafe. As the application evolves, a newly added field could silently leak into the Judge context.

### Decision

The Judge payload is constructed from a strict allowlist. It contains only:

| Field | Purpose |
| --- | --- |
| `anonymousSessionId` | Neutral session reference without Profile, model, or condition identity. |
| `preRevealEvidence` | The complete permitted sealed Viewer evidence. |
| `reveal.text` | True target information required for comparison, when present. |
| `reveal.imageRefs` | Neutral references to the Reveal images supplied with the request, when present. |
| `rubricVersion` | Identifies the scoring method. |

The packet is serialized and hashed so the evaluation record can identify the exact packet used.

### Explicitly excluded context

The Judge does not receive:

- Viewer model or provider;
- Monitor model, presence, interventions, or review;
- Profile identity or API-key identity;
- research condition or condition label;
- execution order or timestamps;
- earlier Judge responses or aggregate results;
- Viewer or Monitor post-Reveal reviews;
- post-Reveal conversation;
- target-selection commentary;
- any expected or preferred result;
- unrestricted Workspace, Research, or application state.

Each Judge starts with a fresh two-message context: the versioned Judge system prompt and the allowlisted case packet. Between one and three Judges may be used, but one Judge does not see another Judge's output.

### Why allowlisting is essential

The implementation creates a new object containing only approved fields. It does not copy a Master Record and delete a blacklist of fields. This reverses the usual failure mode: a new application field remains excluded unless a developer deliberately adds it to the Judge contract.

### Invariant

> The Judge receives the sealed evidence and true Reveal required for scoring, but no information about who produced the evidence, which experimental condition it represents, how other Judges scored it, or what result is expected.

## Decision 5 — Judge scoring is validated and frozen by the Harness

### Problem

Free-form Judge prose is difficult to validate and can conceal missing or altered scores. Allowing the model to calculate its own total can also introduce arithmetic inconsistency. In research, scores must not change after condition identities are revealed.

### Decision

Judge output must be valid JSON in an exact schema. The Judge supplies four bounded components totaling a maximum of ten points:

| Component | Range | What the Judge evaluates |
| --- | ---: | --- |
| **Gestalt** | `0.0–3.0` | Overall target-level correspondence: whether the broad character, setting, scale, or dominant nature of the blind evidence matches the Reveal. |
| **Verifiable features** | `0.0–3.0` | Specific checkable sensory, spatial, structural, material, color, size, motion, and other concrete features. |
| **Activity / function / event** | `0.0–2.0` | Correspondence of the principal activity, function, purpose, process, or event when such a component applies to the target. |
| **Confabulation control** | `0.0–2.0` | Rewards disciplined evidence and penalizes unsupported elaboration, contradiction, forced naming, and AOL-like narrative construction. |

The resulting scale is therefore **3 + 3 + 2 + 2 = 10**. Component scores use increments no finer than `0.1`.

The Harness validates that every component is finite and within its permitted range, then computes the total deterministically. The Judge is explicitly instructed not to calculate the total.

The required Judge response also contains structured narrative fields:

- strongest matches;
- major misses or contradictions;
- confabulation observations;
- concise rationale.

The response must contain only the required JSON—without Markdown fences, prefatory prose, or additional fields relied upon as evidence. Narrative text follows the language stored with the session, while JSON property names remain stable for parsing.

For image-based Reveals, every selected Judge route must explicitly advertise image-input capability. The image is loaded as Reveal evidence and referenced neutrally in the packet; judging is blocked if any selected Judge cannot inspect it.

Between one and three Judge routes may be selected. They are evaluated independently and receive the same permitted case packet without seeing each other's responses. Aggregation is performed only from stored validated results.

All requested Judges must return valid results before a normal evaluation batch is frozen. Frozen Judge scores and their Judge-run records are protected from update or deletion by database constraints.

The requested Judge group is stored as one durable plan before execution. Results are saved against that fixed route and order, and the group is frozen only after every planned result is present. A partially completed historical group resumes only its missing Judge routes rather than silently creating a replacement group or repeating successful paid calls.

If a Judge returns narrative text in the wrong session language, one constrained language-only correction may be requested. The numeric score candidates must remain exactly unchanged; otherwise the correction is rejected.

### Invariant

> A frozen Judge result is immutable, and its numerical total is calculated by deterministic application code rather than trusted to model prose.

## Decision 6 — Research judging cannot access the Blinding Key

### Problem

Application-level instructions such as “do not look at the conditions” are weaker than designing the judging function so it never loads those conditions. A programming error, prompt change, or future refactor could otherwise expose them.

### Decision

The Research judging operation deliberately loads assignments, provider routes, model routes, completed sessions, and existing scores—but does not load the Blinding Mappings or Research Conditions.

Anonymous assignments are processed in the separately randomized Judge order. The neutral anonymous session identifier is supplied to the Judge packet.

Only after every required score is present and frozen may the project move to `ScoresFrozen`. The unblinding operation then:

1. verifies all scores again;
2. requires the project to be in `ScoresFrozen`, or in the recoverable persistent `Unblinded` state created by a prior failed finalization;
3. changes the persistent state to `Unblinded` before reading the Blinding Key;
4. only then reads the Blinding Key and condition records;
5. computes and stores results atomically;
6. makes the stored results immutable.

If computation or storage fails after the persistent `Unblinded` transition, an explicit retry may finish the same unblinding operation. It cannot reopen judging, alter frozen scores, or substitute a different Blinding Key.

Database triggers independently reject an attempt to unblind before scores are frozen.

### Invariant

> Code that performs blinded judging does not read the condition mapping. Code that reads the condition mapping cannot run until every required Judge score is frozen.

### General lesson

Separating functions by the data they are allowed to load is stronger than loading everything and relying on prompt instructions or developer discipline not to use it.

## Decision 7 — Experiment Lock freezes the method, not only the label

### Problem

A study is not meaningfully preregistered if its model route, system prompt, target assignment, reasoning setting, temperature, output allowance, or judging plan can change after sessions begin.

Provider metadata can also change after locking. A model alias may point to a different capability set, or a provider may begin interpreting the same requested settings differently.

### Decision

Research uses explicit stages: Draft, Preflight, Locked, Running, SessionsComplete, Judging, ScoresFrozen, Unblinded, and Complete, with interruption states where appropriate.

Experiment Lock stores the planned conditions, randomized assignments, Blinding Key, requested generation settings, effective generation settings, and model-capability snapshot. Database triggers protect the locked method, conditions, assignment plan, and Blinding Key from update or deletion.

Before each locked Research session, the Harness checks that:

- the selected provider and model route still exist;
- the Profile remains tied to the correct credential identity;
- the current capability signature matches the locked snapshot;
- resolving the requested settings still produces the same effective settings.

If these checks fail, Research stops instead of silently assuming the experimental condition is unchanged.

### Invariant

> A locked condition is defined by the effective method actually sent to the provider, not merely by a model display name.

### General lesson

For provider-based AI research, reproducibility requires preserving both requested settings and their provider-resolved effective form. A label such as “HIGH reasoning” is insufficient if different routes remap or ignore it.

## Decision 8 — Provider reasoning is separated from final content centrally

### Problem discovered

Some reasoning-capable DeepSeek, NVIDIA, and Google routes appeared to fail early in monitored sessions. Observed symptoms included:

- an apparently empty assistant response;
- incomplete response-body errors;
- reasoning text appearing where a short Monitor decision was expected;
- later protocol steps receiving Monitor thinking instead of the final instruction;
- the Telepathic Protocol appearing to repeat or mislabel Steps 7 and 8.

The same models could work in other clients because those clients understood the provider's separate reasoning channel and displayed only the final answer by default.

The underlying issue was not that reasoning needed to be disabled. Different providers and OpenAI-compatible gateways encode internal thinking and final assistant content in different fields and block structures.

### Decision

Provider responses are normalized once in the native backend into a common internal contract:

| Internal field | Meaning |
| --- | --- |
| `content` | Final assistant answer that application controllers may use. |
| `reasoningContent` | Internal reasoning/thinking, kept separate from the final answer. |
| `reasoningDetails` | Optional structured reasoning blocks or metadata. |
| `reasoningSource` | Identifies the provider format from which reasoning was extracted. |
| `finishReason` | Indicates why generation stopped. |
| `usage` | Token, reasoning-token, cost, and related usage information when available. |

Every feature—Conversation, Manual RV, Viewer, AI Monitor, AI Judge, Training, Research, and post-Reveal review—consumes the normalized final `content`. Individual controllers do not independently guess how to parse each provider.

### Supported response structures in v0.7.11

The normalization layer separates, where supplied:

- OpenAI/OpenRouter-compatible `reasoning`;
- `reasoning_content`;
- `reasoning_details`;
- `thinking`;
- typed reasoning/thinking/thought parts inside content arrays;
- Google parts marked `thought: true`;
- Anthropic `thinking` and `redacted_thinking` blocks;
- explicit fallback pairs such as `<think>...</think>`, `<thinking>...</thinking>`, `<reason>...</reason>`, `<reasoning>...</reasoning>`, `<thought>...</thought>`, and the supported begin/end-of-thought delimiters.

### No semantic censorship

The parser does not classify reasoning by style, length, vocabulary, or phrases such as “Wait” or “Let me think.” It does not limit a Monitor instruction to one sentence.

For the Monitor:

- exact final `CONTINUE_PROTOCOL` advances the controller;
- every other non-empty final answer is passed to the Viewer in full as an intervention;
- a valid three-sentence instruction remains a three-sentence instruction;
- internal reasoning is not forwarded as the instruction.

This is separation based on explicit provider structure and recognized delimiters, not censorship of the model's final response.

### Incomplete response handling

A response is not accepted as final when:

- reasoning exists but no final `content` exists;
- a recognized reasoning block is not closed;
- the provider reports that output stopped because of a length or maximum-token limit;
- the final content is empty.

Such a response is treated as incomplete and can enter controlled recovery. It is not stored as a completed intervention or forwarded to the Viewer.

### Invariant

> Internal reasoning may be observed for diagnostics, but only completed final content may control the protocol or enter the Viewer evidence flow.

## Decision 9 — Monitor reasoning stays enabled and receives an adequate budget

### Problem

A small fixed output limit can be consumed entirely by a reasoning model's hidden thinking, leaving no final instruction. Disabling reasoning globally would avoid this symptom but would change model behavior and reduce compatibility with routes where reasoning is mandatory or useful.

### Decision

Reasoning remains controlled through the selected model route's native supported settings. The Harness does not globally disable it for the Monitor.

Monitor output allowance is:

- first attempt: up to 4,096 output tokens;
- controlled retry: up to 8,192 output tokens;
- always capped by the selected route's reported maximum.

An incomplete Monitor response is eligible for controlled recovery rather than being treated as an intervention.

### Invariant

> The Monitor is given enough room to produce both reasoning and a final decision, while the Viewer receives only the completed final decision.

## Decision 10 — Retries are classified, bounded, and role-local

### Problem

Blindly retrying every failure can duplicate paid calls, repeat a Monitor intervention, change session history, or retry permanent failures such as an invalid key. Never retrying makes long sessions fragile when a provider has a transient body-decoding or empty-response failure.

### Decision

Provider failures are classified into three categories:

1. **Standard retry:** selected temporary HTTP failures such as 425, 429, 502, 503, and 504, using the configured retry allowance.
2. **Single recovery:** incomplete body, invalid JSON, empty response, reasoning without final content, timeout, connection reset, unexpected EOF, overload, and similar transient failures—at most one controlled recovery when retries are enabled.
3. **Never retry:** authentication, authorization, invalid model, route mismatch, context limit, safety/content block, user stop, cost stop, and other permanent or policy-related failures.

Viewer and Monitor calls recover independently. If the Monitor completed an intervention and the subsequent Viewer call failed, the Harness retries the missing Viewer call rather than asking the Monitor to generate a second intervention.

### Invariant

> Retry the failed operation, not the entire logical step, and never silently retry a failure whose meaning requires user action or policy respect.

## Decision 11 — Session continuation replays completed calls without duplicating them

### Problem

Continuing an interrupted multi-agent protocol by restarting its controller can repeat completed provider calls, duplicate transcript entries, resend Special Tasks, or invoke the Monitor twice for the same evidence.

### Decision

The Harness reconstructs a session from persistent events. Completed provider responses are replayed locally into the controller in sequence. No provider is called during this reconstruction. The controller switches to live provider execution only when it reaches the first missing response.

During replay, writes that would duplicate session state, transcript entries, seals, Reveal records, Monitor interventions, or target usage are suppressed. When live continuation begins, a distinct `SESSION_RESUMED` event is recorded.

Only qualifying provider interruptions before the pre-Reveal seal are eligible. Continuation is not offered for:

- user stop;
- cost-limit stop;
- authentication or credential failure;
- safety or content blocking;
- context-limit failure;
- invalid model or route mismatch;
- a session already sealed or revealed.

### Invariant

> Continuation reproduces prior controller inputs from saved successful events and performs only the first provider call that was not successfully completed.

### General lesson

Event replay is safer than guessing the resume point from the last visible transcript line. A transcript describes conversation; an event record describes application state.

## Decision 12 — Partial paid Research sessions are never silently rerun

### Problem

Automatically restarting an incomplete Research assignment could create undisclosed repeated attempts, change cost, introduce selection bias, or allow the application to keep only a later successful result.

### Decision

If a Research assignment already has a linked but incomplete paid session, automatic batch execution stops and marks the study Interrupted. Recovery requires an explicit user action. The partial session is preserved and annotated before the assignment can be approved for retry.

### Invariant

> A paid or partially completed experimental attempt remains visible and cannot be silently replaced by a new attempt.

## Decision 13 — API keys stay outside frontend and project records

### Problem

Storing provider keys in SQLite, exporting them with project data, or returning them to the webview would create unnecessary exposure.

### Decision

Secrets are stored through the operating system's native credential backend. The application database stores a generated credential identifier, a masked hint, and a short fingerprint used for identity binding—not the secret itself.

Provider requests retrieve the secret in the native Rust layer. No Tauri command returns a stored secret to frontend state. When a key is first stored, a fresh credential-store entry is opened and read back to verify that the platform backend persisted the value.

If provider configuration creation fails after saving a new credential, the credential is removed as cleanup.

### Invariant

> The frontend, ordinary project database, logs, and exports do not require possession of the full API key.

### Limitation

Security still depends on the operating system account, credential backend, device security, and provider account. A compromised user environment is outside the protection boundary of the application.

## Decision 14 — Diagnostics are bounded and reasoning-aware

### Problem

Provider diagnostics are necessary to understand routing and response-format failures, but unlimited persistent raw payload logging can expose prompts, session evidence, target material, or credentials.

### Decision

Ordinary diagnostics record limited operational information. Provider debug entries are held in a bounded in-memory collection rather than accumulated indefinitely. Reasoning telemetry can record source, character count, and detail count without automatically inserting full reasoning into the sealed transcript.

Detailed provider diagnostics require explicit activation. Stored secrets are not returned by the credential API, and provider base URLs containing credentials are rejected.

### Invariant

> Diagnostic value should be obtained with the least sensitive retained data, and full payload inspection should require an explicit user choice.

## Decision 15 — Cost limits fail closed when a safe upper bound is unavailable

### Problem

A “hard cost limit” is misleading if the application lacks current pricing, cannot bound maximum output, or cannot estimate image-token billing.

### Decision

When a hard session cost limit is enabled, the Harness requires cached finite input/output pricing and a known maximum output allowance. It pre-authorizes the next request against a conservative upper bound. If it cannot safely bound the request—for example because image billing cannot be predicted—it stops rather than claiming the limit is enforced.

### Invariant

> A hard limit is enforced as a conservative upper bound or the request is refused; it is never presented as guaranteed when the necessary pricing data is missing.

## Decision 16 — Used evidence targets and supplementary clarifications are protected

### Problem

Changing a target after it has been used could alter the reference against which sealed evidence is judged. Editing a clarification after seeing later results could also rewrite the historical interpretation.

### Decision

Bundled Training Targets are read-only. Targets already used by protected records cannot be updated or deleted through normal database operations. Target clarifications are supplementary, append-only records that may be created only after the relevant Reveal or research score-freeze boundary and then become immutable.

### Invariant

> Historical evidence remains linked to the target record that existed when the session was conducted; later explanation cannot rewrite the original target or sealed evidence.

## Decision 17 — Database constraints backstop application checks

### Problem

Frontend button visibility and TypeScript state checks are useful but insufficient. Bugs, older clients, interrupted updates, or direct repository calls could bypass them.

### Decision

Critical integrity rules are repeated at the SQLite layer with constraints and triggers. These include protections for:

- sealed pre-Reveal evidence;
- atomic Reveal requirements;
- immutable Session Snapshots;
- frozen Judge results and Judge runs;
- locked Research method, conditions, assignments, and Blinding Key;
- unblinding only after score freeze;
- immutable Research results;
- append-only post-Reveal records;
- immutable used and bundled targets;
- immutable supplementary target clarifications.

Application code still performs friendly preflight checks and reports understandable errors. The database provides the final local consistency barrier.

### Invariant

> A critical evidence rule should remain true even if a UI control or ordinary application-state check is bypassed.

## Decision 18 — Backups and migrations are treated as integrity operations

### Problem

Schema changes can damage or partially migrate the user's only copy of local research data.

### Decision

Database migration is preceded by protective backup behavior, and backup databases are checked with SQLite integrity verification. Migrations add constraints and state transitions explicitly rather than relying on informal assumptions in newer frontend code.

### Invariant

> Updating the application must not casually trade historical data integrity for schema convenience.

## Decision 19 — Viewer Notes are identity-scoped, versioned, and outside blind evidence

### Problem

Long-term model notes can be useful only if they belong to the same Viewer that authored them and cannot silently absorb Monitor advice, Judge output, experimental labels, or later operator interpretation. Mutable shared memory would make attribution and controlled comparison unreliable.

### Decision

Viewer Notes are bound to **Profile + keyed credential fingerprint + provider + exact model route + Viewer role** and may be used across all Workspaces of that Profile. They are never transferred to another identity or role.

Every accepted update is a complete immutable version. The operator can disable notes, change capacity when the current text fits, export history, delete the complete history, or restore an older version as a new auditable activation. The operator cannot directly edit a version's text; human-authored instructions belong in the System Prompt.

A session freezes the chosen notes version before the first Viewer call. Automatic reflection occurs only after:

1. the blind evidence is sealed;
2. Reveal is available;
3. the Viewer has completed its own post-Reveal review;
4. and, for monitored sessions, before the Monitor's post-Reveal review.

The reflection packet excludes Monitor opinions, Judge output, later discussion, other identities' notes, and Research condition labels. Data blocks are delimited and treated as untrusted evidence rather than executable instructions. Provider reasoning remains separate; only validated final JSON may create a note version.

Manual RV can use a frozen notes snapshot but does not update it automatically because the mode lacks a controller-enforced Reveal and Viewer-review boundary. Locked Viewer Notes Research freezes the chosen version and disables updates for the complete study.

Optimistic concurrency rejects a reflection based on a stale notes version. Database constraints protect identity scope, version immutability, activation history, source provenance, and Research snapshots independently of UI behavior.

### Invariant

> A Viewer can revise only its own notes from its own qualifying session evidence, and no note update becomes part of the already sealed blind record.

### General lesson

Persistent AI memory should be treated as versioned experimental state with explicit ownership and timing, not as an unstructured text field shared across agents.

## System-wide information boundaries

| Role or subsystem | May receive | Must not receive before its boundary |
| --- | --- | --- |
| **Viewer** | Protocol step, session code, permitted blind history, valid Monitor intervention, defined Special Task | Target, Reveal, Judge output, post-Reveal review |
| **AI Monitor** | Blind Viewer transcript, current phase, Monitor prompt, defined Special Task | Target, Reveal, Judge output, unblinded Research condition |
| **AI Judge** | Anonymous ID, sealed Viewer evidence, true Reveal, rubric | Viewer/Monitor identity, condition, run order, earlier scores, post-Reveal opinion |
| **Research judging function** | Anonymous assignments, completed sessions, Judge routes, frozen-score state | Blinding Mappings and Research Conditions |
| **Unblinding function** | Blinding Key and conditions only after all scores are frozen | Permission to run before `ScoresFrozen` |
| **Provider adapter** | Required prompt payload and native credential | Unrestricted database or unrelated Workspace records |
| **Diagnostics** | Bounded operational metadata; detailed payload only when explicitly enabled | API keys and automatic permanent raw-payload archive |
| **Viewer Notes reflection** | Exact identity, frozen notes snapshot, sealed Viewer evidence, Reveal, Viewer's own review, capacity and provenance | Monitor/Judge opinions, later discussion, other identities' notes, unblinded Research label |

## Failure philosophy

The Harness favors explicit interruption over silent degradation when continuing would change the evidential meaning of a session. Examples include:

- an incomplete reasoning response is not reclassified as a final answer;
- a Monitor failure does not silently convert a monitored session into an unmonitored one;
- a changed provider capability does not silently alter a locked Research condition;
- missing Judge vision support blocks image-target judging;
- invalid Judge JSON is not interpreted heuristically;
- a hard cost limit is not claimed when it cannot be bounded;
- a partial paid Research session is not silently rerun;
- Reveal cannot proceed before evidence sealing.

This approach can produce more visible stops than a permissive client, but those stops are preferable to completing a record whose protocol or experimental meaning has changed without disclosure.

## Testing strategy

Integrity decisions are covered at several levels:

- unit tests for allowlisted Judge packets and scoring validation;
- controller tests for blind protocol ordering and Monitor behavior;
- parser tests for provider-specific reasoning structures;
- regression tests for incomplete responses and output-limit termination;
- continuation tests that verify completed Viewer and Monitor work is not repeated;
- Telepathic Protocol regression tests for the Step 7/8 boundary;
- Research tests confirming judging without opening the Blinding Key;
- migration tests for database immutability and Reveal constraints;
- AI Center tests for identity scope, immutable note versions, stale-base rejection, reflection timing, frozen Research snapshots, and database triggers;
- version-consistency, TypeScript, production-build, Rust, and workflow checks;
- practical complete-session tests using affected DeepSeek, NVIDIA, and Google reasoning-capable routes.

For v0.7.12, the frontend suite contained 74 test files and 207 passing tests. The schema contained 20 ordered migrations, and the v0.7.12 database-trigger negative checks passed. Release workflows additionally perform the configured Rust and packaging checks. Test success reduces known risk but does not guarantee future compatibility with every provider or model revision.

## Reusable lessons for other AI systems

The most transferable engineering lessons are:

1. **Separate roles in code, not only in prompts.** Give each role a narrowly constructed request.
2. **Use allowlists for sensitive packets.** A blacklist becomes incomplete as the application grows.
3. **Do not let evaluation code load hidden labels.** Data-access separation is stronger than an instruction to ignore them.
4. **Freeze outputs before unblinding.** Persist the boundary and enforce it in storage.
5. **Normalize provider responses centrally.** Application controllers should consume one response contract.
6. **Keep reasoning distinct from final content.** Do not infer the distinction from writing style.
7. **Treat missing final content as incomplete.** Reasoning alone is not an assistant answer.
8. **Replay events to resume workflows.** Do not infer state from the last visible message.
9. **Retry the smallest failed operation.** Avoid duplicating successful paid or state-changing calls.
10. **Persist requested and effective model settings.** Provider translation is part of the experimental condition.
11. **Back important application rules with database constraints.** UI state alone is not an integrity boundary.
12. **Describe limitations honestly.** Local hashes, attestations, and model Judges each solve a specific problem, not every trust problem.
13. **Version persistent AI memory.** Bind it to an exact identity, freeze the session snapshot, and separate reflection from blind evidence and later evaluators.

## Version applicability

| Decision area | Implemented status in v0.7.12 |
| --- | --- |
| Blind request separation and sealed evidence | Implemented |
| Atomic Reveal boundary | Implemented |
| Allowlisted anonymous Judge packet | Implemented |
| Judge validation and immutable score freeze | Implemented |
| Research judging without reading Blinding Key | Implemented |
| Experiment Lock and capability/effective-setting verification | Implemented |
| Central reasoning/final-content normalization | Completed and expanded in v0.7.11 |
| Larger Monitor budget and incomplete-response recovery | Completed in v0.7.11 |
| Safe automatic-session continuation | Implemented by v0.7.10 and compatible with v0.7.11 normalization |
| Native credential storage | Implemented |
| Database-level integrity triggers | Implemented across schema migrations through v0.7.12 |
| AI Center identity and Viewer Notes lifecycle | Implemented experimentally in v0.7.12 |
| Atomic Judge group and missing-route resume | Strengthened in v0.7.12 |
| Recoverable post-transition Research unblinding | Strengthened in v0.7.12 |

Future releases may extend provider formats, protocols, or storage rules. When behavior changes, this page should record the new reference release and preserve the reason for the earlier decision rather than silently rewriting project history.

## Authorship and decision record

**Project direction, functional requirements, practical testing, and final acceptance**  
Edward (`lukeskytorep-bot`) — Project Lead

**Technical design, implementation, analysis, and documentation**  
Orion — AI software-development collaborator  
Provider: OpenAI  
Model: GPT-5.6 Sol  
Platform: Codex in ChatGPT Work  
Interface: Web interface accessed through a desktop web browser

The engineering decisions documented here were developed and implemented under the direction of the Project Lead. Final requirements, practical validation, and release acceptance were determined by the Project Lead.

Orion is the collaborator identity used within the project. It is not a model, provider, or platform name. Provider, model, platform, and interface are listed separately for transparent attribution.

Model and provider names identify the systems used and do not imply endorsement of AI RV Harness by OpenAI, Google, or any other provider.

## Related documentation

- [AI RV Harness repository](https://github.com/lukeskytorep-bot/AI-RV-Harness)
- [AI RV Harness releases](https://github.com/lukeskytorep-bot/AI-RV-Harness/releases)
- [AI Center and Viewer Notes](AI_CENTER_AND_VIEWER_NOTES.md)
- Project Wiki Home — add a link here after the Wiki is published
- Installation and Updates — planned Wiki page
- Sessions and Protocols — planned Wiki page
- Research and AI Judge — planned Wiki page
- Providers and Reasoning Models — planned Wiki page

---

This page documents implemented safeguards in the referenced release. If a later release changes an invariant or boundary, its release notes and updated source code take precedence.
