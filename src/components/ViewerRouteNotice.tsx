import type { getCopy } from "../i18n";
import type { ViewerRouteStatus } from "./useViewerRoutes";

export function ViewerRouteNotice({ copy, status, onRetry, disabled = false }: {
  copy: ReturnType<typeof getCopy>; status: ViewerRouteStatus; onRetry: () => void; disabled?: boolean;
}) {
  if (status === "ready") return null;
  const messages: Record<Exclude<ViewerRouteStatus, "ready">, string> = {
    loading: copy.viewerRouteLoading, load_failed: copy.viewerRouteLoadFailed,
    configuration_missing: copy.configureProviderFirst, model_missing: copy.viewerRouteModel,
    fingerprint_unavailable: copy.viewerRouteFingerprint, binding_mismatch: copy.viewerRouteBinding,
    identity_missing: copy.viewerRouteIdentity, ambiguous_route: copy.viewerRouteAmbiguous,
    selection_required: copy.viewerRouteSelect,
  };
  const retryable = ["load_failed", "fingerprint_unavailable", "binding_mismatch", "identity_missing", "model_missing"].includes(status);
  return <span className="viewer-route-notice" role="status" aria-live="polite"><small>{messages[status]}</small>{retryable && <button type="button" className="secondary-button compact-response-button" onClick={onRetry} disabled={disabled}>{copy.viewerRouteRetry}</button>}</span>;
}
