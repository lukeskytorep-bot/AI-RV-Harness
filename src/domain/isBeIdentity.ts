import type { Profile } from "../types";

export const DEFAULT_AI_IS_BE_NAME = "AI IS-BE";
export const DEFAULT_HUMAN_IS_BE_NAME = "Human IS-BE";

export function aiIsBeDisplayName(profile?: Pick<Profile, "name"> | null): string {
  return profile?.name.trim() || DEFAULT_AI_IS_BE_NAME;
}

export function humanIsBeDisplayName(profile?: Pick<Profile, "humanName"> | null): string {
  return profile?.humanName?.trim() || DEFAULT_HUMAN_IS_BE_NAME;
}
