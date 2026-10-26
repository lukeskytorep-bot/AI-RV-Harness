# Windows runtime ownership repair candidate

This candidate implements the 16 October 2026 EXE crash diagnosis on the owner's
supplied green `ai-rv-2` source ZIP, GitHub archive commit
`0cdf2c8de4cd163f1374dba6a783de69a17ed021`. It does not replace that source with
main, a historical Wiki ZIP, or an earlier unaccepted overlay.

The reported EXE has a UD2 refcount-overflow trap, strongly consistent with
Tauri Context cloning Tao's internal non-atomic Rc. Without its matching dump
and PDB, that is a leading diagnosis, not a proven reconstruction of the user's
entire failure. The original RVA must not be used against the new executable.

## Pinned ownership change

The app uses a local `tauri-runtime-wry 2.11.4` source via `[patch.crates-io]`.
Tauri, Tao and Wry versions remain fixed. Cargo.lock changes only the runtime's
registry source/checksum to local resolution; all other package records and
dependency edges remain unchanged. The upstream archive is identified by its
original registry checksum and Git commit. Both upstream licenses are retained.
`src-tauri/vendor/tauri-runtime-wry/PATCH.md` explains the complete delta and
review of upstream PR #15411 at `5622af3af43288636aa1e19b69f3d2eed9d527e7`.
That PR was open/unmerged when reviewed; this is a separate local candidate.

A !Send/!Sync owner retains the strong event-loop target only in Wry. Shared
contexts contain private atomic Weak tokens. Clone/drop never clones Tao's Rc.
Access checks the owner thread **before** upgrade, exposes only a callback
reference, and cannot return a strong Arc. This also prevents the last strong
reference from moving target destruction to a worker during runtime shutdown.
Debug of the token never formats the target. Handle display/monitor queries go
through the event queue; direct runtime queries stay on the owning runtime.
The existing raw display-handle API still requires callers to keep the runtime
alive while using a borrowed platform display. This does not claim to repair
all unsafe invariants or all display/window lifetime contracts in upstream.

The generic ownership tests are included in the normal application Cargo tests.
The `runtime_owner_stress` example exercises actual WryHandle/Context clones on
Windows with live-owner and owner-dropped-before-join processes. It creates no
WebView, database, credentials or provider work. Linux builds type-check the
example but its main does not run the Windows scenario.

## IPC load reduction

`useWorkflowOwnership` shares one watcher per repository object/Profile, with
one request in flight. It refreshes every 2 seconds while visible and every
10 seconds while hidden, and on focus/visibility restoration when no read is already in flight.
Unmounting the last consumer cancels the watcher and ignores pending results.
Missing repository/Profile and failed inspection remain unavailable/unknown.
Availability is a UI hint; it may lag an external ownership change by the
refresh interval. Native transactional checks remain the authority for actions.

Only Acquire creates a frontend loss-notification Channel. The native command
accepts an optional JavaScriptChannelId, creates the actual Channel only for
Acquire, and requires that notification ID for acquisition. Inspect/check/
write/renew/release no longer allocate unused channels. The ownership token,
45-second TTL, 10-second native renewal, failure aborts, provider cancellation,
entity scopes, post-Reveal fences and every per-write/per-dispatch guard remain.
This is exposure/load reduction, not independent proof of memory-safety repair.

## Local automated checks

Use the ordinary Developer Guide full check set, plus:

```bash
npm run verify:runtime-ownership -- --cargo
python3 -B scripts/test-windows-crash-provenance.py
```

Source verification also checks the pinned runtime and all its file hashes,
with self-tests rejecting registry fallback, missing/changed guard and source
drift. The optional Cargo check confirms the path that Cargo actually resolves.
Python tests use synthetic PE/PDB records, checking GUID/age matching, actual
PE debug-directory lookup, non-contiguous PDB blocks and invalid/truncated data.
They do not constitute a real Windows binary acceptance.

## Isolated Windows build with private symbols

The new workflow **Windows Runtime Diagnostic Candidate** is manual only. It
builds the selected branch and never publishes/releases or installs anything.
It uses the custom Cargo `diagnostic` profile (release optimization, full debug
information, no stripping), explicitly enabling `tauri/custom-protocol` to embed
`dist`. The Cargo profile alone does not enable this feature; without it Tauri
uses `devUrl` and requires Vite on port 1420. Normal release profile/bundling is
unchanged. After `npm ci` and `npm run build`, the exact application build is:

```bash
cargo build --manifest-path src-tauri/Cargo.toml --profile diagnostic --locked --bin ai-rv-harness --features tauri/custom-protocol
```

The native stress example has no WebView and cannot verify embedded assets.

1. Add `DIAGNOSTIC_SYMBOLS_PASSWORD` as a repository Actions secret, retained
   privately by the owner. Do not put the password in a commit, issue or chat.
   The workflow requires it because symbols must remain private even if the
   repository and workflow artifacts are public.
2. Run the workflow on the branch containing this overlay. It runs the full
   frontend/native gates, bridge, Clippy, exact dependency check and provenance
   tests before building `target/diagnostic/ai-rv-harness.exe`.
3. It runs three fresh Windows processes for each native stress mode. A crash
   or nonzero exit fails the job; a Linux no-op cannot satisfy this workflow.
