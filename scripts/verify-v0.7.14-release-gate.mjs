#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const exists = (rel) => fs.existsSync(path.join(root, rel));
const failures = [];
const requireFile = (rel) => {
  if (!exists(rel)) failures.push(`missing required file: ${rel}`);
};
const requireContains = (rel, marker, label = marker) => {
  requireFile(rel);
  if (exists(rel) && !read(rel).includes(marker)) failures.push(`${rel} missing release-gate marker: ${label}`);
};

const migrationsDir = path.join(root, "src-tauri/migrations");
const migrationNames = fs.readdirSync(migrationsDir)
  .filter((name) => /^\d{3}_.+\.sql$/.test(name))
  .sort();
if (migrationNames.length !== 31) failures.push(`expected 31 migrations, found ${migrationNames.length}`);
if (migrationNames[0] !== "001_initial.sql") failures.push(`unexpected first migration: ${migrationNames[0] ?? "<none>"}`);
if (migrationNames.at(-1) !== "031_post_reveal_review_lease.sql") failures.push(`unexpected last migration: ${migrationNames.at(-1) ?? "<none>"}`);
for (let index = 0; index < migrationNames.length; index += 1) {
  const expected = String(index + 1).padStart(3, "0");
  if (!migrationNames[index].startsWith(`${expected}_`)) failures.push(`migration registry is not contiguous at ${expected}: ${migrationNames[index]}`);
}
requireContains("src-tauri/src/migrations.rs", "assert_eq!(CURRENT_MIGRATION_VERSION, 31);", "CURRENT_MIGRATION_VERSION = 31 test");

// Step 3/4 telepathic exchange and training invariants.
requireContains("src/telepathicExchange/packets.ts", "buildMissingResponseRevealPrompt", "NO_SUBMISSION Reveal prompt");
requireContains("src/storage/sqlite/telepathicExchangeRepository.ts", "row.reflection_text !== null", "empty reflection survives SQLite round-trip");
const expiryGuard = "run_lease_expires_at IS NOT NULL AND run_lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')";
requireContains("src/storage/databaseWriteOperations.ts", expiryGuard, "telepathic lease expiry guard in TS registry");
requireContains("src-tauri/src/database.rs", expiryGuard, "telepathic lease expiry guard in Rust registry");
requireFile("src/telepathicExchange/trainingPreflight.ts");
requireFile("src/telepathicExchange/conversationPreflight.ts");
requireContains("src/features/training/TelepathicTrainingPanel.tsx", "preflightTelepathicTrainingConfig", "Training configuration preflight");
requireContains("src/features/conversations/TelepathicExchangePanel.tsx", "preflightTelepathicConversationConfig", "Conversation configuration preflight");

// Step 5 metadata and post-Reveal recovery invariants.
requireFile("src-tauri/migrations/030_chat_message_attachment_metadata.sql");
requireFile("src-tauri/migrations/031_post_reveal_review_lease.sql");
requireContains("src/storage/databaseNative.ts", "database_execute_post_reveal_review_fenced_write_batch", "post-Reveal fenced native write");
requireContains("src-tauri/src/database.rs", "database_execute_post_reveal_review_fenced_write_batch", "post-Reveal fenced Rust write");
requireContains("src/sessions/postRevealRecovery.ts", "requiresDecision", "uncertain post-Reveal operator decision");

// Step 6 release evidence must remain explicit and separate from the released v0.7.13 record.
requireFile("docs/architecture/FINAL_RUNTIME_SMOKE_v0.7.14_PL.md");
requireContains("docs/architecture/FINAL_RUNTIME_SMOKE_v0.7.14_PL.md", "schema 31", "schema 31 runtime smoke");
requireContains("docs/architecture/FINAL_RUNTIME_SMOKE_v0.7.14_PL.md", "Telepathic Conversation", "Telepathic Conversation runtime smoke");
requireContains("docs/architecture/FINAL_RUNTIME_SMOKE_v0.7.14_PL.md", "Telepathic Training", "Telepathic Training runtime smoke");
requireContains("docs/architecture/FINAL_RUNTIME_SMOKE_v0.7.14_PL.md", "Post-Reveal", "post-Reveal recovery runtime smoke");
requireFile("docs/reports/STEP6_V0714_FINAL_RELEASE_GATE_PL.md");

if (failures.length) {
  console.error("v0.7.14 release gate failed:\n" + failures.map((item) => `- ${item}`).join("\n"));
  process.exit(1);
}
console.log("v0.7.14 release-gate structure verification passed: schema 31, Steps 1-5 safety markers and Step 6 runtime evidence are present.");
