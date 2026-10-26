import { useCallback, useEffect, useRef, useState } from "react";
import { inspectViewerIdentities, preferredViewerIdentityId, type ViewerIdentityListing } from "../aiCenter/viewerIdentitySelection";
import type { ViewerRouteFailureCode } from "../aiCenter/viewerIdentityRoute";
import { subscribeProviderRoutesChanged } from "../providers/changes";
import type { ProviderConfig, ProviderModel } from "../providers/types";
import type { AppRepository } from "../storage/repository";
import type { Profile, Workspace } from "../types";

export type ViewerRouteStatus = ViewerRouteFailureCode | "loading" | "load_failed" | "identity_missing" | "selection_required" | "ready";
interface RouteState { repository: AppRepository; key: string; configs: ProviderConfig[]; models: ProviderModel[]; listing: ViewerIdentityListing; selectedId: string; failed?: boolean }
export function useViewerRoutes(input: { repository: AppRepository | null; profile: Profile | null; workspace: Workspace; language: "pl" | "en" }) {
  const { repository, profile, workspace, language } = input;
  const [revision, setRevision] = useState(0);
  const retry = useCallback(() => setRevision(value => value + 1), []);
  const bindingKey = JSON.stringify([workspace.id, workspace.profileId, profile?.id, profile?.credentialId, profile?.defaultViewerModelId]);
  const key = JSON.stringify([bindingKey, profile?.updatedAt, language, revision]);
  const [state, setState] = useState<RouteState | null>(null);
  const selection = useRef({ bindingKey: "", id: "" });
  useEffect(() => {
    const unsubscribe = subscribeProviderRoutesChanged(retry);
    const visible = () => { if (document.visibilityState === "visible") retry(); };
    window.addEventListener("focus", retry);
    window.addEventListener("storage", retry);
    document.addEventListener("visibilitychange", visible);
    return () => { unsubscribe(); window.removeEventListener("focus", retry); window.removeEventListener("storage", retry); document.removeEventListener("visibilitychange", visible); };
  }, [retry]);
  useEffect(() => {
    let cancelled = false;
    if (!repository || !profile || workspace.profileId !== profile.id) return;
    void (async () => {
      const [configs, models] = await Promise.all([repository.listProviderConfigs(), repository.listProviderModels()]);
      const listing = await inspectViewerIdentities({ repository, profileId: profile.id, language, providerConfigs: configs, models });
      if (cancelled) return;
      const previous = selection.current;
      const selectedId = previous.bindingKey === bindingKey && listing.identities.some(item => item.identity.id === previous.id)
        ? previous.id : preferredViewerIdentityId(listing.identities, profile.defaultViewerModelId, profile.credentialId);
      selection.current = { bindingKey, id: selectedId };
      setState({ repository, key, configs, models, listing, selectedId });
    })().catch(() => {
      if (!cancelled) setState({ repository, key, configs: [], models: [], listing: { identities: [], issues: [] }, selectedId: "", failed: true });
    });
    return () => { cancelled = true; };
  }, [repository, key, bindingKey, profile?.id, profile?.credentialId, profile?.defaultViewerModelId, workspace.profileId, language]);
  const current = state?.key === key && state.repository === repository && workspace.profileId === profile?.id ? state : null;
  const setViewerIdentityId = (id: string) => {
    if (!current || (id && !current.listing.identities.some(item => item.identity.id === id))) return;
    selection.current = { bindingKey, id };
    setState({ ...current, selectedId: id });
  };
  let status: ViewerRouteStatus = "loading";
  if (!repository) status = "load_failed";
  else if (!profile) status = "selection_required";
  else if (workspace.profileId !== profile.id) status = "binding_mismatch";
  else if (current?.failed) status = "load_failed";
  else if (current) {
    if (current.selectedId) status = "ready";
    else {
      const configs = current.configs.filter(config => config.enabled && config.credentialId === profile.credentialId);
      const issues = current.listing.issues.filter(issue => configs.some(config => config.id === issue.providerConfigId));
      if (!configs.length) status = "configuration_missing";
      else if (issues.some(issue => issue.code === "fingerprint_unavailable")) status = "fingerprint_unavailable";
      else if (current.listing.identities.filter(item => item.providerConfig.credentialId === profile.credentialId && item.model.modelId === profile.defaultViewerModelId).length > 1) status = "ambiguous_route";
      else if (issues.some(issue => issue.code === "binding_mismatch")) status = "binding_mismatch";
      else if (issues.some(issue => issue.code === "model_missing")) status = "model_missing";
      else if (current.listing.identities.length) status = "selection_required";
      else if (!current.models.some(model => configs.some(config => config.id === model.providerConfigId) && model.modelId === profile.defaultViewerModelId)) status = "model_missing";
      else status = issues.find(issue => issue.code === "binding_mismatch")?.code ?? "identity_missing";
    }
  }
  return {
    providerConfigs: current?.configs ?? [], models: current?.models ?? [], viewerIdentities: current?.listing.identities ?? [],
    viewerIdentityId: current?.selectedId ?? "", setViewerIdentityId, viewerRouteReady: Boolean(current && !current.failed), status, retry,
  };
}
