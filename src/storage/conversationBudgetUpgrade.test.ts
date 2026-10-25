import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { createDefaultSettings, applyStoredOutputSettings } from "../startupDefaults";
import { BrowserSettingsModelsRepository } from "./browser/settingsModelsRepository";
import { SqliteSettingsModelsRepository } from "./sqlite/settingsModelsRepository";
import type { SettingsModelsRepository } from "./contracts/settingsModelsRepository";

class MemoryStorage implements Storage {
 private values=new Map<string,string>();
 get length(){return this.values.size;}
 clear(){this.values.clear();}
 getItem(key:string){return this.values.get(key)??null;}
 key(index:number){return [...this.values.keys()][index]??null;}
 removeItem(key:string){this.values.delete(key);}
 setItem(key:string,value:string){this.values.set(key,value);}
}
function sqlite(db:DatabaseSync){
 return new SqliteSettingsModelsRepository({
  select:async<T>(query:string,values:unknown[]=[])=>db.prepare(query.replace(/\$\d+/g,"?")).all(...values as never[]) as T,
  executeWrite:async()=>({rowsAffected:0}),
  executeTransaction:async statements=>{
   db.exec("BEGIN");
   try{const counts=statements.map(s=>Number(db.prepare(s.query.replace(/\$\d+/g,"?")).run(...s.values as never[]).changes));db.exec("COMMIT");return counts;}
   catch(error){db.exec("ROLLBACK");throw error;}
  },
 });
}
for(const adapter of ["Browser","SQLite"] as const) it(`${adapter}: persists the 16K floors across restart`,async()=>{
 const db=adapter==="SQLite"?new DatabaseSync(":memory:"):null;
 db?.exec("CREATE TABLE app_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at TEXT NOT NULL)");
 const storage=new MemoryStorage();
 const reopen=():SettingsModelsRepository=>db?sqlite(db):new BrowserSettingsModelsRepository({storage,clearProfileReferences:()=>{}});
 try {
  const before={...createDefaultSettings(),conversationMaxOutputTokens:8192,rvSessionMaxOutputTokens:8192};delete before.conversationOutputBudgetVersion;
  await reopen().saveSettings(before);
  const old=await reopen().loadSettings();expect(old.conversationOutputBudgetVersion).toBeUndefined();
  const upgraded=applyStoredOutputSettings({...createDefaultSettings(),...old},old);
  await reopen().saveSettings(upgraded);
  const restored=await reopen().loadSettings();expect(restored).toMatchObject({conversationMaxOutputTokens:16384,conversationOutputBudgetVersion:1,rvSessionMaxOutputTokens:16384,defaultMaxOutputTokens:8192});
  await reopen().saveSettings({...upgraded,conversationMaxOutputTokens:32768,rvSessionMaxOutputTokens:32768});
  const chosen=await reopen().loadSettings();
  expect(applyStoredOutputSettings({...createDefaultSettings(),...chosen},chosen)).toMatchObject({conversationMaxOutputTokens:32768,rvSessionMaxOutputTokens:32768,conversationOutputBudgetVersion:1});
 } finally {db?.close();}
});
it("SQLite upgrade writes value and marker atomically; failure permits a later retry",async()=>{
 const db=new DatabaseSync(":memory:");db.exec("CREATE TABLE app_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at TEXT NOT NULL)");
 try{
  const repo=sqlite(db),before={...createDefaultSettings(),conversationMaxOutputTokens:8192,rvSessionMaxOutputTokens:8192};delete before.conversationOutputBudgetVersion;
  await repo.saveSettings(before);
  db.exec("CREATE TRIGGER fail_upgrade BEFORE INSERT ON app_settings WHEN NEW.key='conversationOutputBudgetVersion' BEGIN SELECT RAISE(ABORT,'fault'); END");
  const old=await repo.loadSettings(),upgrade=applyStoredOutputSettings({...createDefaultSettings(),...old},old);
  await expect(repo.saveSettings(upgrade)).rejects.toThrow("fault");
  expect(await sqlite(db).loadSettings()).toMatchObject({conversationMaxOutputTokens:8192});
  expect((await sqlite(db).loadSettings()).conversationOutputBudgetVersion).toBeUndefined();
  db.exec("DROP TRIGGER fail_upgrade");await repo.saveSettings(upgrade);
  expect(await sqlite(db).loadSettings()).toMatchObject({conversationMaxOutputTokens:16384,rvSessionMaxOutputTokens:16384,conversationOutputBudgetVersion:1});
 } finally{db.close();}
});
