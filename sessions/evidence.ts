export async function verifySealedViewerEvidence(transcript: string, expectedHash: string): Promise<string> {
  const evidence = transcript.trim();
  if (!evidence) return "";
  const actualHash = await sha256Text(transcript);
  if (actualHash !== expectedHash.toLowerCase()) {
    throw new Error("Sealed pre-reveal evidence failed its SHA-256 integrity check.");
  }
  return transcript;
}

async function sha256Text(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}
