import type { TelepathicExchangeStore } from "./store";
export async function setTelepathicArchived(store: TelepathicExchangeStore, seriesId: string, archived: boolean) {
  return store.withTelepathicSeriesLease(seriesId,async()=>{
    const state=await store.getTelepathicSeries(seriesId);
    if(!state) throw new Error("Telepathic series not found.");
    if(state.status==="running") throw new Error("Stop the active series before archiving.");
    state.archivedAt=archived ? new Date().toISOString() : undefined;
    state.archiveRevision=(state.archiveRevision ?? 0)+1;
    state.updatedAt=new Date().toISOString();
    await store.saveTelepathicSeries(state);
    return state;
  });
}
