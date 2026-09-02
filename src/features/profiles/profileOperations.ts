import type { AppRepository } from "../../storage/repository";
import type { ProfileAiConfigurationInput } from "../../types";

export async function archiveProfileAndRefresh(
  repository: AppRepository,
  profileId: string,
  onProfilesChanged: () => Promise<void>,
): Promise<void> {
  await repository.archiveProfile(profileId);
  await onProfilesChanged();
}

export async function saveProfileAndRefresh(
  repository: AppRepository,
  profileId: string,
  values: { name: string; humanName: string | undefined; note?: string; aiConfiguration?: ProfileAiConfigurationInput },
  onProfilesChanged: () => Promise<void>,
  onSaved?: () => void,
): Promise<void> {
  await repository.updateProfile(profileId, { name: values.name, humanName: values.humanName, note: values.note });
  if (values.aiConfiguration) await repository.setProfileAiConfiguration(profileId, values.aiConfiguration);
  onSaved?.();
  await onProfilesChanged();
}
