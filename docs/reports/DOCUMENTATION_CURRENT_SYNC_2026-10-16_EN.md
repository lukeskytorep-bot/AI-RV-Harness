# Documentation synchronization — 16 October 2026

## Source and scope

Reviewed `lukeskytorep-bot/AI-RV-Harness`, branch `ai-rv-2`, commit `9c92bdbb94d1125406e0094779102458cdeee87c` (`t5`). Its 1,227 tracked files reproduce the delivered T5 tree SHA-256 `04227fe6fba7afda07e5b747f944e1a71ace648a0ba7519197e2390f333ef58a` using sorted UTF-8 path + TAB + lowercase file SHA-256 + LF. Package/native application version is 0.7.13; migration registry is 001–031. v0.7.14 describes development scope, not a publication verified by this task.

The attached September Wiki archive was inspected as historical public-v0.7.13 documentation, not used as the current application source. The historical main ZIP was not substituted for the accepted T5 branch.

## Findings corrected

| Previous documentation | Current documented contract and evidence owner |
| --- | --- |
| Schema 27 described as current in the documentation index/Wiki | Schema 31 in current development, with schema-27 release records explicitly historical; `migrations.rs` |
| Manual RV grouped under 16K/32K | Manual RV 32K/48K; `chat/outputPolicy.ts` |
| Current analytical work described as 8K/16K or 16K/32K | Current Judge/post-Reveal/Training Review policy v2 is 32K/48K; frozen v1/legacy Research preserved; `providers/outputRecovery.ts` |
| Learning headroom C+16K/C+32K or implicit non-Training fallback | Explicit training_reveal C+32K/C+48K, capacity unchanged; `operationResourceProfiles.ts` |
| Short fixed-lead stages described as always 4K | Current v3 stage table and older frozen v1/v2 scopes distinguished; `telepathicExchange/outputBudgets.ts` |
| Saved old Conversation 8K implicitly retained | One-time upgrade of unversioned 8,000/8,192 to 16,384; later deliberate reduction preserved; `startupDefaults.ts` |
| Optional learning repair mechanisms described as independent budgets | Per-kind/session/packet durable two-dispatch limit across transport/recovery/repair/restart; `learningExecution.ts` |
| Failed proposal conflated with interruption or NO_CHANGE | Explicit failed_preserved versus model_no_change; real Stop/DB/ownership/hash/unknown dispatch remain interruptions |
| Resume described without finished-rejected/unknown physical-attempt distinction | Shared classifier/resolver, preserved earlier unknown outcomes, explicit essential-step authorization without resetting learning |
| Native classic ownership absent from current developer map | Rust heartbeat 10 s / TTL 45 s; exact-token fencing, request cancellation and window lifecycle; separate telepathic/review leases retained |
| Training context and exports described only through older history UX | Neutral breadcrumb, saved Profile/model, expandable separate memory causes, active interrupted first-Session/checkpoint export |
| Developer entry points scattered among dated reports | English Developer Guide, expanded English CONTRIBUTING, README and developer Wiki page; exact Node 24/root-level native/bridge check commands |

Runtime constants were read from the accepted source, not inferred from older plans. This documentation update does not change any budget or application setting.

## Documentation layout and language

README, CONTRIBUTING, documentation/architecture indexes and living current references now describe T5. English is the primary developer language. Existing PL workflow/retry/checklist counterparts remain available and have synchronized current boundaries. Historical Polish audit/release/checkpoint/requirements files retain their dates and are not the current developer build recipe.

`docs/development/README.md` is the primary English contributor guide. `docs/wiki/` contains 17 English mirror/navigation files, including an explicitly historical v0.7.13 record and a separate current development status page. The current Wiki export excludes the mirror-maintenance README and converts local page links to extensionless Wiki links; repository references point to the documented ai-rv-2 source. A separate English apply note identifies this publication boundary. No Wiki push or release publication was performed.

Living system/learning/retry/ownership/code-map documents were updated without rewriting immutable release manifests. The English runtime checklist now includes scenarios 42–50 for Training Continuity, native heartbeat, finished-versus-unknown recovery, saved identity and interrupted exports. Its PL companion references the same additional scenarios.

## Validation performed

- Relative Markdown paths and heading anchors in changed/current developer/Wiki documentation: PASS; final counts recorded in the delivery evidence.
- Source integrity and verifier self-tests: PASS.
- UX-DATA compatibility source gate: PASS, 31 migrations.
- Architecture gate/self-tests: PASS, 325 production TS/TSX files, zero exceptions.
- v0.7.14 release-gate structure: PASS.
- `git diff --check`: PASS.
- All pre-existing non-documentation files, runtime resources, package/lockfiles, workflows and historical release/checkpoint/requirements records remain byte-identical to the source commit; additions are Markdown documentation only.
- Overlay and Wiki ZIP entries/checksums verified before delivery.

This is documentation-only work. Frontend runtime tests/build, Cargo tests, Clippy, the native bridge, interactive Windows/Linux smoke and paid-model calls were not rerun. The accepted T5 implementation's 2,172 PASS /1 SKIP frontend record and accepted T4 native record belong to those earlier tasks; they are not newly executed results here. External HTTP links/current release listings were not re-fetched: GitHub Releases remains the source for actually available downloads.

## Review/application

Apply the repository overlay to the stated T5 base; merge later documentation edits rather than overwriting them blindly. The Wiki ZIP is for the separate GitHub Wiki and must not be unpacked over the application repository. Current developer pages and setup are English; historical audit evidence retains its original language and scope. Final desktop/provider acceptance remains a separate dated report on the exact candidate.
