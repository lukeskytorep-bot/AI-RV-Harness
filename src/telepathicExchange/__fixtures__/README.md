# Readable transcript regression evidence

Both JSON files were generated from the untouched UX-TEL-1 audit-fix baseline
(tree SHA256 751e5665c87b86d6fe9c3e2df9477dd9886af8c891e21438d262ae706e3fde90).
`readablePackets.v1.json` records 24 PL/EN packet/learning combinations and request fingerprints.
`readableEngine.v1.json` records the actual mock transport input, settings, budgets and durable call fingerprints from the old full engine in PL/EN with one guidance cycle.
Geographies, clock and input text are frozen synthetic test data. No credentials or real user material appear here.
Tests read immutable evidence; they do not regenerate it. `readableRuns.ts` contains test factories only and is not an application entry point.
