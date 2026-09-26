# Training, target pack, and typed Workspaces

> **Status:** implemented in the private v0.7.13 baseline  
> **Schema:** 026  
> **Scope:** Training stages 1–3 and navigation/Workspace stages 4–5

This page is the living description of the current Training and Workspace model. Historical requirements and candidate reports may describe the earlier 84-target curriculum, seven-session blocks, or one shared Workspace selection; those documents remain historical evidence and do not define current runtime behavior.

## Training terminology

- **Training Run** is one durable saved execution created by the user.
- **Round** is one eight-session Full Training unit containing one target from each factory category.
- **Full Training** contains from one to ten rounds, therefore 8–80 sessions.
- **Partial Training** uses explicit category counts and may include My Targets. My Targets never enter Full Training automatically.

The planner selects targets and randomizes the order of the eight sessions when the Training Run is created. The flattened target order, planner version, `roundSize = 8`, and round count are saved before the first session. Resume consumes that frozen plan and never randomizes it again.

Historical Training Runs keep their stored curriculum/planner version. Runs created with the earlier 84-target curriculum and seven-session block boundaries remain readable and resumable; they are not reinterpreted as eight-session rounds.

## Factory target pack

The active factory pack contains **94 read-only targets in eight categories**:

1. Mountains;
2. Structures;
3. Structures in mountain terrain;
4. Water and combined elements;
5. Human activity;
6. Disasters and destruction;
7. Space;
8. Mixed targets.

The 84 previously active target identifiers remain stable. The split between Mountains and Structures is represented by controlled metadata, and the ten additional targets use the new stable `factory_training_08_01`–`factory_training_08_10` identifiers. Polish and English Reveal resources remain paired with the same canonical target identity.

With `avoid_profile`, target usage is filtered for the selected Profile and the maximum number of Full Training rounds is constrained by the smallest remaining category pool. The application does not silently enable reuse when a category is exhausted. With `allow`, historical use no longer removes a target from the pool, while the planner still avoids duplicates inside the same Training Run while sufficient targets exist.

## Viewer learning order and budgets

After Reveal, a qualifying Training session uses the durable order:

1. Post-Reveal Review;
2. Field Guide Update;
3. Viewer Notes Reflection;
4. optional AI Judge.

Field Guide and Viewer Notes are separate versioned knowledge packages. Ordinary RV Sessions and Research may consume frozen versions but do not update them.

The user-selected document capacity is unchanged. Generation budgets are:

- first attempt: `capacity + 8192`;
- one final recovery attempt: `capacity + 16384`.

No third capacity attempt is allowed. A failed or oversized proposal does not replace the previously active version.

The Training screen contains the canonical Polish and English expandable explanation under **Jak działa AI Training? / How does AI Training work?**. It is application documentation, defaults to collapsed, and must remain synchronized with the runtime rules above.

## Top-level navigation

Conversations and RV Sessions are separate top-level destinations:

- **Conversations** contains ordinary model conversations only;
- **RV Sessions** contains the **Manual RV** and **Automatic RV** tabs;
- Manual RV keeps its existing conversation engine and data semantics but is presented under RV Sessions;
- old `workspace` navigation state is normalized to a supported destination rather than producing a dead screen.

Forum integration is not implemented by this separation.

## Typed Workspaces

Every Workspace has one canonical kind:

```text
conversation
rv
legacy_combined
```

- `conversation` is accepted by Conversations;
- `rv` is accepted by RV Sessions and by technical Training/Research resolution;
- `legacy_combined` is accepted by both surfaces so historical records remain accessible.

Migration 026 assigns existing rows `legacy_combined`; it does not move, duplicate, or infer ownership for historical Conversations or RV Sessions. A new Profile is created atomically with one Conversation Workspace and one RV Workspace. Additional Workspaces of either type may be created from Profiles.

The application stores separate active selections:

```text
activeConversationWorkspaceId
activeRvWorkspaceId
```

Changing one does not change the other. Profiles presents separate Conversation Workspaces and RV Workspaces sections with create, open, rename, and archive actions. Archive guards prevent removal of the last compatible active Workspace required by a Profile.

Training and Research do not expose a Workspace selector. When a technical Workspace is required, `resolveTechnicalWorkspaceForProfile` selects an active compatible `rv` or `legacy_combined` Workspace deterministically and never chooses a `conversation` Workspace.

## Compatibility and validation

The current SQLite registry is contiguous through migration 026. The accepted chain retains:

- exact-green v23 → v24 Viewer Learning compatibility;
- exact-green v24 → v25 provider-continuation persistence;
- exact-green v25 → v26 typed Workspace migration;
- fresh 001 → 026 validation;
- `integrity_check=ok` and `foreign_key_check=0`.

Public/legacy schemas outside the accepted v0.7.13 epoch remain governed by the database compatibility gate and are not silently promoted through an unverified migration chain.
