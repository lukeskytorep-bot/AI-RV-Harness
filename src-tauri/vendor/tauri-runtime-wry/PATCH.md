# AI RV Harness owner-thread repair candidate

This is the published **tauri-runtime-wry 2.11.4** crate (upstream Git
`ca90b46b2e2cbbc981dae1b809f4af4343fe0558`), with an application-local repair.
The registry archive checksum is
`4e6fac707727b7a2f48e4ded90976324267371073edbb415ffb73bb0458d203f`.
Original Apache/MIT licenses and unchanged source files are retained. Registry
VCS metadata and the crate's standalone Cargo.lock are omitted; the application
Cargo.lock is authoritative. PATCH.json records original and patched hashes.

## Design and upstream comparison

Reviewed upstream PR https://github.com/tauri-apps/tauri/pull/15411 at head
`5622af3af43288636aa1e19b69f3d2eed9d527e7` on 2026-10-16. It was open and
unmerged. This is **not** a claim that upstream has released or accepted this
candidate, nor an unmodified backport of that PR.

The PR stores a strong Arc in Wry and a raw Weak in dispatcher context. Its
send_user_message upgrades that Weak before testing the calling thread. A
worker can therefore temporarily hold a strong reference; if the runtime drops
its owner concurrently, final target destruction can still occur on that worker.
Its public Weak also permits unguarded upgrades. Copying that implementation
verbatim would not establish owner-thread destruction. The pinned published
crate also directly accesses the target for handle monitor queries, unlike the
newer source on which the PR was based.

Our MainThreadTargetOwner is !Send and !Sync and is owned only by Wry. Dispatcher
contexts hold MainThreadTarget tokens with private Weak pointers. Clone/drop
only change atomic allocation counters. `with` tests ThreadId **before** upgrade;
only a temporary owner-thread reference is exposed through a callback. No raw
Weak or strong Arc escapes. Debug does not inspect the pointee. The owner and
all possible strong upgrades are confined to the same thread, so the target is
destroyed there even when worker handles outlive the runtime.

All Context clones, including window/webview dispatchers, asynchronous IPC
argument/resolver ownership and AppHandle/WryHandle clones, share this single
storage path. The patch does not merely wrap application-owned AppHandles.
Owner-side calls retain direct execution through the checked callback; worker
calls retain the Tao proxy queue. Display and monitor queries from handles now
use that queue too. Runtime methods use their own event_loop directly.

Raw display-handle borrowing retains the runtime-handle API lifetime limitation
noted by upstream: callers must not use the platform display after its runtime
has been destroyed. No claim is made that this repairs every unsafe invariant
in Tauri/Tao/Wry or all unrelated display/window-handle lifetime contracts.

## Verification and limits

`main_thread_target.rs` is std-only. Its three tests cover access/expiration,
800,000 worker clone/drop pairs, and owner teardown while worker tokens survive,
with a non-Send Rc-bearing value and exact destructor-thread recording. They
are also included in the application's Cargo tests so CI cannot omit them.
The Windows `runtime_owner_stress` example exercises actual WryHandle/Context
clones with runtime alive and during owner teardown, without a WebView/provider.

`npm run verify:runtime-ownership` checks the local dependency and all vendored
hashes; `-- --cargo` also checks actual Cargo resolution. Unit/source checks and
a clean compile are prerequisites, not proof that the user's Windows crash is
fixed. Run the diagnostic Windows workflow, keep matching encrypted PDBs and
provenance, and complete the IPC/Reveal/Stop/minimize/restore soak checklist.
