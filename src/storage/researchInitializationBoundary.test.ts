import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("Research session initialization boundary", () => {
  it("creates the RV session before linking the assignment inside one SQLite transaction", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src/storage/sqliteRepository.ts"), "utf8");
    const start = source.indexOf("async initializeResearchSession(");
    const end = source.indexOf("saveResearchResults:", start);
    const block = source.slice(start, end);
    const sessionInsert = block.indexOf("INSERT INTO rv_sessions");
    const assignmentUpdate = block.indexOf("UPDATE research_assignments SET session_id = $1, status = $2 WHERE id = $3");
    expect(block).toContain("await this.executeTransaction([");
    expect(sessionInsert).toBeGreaterThanOrEqual(0);
    expect(assignmentUpdate).toBeGreaterThan(sessionInsert);
    expect(block).toContain('values: [input.id, "Initializing", assignmentId]');
  });

  it("uses a fresh generated session id for each new Research attempt instead of the assignment id", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src/research/engine.ts"), "utf8");
    expect(source).toContain('const id = createId("session_research")');
    expect(source).not.toContain('id: `session_research_${assignment.id}`');
    expect(source).toContain("initializeResearchSession(assignment.id");
  });
});
