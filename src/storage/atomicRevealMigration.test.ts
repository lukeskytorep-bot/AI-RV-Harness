import { describe, expect, it } from "vitest";
import migration from "../../src-tauri/migrations/010_atomic_reveal.sql?raw";

describe("atomic Reveal migration", () => {
  it("changes the session state in the same SQLite statement transaction as Reveal insertion", () => {
    expect(migration).toMatch(/AFTER INSERT ON reveals/i);
    expect(migration).toMatch(/SET state = 'Revealed'/i);
    expect(migration).toMatch(/requires a sealed pre-reveal session/i);
  });
});
