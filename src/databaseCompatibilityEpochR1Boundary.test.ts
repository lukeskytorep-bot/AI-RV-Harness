import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import app from "./App.tsx?raw";
import storageIndex from "./storage/index.ts?raw";
import nativeStorage from "./storage/native.ts?raw";
import rustStorage from "../src-tauri/src/storage.rs?raw";
import nativeLibrary from "../src-tauri/src/lib.rs?raw";
import buildScript from "../src-tauri/build.rs?raw";
import acl from "../src-tauri/permissions/main-window.toml?raw";
import migration021 from "../src-tauri/migrations/021_soft_archive_lifecycle.sql?raw";
import migration022 from "../src-tauri/migrations/022_viewer_notes_source_preservation.sql?raw";
import migration023 from "../src-tauri/migrations/023_controlled_purge.sql?raw";
import migration024 from "../src-tauri/migrations/024_viewer_learning_field_guide.sql?raw";
import migrationRegistry from "../src-tauri/src/migrations.rs?raw";

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

describe("DATABASE-COMPATIBILITY-EPOCH-1-R1 boundaries", () => {
  it("keeps inspect and preparation ahead of SQL migration loading and blocks incomplete initialization", () => {
    const inspect = storageIndex.indexOf("inspectDatabaseCompatibility()");
    const prepare = storageIndex.indexOf("prepareDatabaseForLoad()");
    const load = storageIndex.indexOf("SqliteRepository.connect()");
    const validate = storageIndex.indexOf("validateLiveDatabase()");

    expect(inspect).toBeGreaterThan(-1);
    expect(prepare).toBeGreaterThan(inspect);
    expect(load).toBeGreaterThan(prepare);
    expect(validate).toBeGreaterThan(load);
    expect(storageIndex).toContain('compatibility.kind === "incomplete_current_initialization"');
    expect(storageIndex).toContain('prepared.kind === "incomplete_current_initialization"');
  });

  it("uses a native fresh-initialization marker only as provenance and never as a migration bypass", () => {
    expect(rustStorage).toContain('const INITIALIZATION_MARKER_FILE_NAME: &str = "rv_harness.initializing-v0.7.13.json"');
    expect(rustStorage).toContain("ensure_initialization_marker(&path)?;");
    expect(rustStorage).toContain("if database.exists()");
    expect(rustStorage).toContain("DatabaseCompatibilityKind::IncompleteCurrentInitialization");
    expect(rustStorage).toContain("marker.is_some() && migration_version < CURRENT_MIGRATION_VERSION");
    expect(rustStorage).toContain("validate_and_finalize_current_database(&path).await");
    expect(rustStorage).toContain("remove_initialization_marker(path)?;");
  });

  it("validates the full SQLx ledger checksum with SHA-384", () => {
    expect(rustStorage).toContain("SELECT version, description, success, checksum FROM _sqlx_migrations ORDER BY version ASC");
    expect(rustStorage).toContain("Sha384::digest(expected.sql.as_bytes())");
    expect(rustStorage).toContain("checksum != expected_checksum");
    expect(rustStorage).toContain("let checksum = Sha384::digest(migration.sql.as_bytes()).to_vec();");
  });

  it("enforces native confirmation before any start-fresh file move", () => {
    const command = rustStorage.indexOf("pub async fn start_fresh_database(");
    const confirm = rustStorage.indexOf("confirm_start_fresh(&app, &status, interface_language).await?", command);
    const recheck = rustStorage.indexOf("let confirmed_status = inspect_database_compatibility_path(&path).await;", confirm);
    const closePool = rustStorage.indexOf("close_loaded_database(&db_instances).await?", recheck);
    const preserve = rustStorage.indexOf("preserve_database(&path, unix_ms()?, flavor)?", closePool);

    expect(command).toBeGreaterThan(-1);
    expect(confirm).toBeGreaterThan(command);
    expect(recheck).toBeGreaterThan(confirm);
    expect(closePool).toBeGreaterThan(recheck);
    expect(preserve).toBeGreaterThan(closePool);
    expect(rustStorage).toContain("MessageDialogButtons::OkCancelCustom");
    expect(rustStorage).toContain(".blocking_show()");
    expect(app).not.toContain("dialogs.confirm(");
    expect(app).not.toContain("window.confirm(");
  });

  it("registers only the intended compatibility commands in ACL, build manifest and invoke handler", () => {
    for (const command of ["inspect_database_compatibility", "prepare_database_for_load", "start_fresh_database", "close_application"]) {
      expect(buildScript).toContain(`"${command}"`);
      expect(acl).toContain(`"${command}"`);
      expect(nativeLibrary).toContain(`storage::${command}`);
    }
    expect(nativeStorage).toContain('"start_fresh_database"');
  });

  it("keeps the required PL and EN legacy database copy exact and separates incomplete initialization", () => {
    expect(app).toContain("Wykryto dane z wcześniejszej wersji");
    expect(app).toContain("AI RV Harness v0.7.13 korzysta z nowego modelu danych. Automatyczna migracja danych z v0.7.12 i wcześniejszych wersji nie jest obsługiwana, ponieważ mogłaby doprowadzić do częściowej lub błędnej konwersji.");
    expect(app).toContain("Aby nadal korzystać z dotychczasowych danych, uruchom AI RV Harness v0.7.12.");
    expect(app).toContain("Aby rozpocząć pracę w v0.7.13, możesz utworzyć nową bazę danych. Dotychczasowa baza zostanie zachowana jako kopia i nie zostanie usunięta.");
    expect(app).toContain("Data from an earlier version was detected");
    expect(app).toContain("AI RV Harness v0.7.13 uses a new data model. Automatic migration from v0.7.12 and earlier versions is not supported because it could result in partial or incorrect conversion.");
    expect(app).toContain("To continue using your existing data, run AI RV Harness v0.7.12.");
    expect(app).toContain("To start using v0.7.13, you may create a new database. Your existing database will be preserved as a backup and will not be deleted.");

    expect(app).toContain("Wykryto niedokończone tworzenie bazy v0.7.13");
    expect(app).toContain("An incomplete v0.7.13 database initialization was detected");
    expect(app).toContain('status.kind === "incomplete_current_initialization"');
  });

  it("preserves migrations 021 through 023 byte-for-byte and registers Field Guide migration 024 in the current v0.7.13 epoch", () => {
    expect(sha256(migration021)).toBe("c441d1b0e71dc654de517f34285fc2d2909c1e8f60c0b43089fe3ca6ca3a8f73");
    expect(sha256(migration022)).toBe("7fcec7326bbd8083efa830155ada3552fabeabf99ac92dab1b972260854aa4d4");
    expect(sha256(migration023)).toBe("1a9d300daa180a4507c01497b52deaf84722bd710ed4617f84058932dc7838a4");
    expect(migrationRegistry).toContain("(1_i64..=24)");
    expect(migrationRegistry).toContain('include_str!("../migrations/024_viewer_learning_field_guide.sql")');
    expect(migration024).toContain("CREATE TABLE field_guide_versions");
  });
});
