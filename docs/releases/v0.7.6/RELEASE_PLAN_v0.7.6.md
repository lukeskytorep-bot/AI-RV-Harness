# AI RV Harness — Release Plan v0.7.6

Status: IMPLEMENTED / verified in the frontend release path  
Recorded: 2026-08-19  
Baseline: v0.7.5

## Release objective

Improve portable data backup and restore, Training and Research run inspection/export, target-pool rules, Polish/English session-language consistency, small-window usability, transcript readability, and automatic-session resilience.

The current application logo remains visually unchanged in this release.

## Approved license notice

Use the following clear repository-level wording:

> Source code is licensed under the MIT License. Documentation, bundled prompts, training content, and other non-code visual assets are licensed under CC BY 4.0.

- Interpret visual assets included with the project as CC BY 4.0 unless a future asset is explicitly marked otherwise.

## 1. Portable backup and restore

- Replace the internal backup-list workflow with native system dialogs.
- `Create backup` opens a Save dialog with a suggested filename and a normal user-accessible default location such as Documents.
- The user can choose another folder and filename.
- Store the database, managed artifacts, manifest, versions, and integrity hashes in one portable backup package.
- Never export API keys or operating-system secure-store secrets.
- Remove the user-facing `Export data snapshot` action because it duplicates the understandable backup workflow.
- Remove internal backup IDs, paths, hashes, and technical journal information from the ordinary settings screen.
- `Restore backup` opens a native file picker for an external backup package.
- Make Restore a red destructive action.
- Before restore, warn that current application data will be replaced.
- Automatically create an internal pre-restore safety copy before replacing the database.
- Validate package structure, version, and integrity before modifying current data.

## 2. First-run defaults

- Default Target Repeat Policy for new settings: skip Training Targets previously used by the selected Profile.
- Default text scale for new settings: Large.
- Preserve explicit existing-user choices during migration.

## 3. Target catalog rules

- Factory Training Targets are a fixed, read-only collection of exactly 84 targets.
- Do not allow adding, editing, or deleting targets in the factory collection.
- `Add target` always creates a target in `My Targets`.
- `My Targets` accepts an unrestricted number of user targets.
- Full Training always uses the fixed 84 factory targets and never silently includes user targets.
- Partial Training offers clear source choices: Factory, My Targets, and both pools where appropriate.

## 3A. Automatic-session Reveal source — package 2

Replace the current ambiguous choices `Automatic Target` and `External Blind Target` with two user-facing choices whose meaning is explicit.

### Automatic target — My Targets

- Suggested Polish label: `Automatyczny cel — Moje cele`.
- Suggested English label: `Automatic Target — My Targets`.
- Automatic sessions may use only targets from the `My Targets` catalog.
- Do not offer the 84 factory Training Targets in ordinary automatic RV sessions; they remain dedicated to Training.
- After selecting this option, allow either:
  - random selection from available My Targets; or
  - manual selection of one specific target from My Targets.
- If My Targets is empty, disable session start and show a direct explanation:
  - Polish: `Nie możesz rozpocząć sesji z automatycznym celem, ponieważ katalog Moje cele jest pusty. Dodaj najpierw własny cel w sekcji Cele.`
  - English: `You cannot start an automatic-target session because My Targets is empty. Add a target in Targets first.`
- Where practical, include an action that takes the user directly to the My Targets area.

### Target supplied after the session

- Replace the unclear Polish label `Zewnętrzny ślepy cel` with `Cel podany po sesji`.
- Suggested English label: `Target supplied after the session`.
- Explain the workflow directly on the card or immediately below it:
  - Polish: `Wybierz tę opcję, jeśli chcesz przeprowadzić sesję bez zapisywania celu w katalogu. Po zakończeniu części ślepej podasz Target Reveal jako opis, obraz albo oba rodzaje danych. Reveal będzie potrzebny do review Viewera i opcjonalnej oceny AI Judge’a.`
  - English: `Choose this option to run the session without storing the target in the catalog. After the blind portion ends, provide the Target Reveal as text, an image, or both. The Reveal is required for the Viewer review and optional AI Judge evaluation.`
- After the blind transcript is sealed, open the Reveal-entry step and accept:
  - text only;
  - one or more images where supported;
  - text and images together.
- Do not present the Reveal to the Viewer, Monitor, or Judge before the blind boundary.
- Do not allow post-reveal review or Judge evaluation to be presented as complete until the required Reveal has been supplied.

## 4. Training AI history, inspection, and export

