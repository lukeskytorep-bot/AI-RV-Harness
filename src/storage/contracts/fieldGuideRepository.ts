import type {
  CreateFieldGuideVersionInput,
  FieldGuideActivationEvent,
  FieldGuideBundle,
  FieldGuideCapacity,
  FieldGuideLegacyBaseline,
  FieldGuideVersion,
  ResolveLegacyFieldGuideBaselineInput,
} from "../../aiCenter/fieldGuideTypes";
import type { FieldGuideLanguage } from "../../aiCenter/fieldGuideTypes";

/** Persistence contract for immutable Viewer Field Guide versions. Viewer Notes are intentionally separate. */
export interface FieldGuideRepository {
  getFieldGuideBundle(aiIdentityId: string, language: FieldGuideLanguage): Promise<FieldGuideBundle | null>;
  listFieldGuideVersions(aiIdentityId: string, language: FieldGuideLanguage): Promise<FieldGuideVersion[]>;
  listFieldGuideActivationEvents(aiIdentityId: string, language: FieldGuideLanguage): Promise<FieldGuideActivationEvent[]>;
  listFieldGuideLegacyBaselines(profileId: string): Promise<FieldGuideLegacyBaseline[]>;
  createFieldGuideVersion(input: CreateFieldGuideVersionInput): Promise<FieldGuideVersion>;
  resolveLegacyFieldGuideBaseline(input: ResolveLegacyFieldGuideBaselineInput): Promise<FieldGuideVersion>;
  setFieldGuideCapacity(aiIdentityId: string, language: FieldGuideLanguage, capacityTokens: FieldGuideCapacity): Promise<void>;
  restoreFieldGuideVersion(aiIdentityId: string, language: FieldGuideLanguage, versionId: string): Promise<FieldGuideVersion>;
}
