import { expect, it, vi } from "vitest";
import { notifyProviderRoutesChanged, subscribeProviderRoutesChanged } from "./changes";
it("notifies mounted subscribers without payload and stops after unsubscribe", () => {
 const listener=vi.fn(); const unsubscribe=subscribeProviderRoutesChanged(listener);
 notifyProviderRoutesChanged();expect(listener).toHaveBeenCalledTimes(1);expect(listener.mock.calls[0]).toHaveLength(1);
 unsubscribe();notifyProviderRoutesChanged();expect(listener).toHaveBeenCalledTimes(1);
});
