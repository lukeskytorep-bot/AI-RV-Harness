import { DatabaseSync } from "node:sqlite";
import { mkdtempSync,rmSync,copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it,expect } from "vitest";
import { SqliteSessionsRepository } from "./sqlite/sessionsRepository";
import { renderResearchTargetCodeSteps,targetCodePolicy } from "../resources/rvLiteTargetCode";
import { getRvLite,renderRvLiteSteps } from "../resources/protocolRegistry";
import { sha256Text } from "../application/sha256";
import type { SessionSnapshot } from "../sessions/types";

it("SQLite close/reopen and database copy preserve B's frozen prompts/policy and legacy A unchanged",async()=>{
 const directory=mkdtempSync(join(tmpdir(),"rvh-target-code-"));let db:DatabaseSync|undefined;
 try{
  const path=join(directory,"source.sqlite");db=new DatabaseSync(path);
  db.exec("CREATE TABLE session_snapshots(id TEXT PRIMARY KEY,session_id TEXT UNIQUE,snapshot_json TEXT,snapshot_hash TEXT,created_at TEXT)");
  const repository=()=>new SqliteSessionsRepository({
   select:async<T>(sql:string,values:unknown[]=[])=>db!.prepare(sql.replace(/\$\d+/g,"?")).all(...values as never[]) as T,
   executeWrite:async(sql,values=[])=>({rowsAffected:Number(db!.prepare(sql.replace(/\$\d+/g,"?")).run(...values as never[]).changes)}),
   executeTransaction:async()=>{throw new Error("unexpected transaction");},isResearchScoresFrozen:async()=>false,
  });
  const policy=targetCodePolicy("without_code"),p=getRvLite("en","extended");
  const prompts=await Promise.all(renderResearchTargetCodeSteps(p,"Leo","RV-B-LOCAL",policy).map(async content=>({content,sha256:await sha256Text(content)})));
  const snapshot={schemaVersion:4,sessionCode:"RV-B-LOCAL",researchTargetCode:{policy,renderedPrompts:prompts},protocol:{contentSha256:p.contentSha256}} as SessionSnapshot;
  const legacy={schemaVersion:1,sessionCode:"RV-OLD",protocol:{contentSha256:p.contentSha256}} as SessionSnapshot;
  await repository().saveSessionSnapshot("b",snapshot,await sha256Text(JSON.stringify(snapshot)));
  await repository().saveSessionSnapshot("old",legacy,"legacy-immutable-hash");
  db.close();db=undefined;copyFileSync(path,join(directory,"restored.sqlite"));db=new DatabaseSync(join(directory,"restored.sqlite"));
  expect(await repository().getSessionSnapshot("b")).toEqual(snapshot);expect(await repository().getSessionSnapshot("old")).toEqual(legacy);
  expect((await repository().getSessionSnapshot("old"))?.researchTargetCode).toBeUndefined();
  expect(renderRvLiteSteps(p,"Leo","RV-OLD")[1]).toContain("RV-OLD");
  expect(db.prepare("SELECT snapshot_hash FROM session_snapshots WHERE session_id='old'").get()).toEqual({snapshot_hash:"legacy-immutable-hash"});
  expect(JSON.stringify((await repository().getSessionSnapshot("b"))?.researchTargetCode?.renderedPrompts)).not.toContain("RV-B-LOCAL");
 }finally{db?.close();rmSync(directory,{recursive:true,force:true});}
});
