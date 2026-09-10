import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const root = resolve(process.argv[2] ?? ".");
const failures = [];

function read(relativePath) {
  return readFileSync(join(root, relativePath), "utf8");
}

function filesBelow(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(path) : [path];
  });
}

function productionTypeScriptFiles() {
  return filesBelow(join(root, "src"))
    .filter((path) => /\.(?:ts|tsx)$/.test(path))
    .filter((path) => !/\.(?:test|spec)\.(?:ts|tsx)$/.test(path));
}

const migrationDir = join(root, "src-tauri", "migrations");
const migrationFiles = readdirSync(migrationDir)
  .filter((name) => /^\d{3}_.+\.sql$/.test(name))
  .sort();
const migrationNumbers = migrationFiles.map((name) => Number(name.slice(0, 3)));
const expectedNumbers = Array.from({ length: 23 }, (_, index) => index + 1);
if (JSON.stringify(migrationNumbers) !== JSON.stringify(expectedNumbers)) {
  failures.push(`SQLite migrations must be contiguous 001-023; found: ${migrationFiles.join(", ")}`);
}

const tauriLib = read("src-tauri/src/lib.rs");
const migrationRegistry = read("src-tauri/src/migrations.rs");
if (!tauriLib.includes("migrations::registered_migrations()")) failures.push("src-tauri/src/lib.rs must register migrations through the centralized registry");
for (const name of migrationFiles) {
  const version = Number(name.slice(0, 3));
  if (!migrationRegistry.includes(`version: ${version},`)) failures.push(`src-tauri/src/migrations.rs does not register migration ${version}`);
  if (!migrationRegistry.includes(`include_str!("../migrations/${name}")`)) failures.push(`src-tauri/src/migrations.rs does not include ${name}`);
}
if (!migrationRegistry.includes("MIGRATION_SPECS[MIGRATION_SPECS.len() - 1].version")) failures.push("current migration version must derive from the centralized migration registry");

const dialogProvider = resolve(root, "src", "components", "AppDialogProvider.tsx");
for (const path of productionTypeScriptFiles()) {
  if (resolve(path) === dialogProvider) continue;
  const source = readFileSync(path, "utf8");
  if (/(?:window|globalThis)\.(?:confirm|prompt|alert)\s*\(/.test(source)) {
    failures.push(`browser-native dialog call outside AppDialogProvider: ${relative(root, path)}`);
  }
}

for (const path of productionTypeScriptFiles()) {
  const source = readFileSync(path, "utf8");
  if (/\b(?:list|create|rename|archive|restore)ChatThreadGroups?\b/.test(source)) {
    failures.push(`legacy ThreadGroup lifecycle API returned to production code: ${relative(root, path)}`);
  }
  if (/\bChatThreadGroup\b/.test(source)) {
    failures.push(`legacy ChatThreadGroup product type returned to production code: ${relative(root, path)}`);
  }
}

const sqliteConversations = read("src/storage/sqlite/workspacesConversationsRepository.ts");
if (!sqliteConversations.includes("thread_group_id")) failures.push("SQLite Conversation adapter must retain legacy thread_group_id read compatibility");
if (!sqliteConversations.includes("VALUES ($1, $2, $3, NULL")) failures.push("new SQLite Conversations must continue to write NULL legacy group references");
if (/(?:FROM|INSERT INTO|UPDATE|DELETE FROM)\s+chat_thread_groups/i.test(sqliteConversations)) failures.push("active SQLite Conversation adapter must not use legacy chat_thread_groups lifecycle");

const modelRoutes = read("src/modelRoutes.ts");
if (!modelRoutes.includes("modelRouteKeyFor") || !modelRoutes.includes("findCredentialScopedModelByRouteKey")) {
  failures.push("canonical modelRoutes helper is missing required route/scoping operations");
}
for (const relativePath of [
  "src/App.tsx",
  "src/features/profiles/ProfileDialogs.tsx",
  "src/features/rvSessions/RvSessionPanel.tsx",
  "src/features/training/TrainingScreen.tsx",
  "src/features/judge/JudgeEvaluation.tsx",
  "src/features/research/ResearchBuilder.tsx",
]) {
  if (!read(relativePath).includes("ModelRouteSelect")) failures.push(`${relativePath} must keep using the shared ModelRouteSelect`);
}

const repositoryContract = read("src/storage/repository.ts");
for (const method of [
  "listArchivedProfiles", "restoreProfile",
  "listArchivedWorkspaces", "restoreWorkspace",
  "listArchivedChatThreads", "restoreChatThread",
  "listArchivedRvSessions", "restoreRvSession",
  "listArchivedTrainingRuns", "restoreTrainingRun",
  "listArchivedResearchProjects", "restoreResearchProject",
  "listArchivedTargets", "restoreTarget",
  "previewPermanentDelete", "purgeProfile", "purgeWorkspace", "purgeChatThread", "purgeRvSession", "purgeTrainingRun", "purgeResearchProject", "purgeTarget",
]) {
  if (!repositoryContract.includes(`${method}(`)) failures.push(`AppRepository lifecycle contract missing ${method}()`);
}

const settingsScreen = read("src/features/settings/SettingsScreen.tsx");
for (const marker of ["Archive and recovery", "previewPermanentDelete", "Delete permanently", "requiredPhrase: preview.requiresPhrase"]) {
  if (!settingsScreen.includes(marker)) failures.push(`Archive and recovery UI missing marker: ${marker}`);
}

const migration022 = read("src-tauri/migrations/022_viewer_notes_source_preservation.sql");
for (const marker of ["source_snapshot_json", "ON DELETE SET NULL", "trainingRunId", "trainingRunNumber", "trainingRunName"]) {
  if (!migration022.includes(marker)) failures.push(`Viewer Notes source-preservation migration missing marker: ${marker}`);
}
const migration023 = read("src-tauri/migrations/023_controlled_purge.sql");
for (const marker of ["controlled_purge_context", "target_id_snapshot", "capture_rv_session_target_snapshot", "capture_research_assignment_target_snapshot"]) {
  if (!migration023.includes(marker)) failures.push(`controlled-purge migration missing marker: ${marker}`);
}

const nativeCompatibility = join(root, "src-tauri", "src", "ux_data_compatibility.rs");
if (!existsSync(nativeCompatibility)) failures.push("native UX-DATA compatibility test module is missing");
if (!tauriLib.includes("mod ux_data_compatibility;")) failures.push("native UX-DATA compatibility test module is not registered in lib.rs");

if (failures.length) {
  console.error(["UX-DATA compatibility verification failed:", ...failures.map((failure) => `- ${failure}`)].join("\n"));
  process.exit(1);
}

console.log(`UX-DATA compatibility verification passed: ${migrationFiles.length} migrations, flat Conversations, shared dialogs/model routes, unified lifecycle, Viewer Notes provenance and native legacy-upgrade gate are present.`);
