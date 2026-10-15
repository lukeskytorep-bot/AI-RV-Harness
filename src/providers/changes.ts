/** Local notifications supplement screen remount and window focus refresh.
 * No credentials or fingerprints are carried in this event. */
const providerChanges = new EventTarget();
export function notifyProviderRoutesChanged(): void { providerChanges.dispatchEvent(new Event("changed")); }
export function subscribeProviderRoutesChanged(listener: () => void): () => void {
  providerChanges.addEventListener("changed", listener);
  return () => providerChanges.removeEventListener("changed", listener);
}
