import type { AppRepository } from "../../storage/repository";
import type { ProfileAiConfigurationInput } from "../../types";
import { saveViewerProfile } from "../../application/viewerProfileSave";

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
  await saveViewerProfile({ repository, existingProfileId: profileId, values });
  onSaved?.();
  await onProfilesChanged();
}