- Keep the Recent Training history but remove technical directory paths and open-folder controls from run cards.
- Add a clear `Save training` action using a native save/folder dialog and a user-selected name/location.
- Allow each training run to expand into its constituent sessions.
- Allow selection of a session and render the complete readable session below the run.
- Show the exact controller prompt sent to the Viewer, not only labels such as `RV Lite Prompt 1`.
- Show all Viewer responses, Monitor interventions, Target Reveal and media, Viewer post-reveal review, AI Judge results, and post-reveal discussion when present.
- Provide an in-app run summary and a separate exported summary.
- Whole-run export contains a summary HTML file, optional CSV table, individual readable session files, and required local assets.
- Partial Training category counts default to zero, not 5/2 presets.
- If no Workspace exists, keep Start disabled but show a tooltip/explanation and direct the user to create or select a Workspace.

## 5. Research history, random selection, inspection, and export

- When target selection mode is Random, remove the separate `Draw/Randomize targets` button.
- Select random targets automatically during Preflight / Experiment Lock.
- Freeze selected target IDs at lock time for reproducibility.
- Add Research run history equivalent to Training history.
- Allow runs to expand into sessions and display complete prompts, responses, Reveal, Viewer review, Judge output, and post-reveal material.
- Add native-location export for the whole Research run.
- Export individual session files plus a separate aggregate HTML/CSV summary.

## 6. Profile editor in non-maximized windows

- Make the modal fit the actual dynamic viewport height.
- Use a scrollable modal body and a sticky action footer.
- Keep Save and Cancel accessible above the operating-system taskbar.
- Add safe bottom padding and verify reduced-height Windows layouts.

## 7. Session-language consistency

- Keep separate Polish and English resources for Full RCP 1.5a, RV Lite, Viewer, and Monitor.
- Make the effective Session Language explicit before execution.
- Ensure Polish sessions receive the Polish Viewer prompt, Polish Monitor prompt, Polish RV Lite resource, and Polish Full RCP attachment.
- Ensure English sessions receive only the corresponding English resources.
- Prevent a previously stored profile prompt or session setting from silently overriding the visible language choice.
- Preserve the locked AI IS-BE / Shadow Zone Viewer identity block.
- Preserve the locked neutral activity definition.
- Preserve the accepted Monitor instruction: `Przejdź do głównej aktywności dowolnego rodzaju i opisz.` and its English equivalent.

## 8. Automatic RV transcript and post-reveal flow

- Replace generic prompt headings with meaningful titles and the exact prompt text actually sent.
- Apply the same presentation rules to RV Lite and Full RCP sessions.
- At session end show the Target Reveal and target materials, Viewer review, optional AI Judge evaluation, optional post-reveal discussion, Finish and Save, and Save/Export actions.
- If Judge evaluation exists before export, include it automatically in the export package.
- Never alter the sealed pre-reveal transcript with later post-reveal claims.

## 9. Safe repetition/loop guard

- Remove the current semantic line-count hard stop that falsely aborts legitimate repeated protocol fields.
- Do not stop a session because the same valid descriptor appears in several Touches, Vectors, phases, headings, table rows, or enumerations.
- Replace it with a conservative Smart Guillotine-style tail guard.
- Treat approximately 60 consecutive identical lines, approximately 600 repeated identical characters, a strongly tail-dominant repeated token block, or an extreme response-size ceiling as clear runaway evidence.
- On a clear runaway, truncate/compress only the corrupted repetitive tail, mark the event, and continue the protocol rather than aborting the full session.
- Keep the provider/request maximum output-token limit as the universal first safety boundary.
- Store a diagnostic record containing the rule, original length, retained length, pattern sample, and raw-output hash.
- Add regression tests reproducing the reported Polish five-Touch response containing repeated `Deskryptor zaawansowany: sztuczne – wykonane przez człowieka` lines.
- Add equivalent English/Polish valid-protocol fixtures and genuine runaway fixtures.

## 10. Release acceptance criteria

- Frontend tests, Rust tests, version-consistency tests, and Windows release build pass.
- A portable backup can be saved outside application data, the app can be removed/reinstalled, and the selected backup can restore the data.
- Factory target count remains exactly 84 and factory targets are read-only.
- Ordinary automatic RV sessions list only My Targets, never factory Training Targets.
- An empty My Targets catalog blocks automatic-target session start with a clear explanation and route to add a target.
- The post-session target option clearly explains when and how the Reveal must be supplied and accepts text, images, or both.
- Partial Training begins with all counts at zero.
- Training and Research exports are readable without the application and contain complete session evidence and summaries.
- Polish session resources remain entirely Polish unless the user explicitly changes the session language.
- The reported legitimate five-Touch response no longer causes AUTO-STOP.
- A synthetic obvious runaway is safely truncated and logged without destroying the entire session.
- Profile editing remains usable in a reduced-height Windows window.
- The repository contains the approved general MIT / CC BY 4.0 notice.

## Implementation result

All approved packages above are implemented in the v0.7.6 source. The TypeScript compiler, complete Vitest suite and production Vite build pass locally. Native Rust/Tauri compilation and the Windows installer remain the responsibility of the included GitHub Actions workflows because the packaging environment does not contain a Rust toolchain.
