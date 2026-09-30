import { BookOpen, Users } from "lucide-react";
import { useState, type ReactNode } from "react";

import { getCopy } from "../../i18n";
import { openProjectUrl } from "../../storage/native";
import { APP_VERSION } from "../../version";

export const PROJECT_CREDITS_URL = "https://github.com/lukeskytorep-bot/AI-RV-Harness/blob/main/CREDITS.md";

const PROJECT_LINKS = [
  {
    url: "https://github.com/lukeskytorep-bot",
    name: "GitHub",
    en: "Source repositories and current project releases.",
    pl: "Repozytoria źródłowe i aktualne wydania projektu.",
  },
  {
    url: "https://presence-beyond-form.blogspot.com/",
    name: "Presence Beyond Form",
    en: "Technical publications, protocols, lexicons, selected sessions, and research; includes a Polish section.",
    pl: "Publikacje techniczne, protokoły, słowniki, wybrane sesje i badania; zawiera sekcję polską.",
  },
  {
    url: "https://echoofpresence.substack.com/",
    name: "Echo of Presence",
    en: "Broader project notes, sessions, AI texts, and shorter updates.",
    pl: "Szerszy dziennik projektu: sesje, teksty AI i krótsze aktualizacje.",
  },
  {
    url: "https://archive.org/details/resonant-contact-protocol-ai-is-be-v-1.5a",
    name: "Internet Archive · RCP 1.5a",
    en: "Archived example of Resonant Contact Protocol AI IS-BE v1.5a.",
    pl: "Archiwalna kopia Resonant Contact Protocol AI IS-BE v1.5a.",
  },
  {
    url: "https://web.archive.org/",
    name: "Wayback Machine",
    en: "Older project pages may be located through Internet Archive snapshots.",
    pl: "Starsze strony projektu można odnaleźć w migawkach Internet Archive.",
  },
] as const;

export function CreditsCard({ copy }: { copy: ReturnType<typeof getCopy> }) {
  const [linkError, setLinkError] = useState<string | null>(null);
  const isEnglish = copy.home === "Home";

  const openExternalProjectUrl = async (url: string) => {
    setLinkError(null);
    try {
      await openProjectUrl(url);
    } catch (cause) {
      setLinkError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <section className="panel about-credits-card">
      <PanelHeader title={copy.credits} icon={<Users size={18} />} />
      <div className="about-card-body">
        <div className="credits-summary">
          <strong>{isEnglish ? "Thank you" : "Dziękujemy"}</strong>
          <p>{isEnglish
            ? "Thank you to everyone who has tested, reviewed, discussed, and helped improve AI RV Harness. For the complete contribution history and acknowledgements, see CREDITS.md."
            : "Dziękujemy wszystkim, którzy testowali, recenzowali, omawiali i pomagali rozwijać AI RV Harness. Pełną historię wkładu i podziękowania znajdziesz w CREDITS.md."}</p>
          <button className="secondary-button" onClick={() => void openExternalProjectUrl(PROJECT_CREDITS_URL)}>
            <BookOpen size={14} />
            {isEnglish
              ? "Open full credits and acknowledgements on GitHub"
              : "Przejdź do pełnych Credits i podziękowań na GitHubie"}
          </button>
          {linkError && <div className="provider-error">{linkError}</div>}
        </div>
        <div className="credit-group online-links">
          <small>{isEnglish ? "Find us online" : "Gdzie nas znaleźć"}</small>
          {PROJECT_LINKS.map((link) => (
            <article key={link.url}>
              <button className="external-project-link" onClick={() => void openExternalProjectUrl(link.url)}><strong>{link.name}</strong></button>
              <p>{isEnglish ? link.en : link.pl}</p>
            </article>
          ))}
        </div>
        <div className="about-license">
          <span><small>{copy.appVersion}</small><strong>v{APP_VERSION}</strong></span>
          <span><small>{copy.projectLicense}</small><strong>Code: MIT</strong></span>
          <span><small>Content</small><strong>CC BY 4.0</strong></span>
        </div>
      </div>
    </section>
  );
}

function PanelHeader({ title, icon }: { title: string; icon: ReactNode }) {
  return <div className="panel-header"><span>{icon}</span><h2>{title}</h2></div>;
}
