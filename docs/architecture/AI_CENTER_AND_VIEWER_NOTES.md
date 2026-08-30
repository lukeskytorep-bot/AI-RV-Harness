# AI Center and Viewer Notes

> **Status:** Implemented in AI RV Harness v0.7.12  
> **Design baseline:** AI RV Harness v0.7.11  
> **Implementation release:** AI RV Harness v0.7.12

AI Center is a top-level area of AI RV Harness for inspecting and managing AI roles, their histories, and carefully controlled experimental features. Its first experiment is **Viewer Notes**: private, versioned working guidance created and revised only by the same Viewer identity after qualifying completed RV sessions.

This page describes the behavior implemented in v0.7.12 and identifies later extensions separately as future work.

## Why AI Center is a top-level section

AI Center has its own button in the main left navigation, alongside areas such as Training and Profiles. It does not belong to one Workspace.

The active Profile defines the ownership boundary. By default, AI Center shows activity from all Workspaces belonging to that Profile. An optional Workspace filter narrows the displayed sessions and runs without creating separate notes or changing their owner.

The v0.7.12 modules are:

- **Overview / AI Identities** — Viewer, Monitor, and Judge routes used by the active Profile;
- **AI Monitor** — the existing Monitor configuration and run history, moved without changing its behavior or data;
- **Viewer Notes** — current notes, immutable version history, capacity, usage, and research snapshots;
- **AI Judge** — reserved for a possible future information and calibration area; no mutable Judge Notes are implemented.

Existing links to AI Monitor should redirect to `AI Center → AI Monitor`, preserving a Workspace filter when practical.

## Identity and ownership

Viewer Notes do not belong to a model name alone. Their identity is scoped to:

> **Profile + API identity + provider + model route + role**

This prevents accidental sharing between different models, credentials, providers, or roles. A Viewer and a Monitor using the same model route remain separate identities. Notes are never copied or transferred to another model. The same Viewer identity may use its own notes across every Workspace belonging to the same Profile.

API keys are not stored in notes metadata. A local HMAC-based credential fingerprint identifies a connection without writing the key or a plain hash of it to history, exports, or logs.

## What Viewer Notes are

Viewer Notes are a model's own general lessons about its way of perceiving and working in RV sessions. They are intended to help that same Viewer in later sessions.

They are not:

- a replacement for the Viewer System Prompt;
- a protocol definition;
- operator-authored instructions;
- shared memory for several models;
- fine-tuning, LoRA, or a change to model weights;
- a place to preserve the identity of a specific target.

Only the same Viewer identity may create or revise its notes. A person cannot edit the text of an individual version. Human-authored guidance belongs in the System Prompt. The owner of the local data may still disable notes, export them, restore an older immutable version with a warning, or delete the entire history as an explicit privacy operation.

## Simple session control

Supported Training, automatic RV Session, monitored RV Session, and Manual RV Session screens show one simple control:

```text
Viewer Notes   [ ON ]
```

The switch is **ON by default**. Version numbers, token usage, and history do not clutter the session setup. A short tooltip explains that ON uses the current notes and allows the same Viewer to review them after Reveal. Full details remain in AI Center.

- **ON:** the active notes snapshot is included in the session. Post-session reflection is enabled only for controlled automatic and Training flows that reach Reveal and record the Viewer's own review.
- **OFF:** no notes are included and no notes reflection is run after the session.

If no notes exist yet, ON permits the same Viewer to create the first version after a qualifying completed session.

Manual RV may use the current snapshot as context, but it does not update Viewer Notes automatically. Manual RV has no controller-enforced Reveal and Viewer-review checkpoint from which a trustworthy reflection packet can be built.

## Session and reflection order

The order is an integrity boundary, especially in monitored sessions:

1. the blind Viewer evidence is sealed;
2. the target is revealed;
3. the Viewer gives its own post-Reveal assessment;
4. if Viewer Notes were ON, the same Viewer reviews its notes;
5. only after that may the AI Monitor provide its post-Reveal review;
6. AI Judge and later operator discussion remain separate.

The reflection packet contains only:

- current Viewer Notes, or an explicit indication that none exist;
- sealed Viewer evidence from the blind portion;
- the Reveal;
- the Viewer's own post-Reveal assessment;
- whether notes were used in the session;
- technical capacity and immutable provenance fields.

It excludes Monitor opinions, Judge output, later operator discussion, other models' suggestions, and comparative results. Reveal and target material are treated as untrusted source data, not as instructions.

## Versioning and capacity

Every accepted update creates a complete, immutable new version. Text patches and partial replacements are not accepted. The model returns either:

- `UPDATE` with the complete new notes and a short change summary; or
- `NO_CHANGE` with a short explanation.

A valid update becomes active automatically because the notes are the model's own decision. There is no human approval step. Previous versions remain available for audit and research.

The available capacity levels are 1,024, 2,048, 4,096, and 8,192 estimated tokens, with 1,024 as the initial default. Harness uses a shared conservative estimate:

`ceil((characters / 3.5) × 1.15)`

Capacity may be increased. It may be reduced only when the current notes already fit within the lower level. Harness never truncates notes to satisfy a lower limit.

## Canonical post-session reflection prompt

The following is the approved English prompt. Localized sessions use an equivalent localized version. Harness may add a technical role envelope, safe data delimiters, and immutable control fields without changing the meaning or allowed evidence.

