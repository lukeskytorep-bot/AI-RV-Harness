import { it, expect } from "vitest";
import { createHash } from "node:crypto";
import { parseProviderFinalCandidate, MAX_FINAL_CANDIDATE_BYTES } from "./finalCandidate";
import { normalizeProviderCallError } from "./providerError";
const content = '{"notes":"Żółć 🌍 <think>literal</think>"}';
const candidate = {content,contentSha256:createHash("sha256").update(content).digest("hex"),byteLength:Buffer.byteLength(content),omittedForSize:false,envelopeRemoved:false,nativeValidation:"rejected"};
it.each(["object","json"])("T2 %s IPC error retains only bounded final candidate fields",shape=>{
 const value={code:"unknown",message:"native rejection",phase:"validating_response",finalCandidate:{...candidate,reasoning:"PRIVATE",apiKey:"SECRET"}};
 const details=normalizeProviderCallError(shape==="json"?JSON.stringify(value):value).details;
 expect(details.finalCandidate).toEqual(candidate);expect(JSON.stringify(details)).not.toMatch(/PRIVATE|SECRET/);
});
it("T2 rejects malformed and oversized IPC candidates, without truncating them",()=>{
 for(const input of [{...candidate,contentSha256:"bad"},{...candidate,byteLength:1},{...candidate,content:"x".repeat(MAX_FINAL_CANDIDATE_BYTES+1),byteLength:MAX_FINAL_CANDIDATE_BYTES+1},{...candidate,omittedForSize:true},{...candidate,nativeValidation:"invalid"}])expect(parseProviderFinalCandidate(input)).toBeUndefined();
 expect(parseProviderFinalCandidate({...candidate,content:null,byteLength:MAX_FINAL_CANDIDATE_BYTES+1,omittedForSize:true})).toMatchObject({content:null,omittedForSize:true});
});
