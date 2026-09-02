# ADR-0001: Adopt a modular monolith

**Status:** Accepted  
**Date:** 2 September 2026

## Context

AI RV Harness has grown into one Tauri application containing profiles, Workspaces, conversations, several RV protocols, Training, Research, AI Monitor, AI Judge, AI Center, Viewer Notes, exports and local persistence. Several large files now combine multiple reasons to change, especially `src/App.tsx` and the repository implementations.

The application also contains integrity-sensitive workflows. A structural change must not alter blinding, Reveal order, sealed evidence, Judge allowlists, Resume behavior or existing stored data.

## Decision

AI RV Harness will remain one repository, one Tauri desktop application and one release process, while code is gradually separated into modules with explicit responsibilities and public entry points.

The refactor will proceed in small, independently tested steps. UI features are extracted before critical session state machines and persistence internals. Existing facades remain compatible while their implementations are divided behind them.

## Alternatives considered

### Keep the current large files

Rejected as the long-term direction because unrelated changes increasingly require understanding large parts of the application and raise regression risk.

### Rewrite the application

Rejected because it would discard tested behavior and create unnecessary risk to stored data and evidence-integrity rules.

### Split into microservices or many packages

Rejected because the application is local-first and released as one desktop program. Network services and package boundaries would add operational complexity without a proportionate benefit.

## Consequences

Positive consequences:

- clearer ownership of product capabilities;
- smaller review scope;
- easier unit and contract testing;
- reduced risk that a change in one feature affects another;
- a clearer path for external contributors.

Costs and constraints:

- temporary compatibility facades and some transitional duplication may exist;
- documentation and architecture tests must be updated as modules move;
- every extraction requires before-and-after tests;
- line-count reduction alone is not proof of success.

## Protected invariants

This decision does not authorize changes to product behavior. Blinding, Reveal, sealed evidence, Viewer/Monitor/Judge separation, Training-only Viewer Notes updates, Resume checkpoints, storage compatibility and export semantics remain protected unless changed by a separate documented decision.