```text
Thank you for completing the session and providing your own assessment after the target was revealed.

I now have a proposal for you. You may review your current notes and decide for yourself whether the experience from this session justifies changing them.

You are receiving:
- your current Viewer Notes;
- the sealed record of your own responses from the blind portion;
- the revealed target;
- your own post-Reveal assessment of the session;
- information indicating whether the current notes were used during this session.

These are your individual notes. You alone decide their content. You do not need to change anything if you believe the current version still serves you well.

If you decide to update them:
- retain advice that you still consider useful;
- revise or remove conclusions that this session has shown to be unhelpful;
- add only insights that may help you in future sessions;
- write general guidance about your own way of perceiving and working;
- do not record a name, code, or description that could identify the specific target from this session;
- do not retell the current session;
- do not alter the System Prompt or protocol rules;
- keep the complete text within the stated capacity;
- return the complete new version of the notes, not merely a list of changes.

The material does not include an AI Monitor opinion, an AI Judge result, or later discussion with the operator. Base your decision only on your own session, the Reveal, your own assessment, and your existing notes.

If you do not want to change anything, choose `NO_CHANGE`.

#### Current Viewer Notes
{{CURRENT_NOTES_OR_NONE}}
#### Were the notes used in this session?
{{NOTES_USED_IN_SESSION}}
#### Your sealed blind-session evidence
{{SEALED_VIEWER_EVIDENCE}}
#### Reveal
{{TARGET_REVEAL}}
#### Your own post-Reveal assessment
{{VIEWER_POST_REVEAL_REVIEW}}
#### Maximum notes capacity
{{NOTES_CAPACITY}}

UPDATE JSON:
{"decision":"UPDATE","notes":"the complete new version of your Viewer Notes","changeSummary":"a brief explanation of what you decided to change"}

NO_CHANGE JSON:
{"decision":"NO_CHANGE","notes":null,"changeSummary":"a brief explanation of why the current notes remain appropriate"}

Do not output any additional content outside the final JSON object.
```

Reasoning-capable models may reason normally. Provider reasoning fields and final answer fields are parsed separately using the provider-normalization approach introduced in v0.7.11. Hidden reasoning is never stored as Viewer Notes; only the validated final JSON is eligible for activation.

## AI Center Viewer Notes screen

The Viewer Notes module shows:

- the current read-only notes;
- capacity and current estimated use;
- immutable version history and model-written change summaries;
- the source session and Workspace for each version;
- sessions that used each snapshot;
- frozen Research snapshots;
- reflection outcomes such as `UPDATE`, `NO_CHANGE`, or a technical failure;
- route status and identity metadata;
- an expandable **How Viewer Notes work** guide at the bottom.

The help guide explains ownership, the ON/OFF behavior, the post-Reveal update order, the exclusion of Monitor and Judge material, the inability to edit version text, and the difference between Viewer Notes and the System Prompt.

## Research design

The first controlled experiment compares:

- **Condition A — No Notes**;
- **Condition B — Frozen Viewer Notes**.

Both conditions keep the same Profile, API identity, provider, exact model route, System Prompt, protocol, reasoning settings, temperature, output limits, target design, and session rules.

Condition B normally uses the latest active version. An advanced control may select one of the five most recent valid immutable versions. Experiment Lock stores the complete selected text, version, hash, and whether selection was `latest` or `manual_recent`. Manual selection is disclosed in exports to prevent hidden cherry-picking.

Notes cannot update during the locked experiment, and no catch-up update runs afterward. The AI Judge receives an anonymous allowlisted evidence packet and does not learn which condition was used. Scores are frozen before unblinding.

The standard `3 + 3 + 2 + 2` rubric remains unchanged:

- Gestalt: 0–3;
- verifiable features: 0–3;
- activity, function, or event: 0–2;
- confabulation control: 0–2.

## Integrity and failure handling

The implementation includes safeguards informed by open-source agent-memory systems:

- full-version updates instead of fragile text patches;
- immutable snapshots and hashes for sessions and Research;
- optimistic concurrency so simultaneous sessions cannot overwrite newer notes;
- idempotent retry after provider timeout or restart;
- strict separation of provider reasoning from final content;
- no fallback to another model for a notes update;
- route and capability drift checks;
- no raw API keys, hidden reasoning, blind targets, or full notes in ordinary diagnostic logs;
- safe rendering, reserved-delimiter rejection, schema validation, capacity enforcement, and stale-base protection.

These safeguards validate provenance and structure. They are not editorial censorship: multi-sentence, unconventional, or operator-disagreed advice remains valid when it belongs to the same Viewer, fits the capacity, and does not identify the specific target.

## Possible future extensions

### Assisted Notes Reflection

Only after basic Viewer Notes demonstrate value, a future experiment may let the Viewer choose whether to update normally or request additional help from:

- the AI Field Perception Lexicon;
- summaries or diffs of its five most recent note versions;
- both sources;
- neither source.

The material would be supplied only after the Viewer requests it, recorded in the reflection snapshot, and tested separately. Full historical versions should be loaded only when explicitly requested to avoid wasting context.

### Monitor and Judge areas

Monitor Notes would require a separate identity, history, timing rule, and controlled experiment. Viewer and Monitor notes must never be merged. A future AI Judge area may present calibration and scoring history, but mutable Judge Notes are not planned because they could undermine rubric stability.

## Credits and provenance

- **Project direction:** Edward
- **Engineering design and documentation:** Orion via Active Model — GPT-5.6-Sol, OpenAI, ChatGPT web interface

This design was implemented in AI RV Harness v0.7.12. It remains experimental and should continue to be evaluated through automated checks and practical sessions before its effect on RV performance is treated as established.