4. `collect-windows-crash-build.py` compares EXE CodeView RSDS GUID/age with the
   PDB Info stream, rejects mismatches, and records EXE/PDB SHA256, source commit
   and tree, Cargo/package-lock hashes, patch-manifest hash and toolchain.
   Provenance also records the exact application build command and argv,
   `cargoProfile: diagnostic`, and `cargoFeatures: ["tauri/custom-protocol"]`.
   The collector requires `--build-command` with the exact command above and
   rejects a dev-mode recipe. Regression tests tie this recipe to both workflow
   invocations. This records the workflow declaration, not proof of a UI run.
5. The artifact contains the candidate EXE, provenance, exact Cargo.lock,
   runtime patch manifest, stress log and AES-encrypted `symbols.7z`. Plaintext
   PDBs are never selected for upload. The archive is password-tested before
   upload. Download and retain it before the 30-day artifact expiry.

No Windows executable or successful Windows run is implied by delivering this
source overlay. The diagnostic workflow must run on Windows; downloading an
artifact is not equivalent to completing the following runtime acceptance.

## Standalone Windows launch acceptance (before the soak)

Download the exact Actions EXE and its provenance; retain the matching encrypted
PDB. Use a Windows environment without Node/Vite running. Confirm that no server
is listening on port 1420 (`Get-NetTCPConnection -LocalPort 1420 -State Listen
-ErrorAction SilentlyContinue` must return no listener). Do not start `npm run dev`
or a frontend server. Launch the downloaded EXE directly and record its SHA256.
Verify the complete UI loads and a real native IPC operation succeeds, for
example listing locally stored Profiles and reopening one. Check the listener
again while the app runs and retain the result, Windows/WebView2 versions and
observations. A blank window or a dependency on localhost fails acceptance.

Only after this passes, run the following scenarios on that same EXE. Any rebuild
requires fresh provenance, its matching PDB, and a new standalone launch check.
Native handle stress alone cannot satisfy this gate.

## Windows IPC / Reveal / Stop / window lifecycle soak

Record exact candidate commit, EXE SHA256, Windows and WebView2 versions,
start/end times, test duration and observations. Keep a backup of test data.
Use a separate Windows test account or test copy, and close the installed app
before running the diagnostic executable. Do not treat simultaneous owners as
an application crash reproduction.

- Run at least the original failing workflow through target Reveal and return
  to the next stage. Test long generation and repeated operations. A local
  OpenAI-compatible fixture endpoint can supply controlled responses; no paid
  provider calls are required. Retain the fixture identity if used.
- Minimize and restore repeatedly during generation, Reveal and idle periods.
  Include at least 100 minimize/restore cycles and a longer soak exceeding the
  previous observed failure window; record the actual completed duration.
- Exercise Stop during generation and during Reveal, then permitted Resume.
  Verify accepted work is replayed and no new model request starts after Stop.
- Verify heartbeat survival with a minimized/throttled WebView, ownership loss
  aborts and refusal of later writes. Confirm UI actions become read-only for
  another owner; the slower UI polling must not bypass native enforcement.
- Observe ownership IPC counts with the same Profile rendered in multiple
  consumers. Expected: one outstanding inspection per watcher, shared polling,
  slower hidden inspections and a loss channel only when acquiring ownership.
- Close/reopen normally and check saved evidence. A pass only establishes that
  these scenarios passed on this build/platform, not universal race freedom.

`scripts/windows-runtime-soak.ps1` automates window cycles for an already running
candidate. Supply its process ID and the EXE SHA256 from provenance; it refuses
a different binary. Run the actual test workflow in the app during those cycles.
It records UTC timestamps and early process/window loss in a local CSV and does
not start model work, configure providers or declare the whole soak accepted.
For example (replace both values):

```powershell
.\scripts\windows-runtime-soak.ps1 -ProcessId 1234 -ExpectedSha256 'EXACT_64_HEX_SHA256' -Cycles 100 -DwellMilliseconds 1000
```

If a crash recurs, collect a dump with Windows Error Reporting LocalDumps or
Sysinternals ProcDump and retain the matching EXE, encrypted PDB, provenance,
exact exception code/new RVA and timestamp. Symbolize using that same PDB.
Full dumps can include private targets, conversations and credentials; keep
raw dumps/symbols private and share sanitized stacks/disassembly for review.
Do not remove UD2 or refcount checks, replace CPU hardware, loosen JSON
validation or increase model token/attempt budgets as a workaround.

The separate confirmed post-Reveal nested-repository/review-lease inconsistency
is not changed here and is not claimed to be the cause of the native UD2 trap.

## User follow-up and future dependency upgrades — 17 October 2026

Edward reported that repaired Training completed in approximately 20 minutes and felt faster or comparable to earlier working builds. Training Stop did not close the app. Earlier coincidence between Stop/window interaction and a native crash is not proof of a Stop exit-handler defect. The exact new EXE hash and a complete soak record were not supplied with this feedback; it is a successful user scenario, not universal race-freedom certification.

Preserve the owner-thread target repair and reduced IPC. Increased IPC plausibly increased exposure and overhead, but CPU saturation and an isolated speedup percentage were not measured. Do not remove the local patch merely because a newer dependency exists. Verify an officially released fix covers the same ownership/teardown paths, review the resolved dependency source, update patch gates/lockfile, retain equivalent tests and repeat standalone Windows Training/Reveal/Stop/minimize acceptance before replacing it. Record a successful replacement and its version in [Engineering Decisions 25–26](../architecture/ENGINEERING_DESIGN_AND_INTEGRITY_SAFEGUARDS.md#decision-25--windows-runtime-ownership-and-bounded-ipc-observation).
