# Separate Research evaluation panels

25 October 2026. Application 0.7.14, SQLite schema 34.

This extends [Research Judge completion](RESEARCH_JUDGE_COMPLETION_EN.md). The
original judging run can still complete missing scores. The new operation instead
creates a fresh panel over preserved, completed, sealed sessions with Reveal.
It never runs the Viewer, changes the original panel or clears End.

## User flow

The Research project includes a Separate evaluation panels section when completed
sessions exist. Choose Same Judges for a full new evaluation with the original
selection, or Select Judges for a new selection of one to three configured routes.
Start a new evaluation panel explicitly creates and runs that panel. Choosing the
same route twice still creates two independent Judge slots. In a save-only study,
select routes explicitly because there is no original Judge selection.

A panel freezes its selected Judge routes, provider/credential identities, model
capabilities, analytical output policy, timeout, source list and source fingerprints.
The source list includes only saved completed assignments with sealed evidence,
snapshots and Reveal. An interrupted original experiment may therefore have fewer
preserved completed sessions than its original planned count. The panel displays
its actual source count. Unsupported Reveal image routes are rejected before
creating the panel.

Each panel has a stable ID, its own scores and its own journal. Complete missing
scores in this panel reuses that panel's saved responses and skips its frozen
scores. Explicit completion can grant a fresh bounded attempt after an exhausted
attempt, with a durable reference to the prior failure. Restart never grants an
allowance. A new full panel intentionally pays for a new evaluation of every
source, even if a different panel already evaluated it.

STOP and view closure stop further dispatch. A complete response already received
may still be frozen once, preserving the existing Judge contract. Remaining slots
wait for a later explicit completion. Invalid responses and exhausted classified
transport retry leave their own slots missing while independent slots continue.
Configuration, persistence, ownership, source-integrity and checkpoint failures
stop the panel immediately. A failed checkpoint does not trigger another write
from an outer catch handler. RAM receipts use a distinct stable owner per panel.

## End and native ownership

All operations use the original project's exclusive `research:<projectId>` lease,
with the dedicated `research_evaluation` entity. This entity can inspect preserved
sources after the original End. It cannot use the generic workflow write command
to change original sessions, assignments, scores or project state. The native
`evaluationSave` action only writes the evaluation record and checks the lease,
project/parent availability, project identity and expected revision in the same
transaction. The source End marker is never removed or modified.

Panel records use reserved keys
`rvh.research.evaluation.v1:<projectId>:<evaluationId>` in app_settings. The versioned
JSON storage needs no migration. Generic settings insert/delete cannot edit this
namespace. The native and TypeScript validators enforce immutable panel design,
append-only journals, immutable existing scores, unique Judge slots and complete
score coverage before Complete. Native records are compared as JSON values;
TypeScript comparisons are independent of object key ordering and omitted
undefined fields. A lost commit acknowledgement is inspected before proceeding.
Completed panels are immutable. New scoring requires a new panel.

Database snapshots include these records. Project/profile/workspace controlled
purge removes only the matching panel namespace alongside the original project's
reserved keys. Browser preview storage mirrors scoped locks and revision checks.

## Results and export

Panels display their own anonymous sessions, individual scores and narratives,
missing slots and per-session panel means after completion. Incomplete panels have
no final aggregate. Original Research condition statistics stay with the original
run. New panel results remain anonymous; the operation does not automatically
unblind the original experiment or manufacture a combined ranking.

Export this panel writes only that panel's anonymous scores and, when complete,
per-session aggregates under evaluation/. Every row identifies its evaluation ID.
The full frozen design, source IDs, credential references and response journal are
under private_master/evaluation_record.json. Keep that folder private. Existing
full Research exports also include the separate panel records in their private
master records. Results from different panels are never pooled or substituted for
one another.

## Validation and acceptance

Regression coverage includes same/new-Judge panels after End, 48-session panels,
duplicate routes and a missing first slot, restart/STOP, immutable original scores,
source and route changes, transient transport exhaustion, ambiguous checkpoint
commits, native JSON ordering, PL/EN mounted screens and separate partial/full
exports. File-backed SQLite tests use actual repository SQL and an explicit native
command test bridge. They do not execute Rust. Rust unit/integration tests cover
native revision/immutability validation, End isolation and stale ownership. Run
Cargo tests and Clippy in CI, and accept Windows/live providers separately.
