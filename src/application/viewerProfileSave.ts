import { prepareProfileViewerRoute, requireViewerRoute, viewerRouteErrorMessage } from "../aiCenter/viewerIdentityRoute";
import type { AppRepository } from "../storage/repository";
import type { CreateProfileInput, Profile } from "../types";
import { createProfileWithInitialWorkspaces, type CreatedProfileWorkspaces } from "./profileWorkspace";

/** Retain for the lifetime of a creation form, including failed attempts. */
export interface ViewerProfileSaveSession { created?: CreatedProfileWorkspaces }
export class ViewerProfileSaveError extends Error {
  constructor(public readonly profileId: string | undefined, public readonly failure: unknown, public readonly metadataOnly = false) {
    super(profileSaveErrorMessageFor(failure, Boolean(profileId), "en", metadataOnly));
    this.name = "ViewerProfileSaveError";
  }
}
function profileSaveErrorMessageFor(failure: unknown, partial: boolean, language: "en" | "pl", metadataOnly = false): string {
  if (metadataOnly) return language === "pl"
    ? "Nie udało się zapisać ustawień profilu. Spróbuj ponownie."
    : "Could not save Profile settings. Try again.";
  const detail = viewerRouteErrorMessage(failure, language) ?? (language === "pl"
    ? "Nie udało się zapisać pełnej konfiguracji Viewera. Spróbuj ponownie."
    : "Could not save the complete Viewer configuration. Try again.");
  if (!partial) return detail;
  return (language === "pl"
    ? "Profil został już zapisany częściowo. Ponów zapis w tym formularzu, aby dokończyć konfigurację tego samego profilu. "
    : "The Profile has already been partially saved. Retry in this form to finish configuring the same Profile. ") + detail;
}
export function profileSaveErrorMessage(error: unknown, language: "en" | "pl"): string {
  return error instanceof ViewerProfileSaveError
    ? profileSaveErrorMessageFor(error.failure, Boolean(error.profileId), language, error.metadataOnly)
    : viewerRouteErrorMessage(error, language) ?? (error instanceof Error ? error.message : String(error));
}
/** Preflight keychain before writes. Repository APIs span domains and do not
 * expose a shared transaction: retain the created Profile on write failure and
 * retry it, rather than silently succeeding or creating a second Profile.
 * No DB transaction is held across IPC. No old identity/learning is rewritten.
 */
export async function saveViewerProfile(input: {
  repository: AppRepository;
  values: CreateProfileInput;
  existingProfileId?: string;
  session?: ViewerProfileSaveSession;
}): Promise<{ profile: Profile; created?: CreatedProfileWorkspaces }> {
  const { repository, values } = input;
  const session = input.session ?? {};
  let profileId = input.existingProfileId ?? session.created?.profile.id;
  let writeStarted = Boolean(session.created);
  const metadataOnly = Boolean(input.existingProfileId && !session.created && !values.aiConfiguration);
  try {
    const ai = values.aiConfiguration;
    const existing = profileId ? (await repository.listProfiles()).find((item) => item.id === profileId) : undefined;
    // Metadata-only edits are independent of credentials and AI identity.
    // A partially created profile must still complete the original preflight.
    if (metadataOnly) {
      if (!existing) throw new Error("Profile is unavailable");
      await repository.updateProfile(existing.id, { name: values.name, humanName: values.humanName, note: values.note, ...(values.targetCodeMode === undefined ? {} : { targetCodeMode: values.targetCodeMode }) });
      const profile = (await repository.listProfiles()).find((item) => item.id === existing.id);
      if (!profile) throw new Error("Saved Profile is unavailable");
      return { profile };
    }
    const route = ai ?? existing;
    const prepared = requireViewerRoute(await prepareProfileViewerRoute({ repository, credentialId: route?.credentialId, modelId: route?.defaultViewerModelId }));
    let createdNow = false;
    if (!profileId) {
      session.created = await createProfileWithInitialWorkspaces(repository, values);
      profileId = session.created.profile.id;
      createdNow = true;
    }
    // ensureAiIdentity preserves the identity ID and its learning for the same
    // exact fingerprint/endpoint/model route; a changed key gets a new identity.
    writeStarted = true;
    await repository.ensureAiIdentity({ ...prepared, profileId });
    if (!createdNow) {
      await repository.updateProfile(profileId, { name: values.name, humanName: values.humanName, note: values.note, ...(values.targetCodeMode === undefined ? {} : { targetCodeMode: values.targetCodeMode }) });
      if (ai) await repository.setProfileAiConfiguration(profileId, ai);
    }
    const profile = (await repository.listProfiles()).find((item) => item.id === profileId);
    if (!profile) throw new Error("Saved Profile is unavailable");
    if (session.created) session.created.profile = profile;
    return { profile, ...(session.created ? { created: session.created } : {}) };
  } catch (failure) {
    throw new ViewerProfileSaveError(writeStarted ? profileId : undefined, failure, metadataOnly);
  }
}
