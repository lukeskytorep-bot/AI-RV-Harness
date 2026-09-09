import type { ProviderConfig, ProviderModel } from "../providers/types";
import type { Profile } from "../types";
import {
  modelRouteKeyFor,
  modelsForCredential,
  preferredModelOrder,
  type ModelRouteRole,
} from "../modelRoutes";

export interface ModelRouteSelectProps {
  value: string;
  onChange: (value: string) => void;
  providers: ProviderConfig[];
  models: ProviderModel[];
  role: ModelRouteRole;
  profile?: Profile | null;
  credentialId?: string;
  providerConfigId?: string;
  emptyLabel: string;
  disabled?: boolean;
  className?: string;
  allowEmpty?: boolean;
}

export function ModelRouteSelect({
  value,
  onChange,
  providers,
  models,
  role,
  profile,
  credentialId,
  providerConfigId,
  emptyLabel,
  disabled = false,
  className,
  allowEmpty = true,
}: ModelRouteSelectProps) {
  const scopedCredentialId = credentialId ?? profile?.credentialId;
  const scopedModels = preferredModelOrder(
    modelsForCredential(scopedCredentialId, providers, models)
      .filter((model) => !providerConfigId || model.providerConfigId === providerConfigId),
  );
  const validValue = scopedModels.some((model) => modelRouteKeyFor(model) === value) ? value : "";

  return <select
    className={className}
    data-model-route-role={role}
    value={validValue}
    onChange={(event) => onChange(event.target.value)}
    disabled={disabled}
  >
    {allowEmpty && <option value="">{emptyLabel}</option>}
    {scopedModels.map((model) => {
      const provider = providers.find((item) => item.id === model.providerConfigId);
      return <option key={modelRouteKeyFor(model)} value={modelRouteKeyFor(model)}>
        {model.favorite ? "★ " : model.recommended ? "✦ " : ""}{provider?.label ?? model.provider} · {model.displayName}
      </option>;
    })}
  </select>;
}
