import { useEffect,useState } from "react";
import type { AppRepository } from "../storage/repository";
export function useWorkflowOwnership(repository:AppRepository|null|undefined,profileId:string|undefined) {
 const [state,setState]=useState<"idle"|"local"|"other"|"unknown">("unknown");
 useEffect(()=>{
  let closed=false;setState("unknown");
  const refresh=async()=>{const next=repository?.getWorkflowOwnership && profileId?await repository.getWorkflowOwnership(profileId).catch(()=>"unknown" as const):"unknown";if(!closed)setState(next);};
  void refresh();const timer=setInterval(()=>void refresh(),500);return()=>{closed=true;clearInterval(timer);};
 },[repository,profileId]);
 return {state,unavailable:state==="other"||state==="unknown"};
}
