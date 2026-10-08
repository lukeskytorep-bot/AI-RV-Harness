import { aiIsBeDisplayName } from "../domain/isBeIdentity";
import type { InterfaceLanguage, Profile } from "../types";

export interface ProfileSelectorProps {
  profiles: readonly Profile[];
  value: string;
  onChange: (profileId: string) => void;
  language: InterfaceLanguage;
  disabled?: boolean;
  className?: string;
}

export function ProfileSelector({ profiles, value, onChange, language, disabled = false, className }: ProfileSelectorProps) {
  return (
    <label className={["profile-selector", className].filter(Boolean).join(" ")}>
      <span>{language === "pl" ? "Aktywny Profil" : "Active Profile"}</span>
      <select
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        aria-label={language === "pl" ? "Aktywny Profil" : "Active Profile"}
      >
        {profiles.map((profile) => (
          <option key={profile.id} value={profile.id}>{aiIsBeDisplayName(profile)}</option>
        ))}
      </select>
    </label>
  );
}
