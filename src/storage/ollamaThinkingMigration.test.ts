import {it,expect} from "vitest";
import {DatabaseSync} from "node:sqlite";
import {readFileSync} from "node:fs";
it("037 preserves existing continuation bytes, owner FKs and indexes and admits Cloud after upgrade",()=>{
 const db=new DatabaseSync(":memory:");
 try{
  db.exec("PRAGMA foreign_keys=ON; CREATE TABLE chat_messages(id TEXT PRIMARY KEY); CREATE TABLE session_events(id TEXT PRIMARY KEY); INSERT INTO chat_messages VALUES('message'); INSERT INTO session_events VALUES('event');");
  db.exec(readFileSync("src-tauri/migrations/025_provider_continuation_state.sql","utf8"));
  for(const [table,owner] of [["chat_message_provider_state","message"],["session_event_provider_state","event"]])db.prepare(`INSERT INTO ${table} VALUES(?,?,?,?,?,?,?,?,?)`).run(owner,"historical",1,"openrouter","{}","historical-bytes","a".repeat(64),16,"t");
  const before=[...db.prepare("SELECT * FROM chat_message_provider_state").all(),...db.prepare("SELECT * FROM session_event_provider_state").all()];
  const migration=readFileSync("src-tauri/migrations/037_ollama_thinking_continuation.sql","utf8");
  db.exec("BEGIN");db.exec(migration);db.exec("ROLLBACK");
  expect(db.prepare("SELECT sql FROM sqlite_master WHERE name='chat_message_provider_state'").get()?.sql).not.toContain("ollama-cloud");
  db.exec("BEGIN");db.exec(migration);db.exec("COMMIT");
  expect([...db.prepare("SELECT * FROM chat_message_provider_state").all(),...db.prepare("SELECT * FROM session_event_provider_state").all()]).toEqual(before);
  db.prepare("UPDATE chat_message_provider_state SET transport=?").run("ollama-cloud");
  db.prepare("UPDATE session_event_provider_state SET transport=?").run("ollama-cloud");
  expect(()=>db.prepare("UPDATE chat_message_provider_state SET transport=?").run("unknown")).toThrow();
  expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  db.exec("DELETE FROM chat_messages; DELETE FROM session_events;");
  expect(db.prepare("SELECT * FROM chat_message_provider_state").all()).toEqual([]);expect(db.prepare("SELECT * FROM session_event_provider_state").all()).toEqual([]);
 }finally{db.close();}
});
