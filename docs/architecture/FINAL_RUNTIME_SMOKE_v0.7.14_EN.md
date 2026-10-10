# AI RV Harness v0.7.14 — Final Desktop Runtime and Release Smoke

**Status:** `STEP 6 — RELEASE GATE CANDIDATE`; automated CI must be green, and the desktop smoke below must be executed on the exact candidate before v0.7.14 is formally closed.  
**Public reference baseline:** v0.7.13.  
**Current data boundary:** SQLite schema **31**.  
**Rule:** runtime testing is performed on copies of data and test credentials. Do not use the only copy of a user's real database.

## Entry conditions

- the exact candidate commit has a green CI workflow: `verify:source`, `verify:ux-data`, `verify:architecture`, `verify:v0.7.14-release-gate`, typecheck, Vitest, Vite build, Rust tests, OpenRouter continuation bridge, and Clippy;
- all migrations `001–031` are registered in one continuous sequence, and earlier accepted migrations remain byte-identical;
- a copy of the current green database and a separate copy of an older green database are available for a controlled upgrade;
- backup/restore is performed only on a test copy;
- provider smoke uses credentials belonging to the user performing the test.

## Checklist

| # | Scenario | Minimal procedure | Required result |
| --- | --- | --- | --- |
| 1 | Start and restart on schema 31 | Start the application on the current schema-31 database, close it, and start it again. | No startup error; data is available; migrations do not run again. |
| 2 | Current-epoch upgrade | Start a copy of the last accepted database from before the v0.7.14 changes and allow the application to perform only the supported current-epoch upgrade to 31. | Data that existed before the upgrade remains available; `integrity_check=ok`; no FK violations. |
| 3 | Legacy compatibility epoch | Start a separate database outside the current epoch. | The database is not silently migrated; the application offers the existing preserve/start-fresh path. |
| 4 | Lazy routes and navigation | Open Research, Settings, AI Center, Conversations, Training, and RV Sessions, return Home, and reopen them. | No blank screen, dynamic-import error, or loss of active Profile/Workspace. |
| 5 | Profile/Workspace routing | Switch Profiles and separate Conversation/RV Workspaces, then restart. | Every screen uses the correct Profile, Workspace, identity, and route; no state inherited from the previous Profile. |
| 6 | Standard Conversation | Send several ordinary text turns and retry one response. | Behavior remains compatible with v0.7.13; continuation/fingerprint state is not mixed between routes. |
| 7 | Conversation attachment metadata | Send a message with a text Workspace Source and an image through a vision route; separately test a non-vision route and a retry after restart without reattaching image bytes. | History preserves names/types and real attempt status; it does not persist bytes/base64/path; retry of the same message appends an attempt, and after restart it does not pretend to resend missing bytes. |
| 8 | Telepathic Conversation preflight | Configure several AI Profiles and run preflight before Start. Change model/participant/round count and verify invalidation of the old result. | UI shows the current budget/cost estimate; Start requires a current PASS; the runtime executor remains the final guard for every request. |
| 9 | Telepathic Conversation, human sender | A human creates and freezes the target, confirms transmission, AIs record first/second look, then Reveal/reflections. | Target is frozen before blind work; receiver does not see the target or other participants' responses before Reveal; restart/Resume does not repeat completed expensive stages. |
| 10 | Telepathic Conversation, AI sender and rotation | Run a series with multiple Profiles and sender rotation. | Every AI uses its own Profile/Workspace/identity/route; each new round has fresh context; schedule matches configuration. |
| 11 | `NO_SUBMISSION` | In a controlled test, cause the receiver to fail both allowed attempts. | The round continues; Reveal uses the missing-response prompt and does not ask for comparison with a nonexistent blind response. |
| 12 | Human empty reflection | A human saves an empty reflection, then the application is closed and reopened. | `reflection: ""` remains a completed stage and is not requested again. |
| 13 | Telepathic lease/Resume | Stop a series at a checkpoint and Resume; if two test instances are available, test competition and lease loss. | One instance owns the lease; an expired lease cannot be renewed; a late checkpoint from the old owner is rejected. |
| 14 | Telepathic Training preflight | Select 2–6 distinct Profiles, a topic, and round count; run preflight. | Schedule, budget, and cost are visible; configuration change invalidates the result; Start does not proceed with blocking preflight. |
| 15 | Telepathic Training, 3 Profiles × 3+ rounds | Run sender rotation, interrupt after a checkpoint, and Resume. | Operator sees full progress; models see only their permitted data; Field Guide/Viewer Notes are frozen and read-only; Training does not update them. |
| 16 | Learning freeze after restart | After creating a series, change the active Field Guide/Viewer Notes and then Resume the series. | Resume still uses the exact frozen content/hash captured at series start. |
| 17 | Provider errors / `uncertain` | Trigger a controlled timeout/ambiguous dispatch in a telepathic flow. | Automatic retry does not duplicate cost; operator receives explicit recovery for `uncertain`. |
| 18 | Standard RV Session through Reveal | Run a test session through Reveal and reopen it after restart. | Evidence, frozen Reveal, and session state remain consistent. |
| 19 | Post-Reveal review recovery | Let Viewer review succeed and Monitor review fail, then Resume. | Only the first missing stage is repeated; Viewer and Reveal are not executed again. |
| 20 | Post-Reveal `length` and `uncertain` | Test `length` and, separately, an uncertain post-dispatch result. | `length` remains safely resumable; `uncertain` requires an explicit operator decision before retry. |
| 21 | Post-Reveal lease fencing | Two instances attempt to resume the same review; in a controlled case A loses the lease, B takes it over, and A finishes late. | Only the owner of the current lease version may persist response/continuation/checkpoint; late writes from A are atomically rejected. |
| 22 | Provider + credential routing | Test a valid route, then endpoint/model/credential mismatch. | Valid configuration works; mismatched binding is rejected without replaying another route's continuation. |
| 23 | OpenRouter/Google continuation persistence | Execute a turn/session, restart, and make the next turn with a compatible fingerprint; then change route. | Exact continuation state survives restart and is replayed only with compatible binding; debug/export does not expose secret payload. |
| 24 | Backup on schema 31 | Create a backup after producing Conversation metadata, telepathic series, and post-Reveal checkpoints. | Backup manifest and integrity are correct; database inside the backup passes integrity/FK checks. |
| 25 | Restore + safety backup | Change data after the backup, then Restore. | A safety backup is created first; restored metadata/telepathic/recovery state matches the backup; application starts after restore. |
| 26 | Controlled purge | On test data, perform archive → preview → permanent delete for a supported object. | Purge scope is correct; dependent continuation/metadata is not orphaned; no FK violations. |
| 27 | Standard Training / Viewer Learning regression | Run ordinary Training and inspect Viewer Learning. | Classic Training still updates learning under existing rules; telepathic Training does not persist learning changes. |
| 28 | Research/Judge regression | Run minimal Research/Judge with frozen controls. | Research does not update Field Guide/Viewer Notes; frozen score/blinding remains stable. |
| 29 | PL/EN | Run one Telepathic Conversation and one Training in Polish and English. | UI text and prompts match role/stage; no language mixing or hidden topic/target disclosure. |
| 30 | Final restart | Close the application after all operations and start it again. | No startup error; the latest valid data, archives, series, checkpoints, and history remain available. |

## Pass criteria

Step 6 may be marked `COMPLETED` only when:

1. the exact commit has all automated CI gates green;
2. migrations 001–031 and the current-epoch upgrade are accepted;
3. desktop smoke scenarios have `PASS` or an explicit `N/A` with a technical justification that does not bypass a product requirement;
4. backup/restore has been executed on a copy of real test data, not merely evaluated statically;
5. the result is recorded in a separate dated report identifying commit/source tree, platform, and application version.

Lack of interactive desktop runtime or provider credentials is not `PASS`. This document is the v0.7.14 candidate checklist and does not replace the historical public v0.7.13 release-verification record.
