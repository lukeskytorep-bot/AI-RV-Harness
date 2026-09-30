# AI Center and experimental Viewer Notes

> **Status:** Implemented in AI RV Harness v0.7.12  
> **Design baseline:** AI RV Harness v0.7.11  
> **Implementation release:** AI RV Harness v0.7.12

AI Center is a top-level area of AI RV Harness for AI roles, role-specific history, and experimental model memory. It belongs to the active Profile rather than one Workspace. The first implementation contains Overview, the existing AI Monitor, Viewer Notes, and AI Identities.

## Identity boundary

A Viewer Notes owner is one exact combination of Profile, pseudonymous credential identity, provider and normalized endpoint, model route, and Viewer role. Notes are available in every Workspace owned by that Profile, but are never transferred to another model, credential, provider route, Monitor, or Judge.

## Session behavior

Viewer Notes are enabled by default in supported RV and Training sessions and can be disabled with one switch. The application freezes an immutable notes snapshot before the session begins and inserts it as a separately delimited, read-only system data block. Notes are auxiliary procedural memory; they do not replace the Viewer System Prompt or protocol.

Ordinary, Manual, and Monitored RV Sessions may consume the current Viewer Notes snapshot as read-only context, but they never create a new notes version. New Viewer Notes versions are created only by completed Training targets. During Training, after the blind evidence has been sealed and the target revealed, the Viewer first reviews its own session. The same Viewer route may then return either a complete replacement note document (`UPDATE`) or `NO_CHANGE`. This reflection happens before an AI Monitor review. Monitor opinions, Judge results, and later operator discussion are excluded.

The application does not offer manual note editing. Earlier immutable versions may be restored only after a warning; that action is recorded as a human restoration rather than a model decision.

## Capacity and safety

Available capacities are 1024, 2048, 4096, and 8192 conservatively estimated tokens. Content is never silently truncated. A capacity may be reduced only when the current notes already fit. Updates are protected by version and content-hash checks, so a reflection based on an older version cannot overwrite a newer one.

Provider reasoning and final content remain separate. The notes parser consumes the final assistant output only. It validates the JSON decision, complete note content, capacity, reserved delimiters, identity, and base version. A single same-model repair may correct JSON formatting only; failures leave the previous active version unchanged.

## Research design

`Viewer Notes Impact` is a blinded Research template with two conditions: `No Notes` and one immutable `Frozen Notes` version selected from the five most recent versions. The snapshot is part of Experiment Lock and cannot change during the study. Note reflection is disabled during Research. AI Judges remain blind to the condition and use the existing frozen 3+3+2+2 evaluation procedure.

## Experimental status

Viewer Notes are intentionally marked Experimental. They are designed for controlled comparison, not assumed to improve performance. If evidence does not support the feature, users may keep Notes off and the project may revise or remove the mechanism in a later release.
