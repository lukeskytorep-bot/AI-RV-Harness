import { Check, CircleHelp, RadioTower, X } from "lucide-react";
import { useRef, useState } from "react";

import { PageHeader } from "../../components/PageHeader";
import { aiIsBeDisplayName } from "../../domain/isBeIdentity";
import type { getCopy } from "../../i18n";
import type { AppRepository } from "../../storage/repository";
import type { AppSettings, Profile, Workspace } from "../../types";
import { WorkspaceSwitcherDialog } from "../workspaces";
import { ChatPanel } from "./ChatPanel";

export interface ConversationsScreenProps {
  copy: ReturnType<typeof getCopy>;
  settings: AppSettings;
  profile: Profile | null;
  workspace: Workspace;
  repository: AppRepository | null;
  profiles: Profile[];
  workspaces: Workspace[];
  onOpenWorkspace: (workspace: Workspace) => void;
  createdNotice: { workspaceId: string; workspaceName: string; profileName: string } | null;
  onDismissCreatedNotice: () => void;
}

export function ConversationsScreen({
  copy,
  settings,
  profile,
  workspace,
  repository,
  profiles,
  workspaces,
  onOpenWorkspace,
  createdNotice,
  onDismissCreatedNotice,
}: ConversationsScreenProps) {
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const switcherButtonRef = useRef<HTMLButtonElement>(null);
  const closeSwitcher = () => { setSwitcherOpen(false); requestAnimationFrame(() => switcherButtonRef.current?.focus()); };

  return (
    <>
      <div className="page workspace-page conversations-page">
        <PageHeader
          title={copy.conversationsNav}
          subtitle={`${workspace.name} · ${profile ? aiIsBeDisplayName(profile) : "—"}`}
          action={<div className="workspace-header-actions"><button ref={switcherButtonRef} className="secondary-button" onClick={() => setSwitcherOpen(true)}><RadioTower size={15} />{copy.switchWorkspace}</button><button className="secondary-button" aria-expanded={helpOpen} aria-controls="conversation-help-panel" onClick={() => setHelpOpen((current) => !current)}><CircleHelp size={15} />{settings.interfaceLanguage === "pl" ? "Jak działa rozmowa?" : "How does Conversation work?"}</button></div>}
        />
        {helpOpen && <ConversationHelpPanel language={settings.interfaceLanguage} />}
        {createdNotice && <div className="workspace-created-notice"><Check size={16} /><span><strong>{copy.workspaceCreated}</strong><small>{createdNotice.profileName} → {createdNotice.workspaceName}</small></span><button className="icon-button" onClick={onDismissCreatedNotice}><X size={14} /></button></div>}
        <ChatPanel copy={copy} settings={settings} profile={profile} workspace={workspace} repository={repository} fixedMode="conversation" />
      </div>
      {switcherOpen && <WorkspaceSwitcherDialog copy={copy} profiles={profiles} workspaces={workspaces} kind="conversation" activeWorkspaceId={workspace.id} onOpenWorkspace={onOpenWorkspace} onClose={closeSwitcher} />}
    </>
  );
}


function ConversationHelpPanel({ language }: { language: AppSettings["interfaceLanguage"] }) {
  const pl = language === "pl";
  return <section id="conversation-help-panel" className="panel workspace-help-panel" aria-label={pl ? "Jak działa rozmowa?" : "How does Conversation work?"}>
    <h2>{pl ? "Jak działa rozmowa?" : "How does Conversation work?"}</h2>
    {pl ? <>
      <p>Rozmowa pozwala prowadzić zwykły dialog z wybraną tożsamością Viewera należącą do aktywnego Profilu i Conversation Workspace. Wpisz wiadomość w polu na dole i wybierz <strong>Wyślij</strong>. Rozmowa oraz jej historia są zapisywane lokalnie; możesz utworzyć kolejną rozmowę, zmienić jej nazwę, wyeksportować ją albo zarchiwizować.</p>
      <p>Przycisk spinacza pozwala dodać dokumenty i obrazy. Dokumenty są zapisywane jako <strong>Źródła Workspace</strong> i możesz zdecydować, które z nich są aktywne. Obrazy są przekazywane w następnej turze tylko wtedy, gdy wybrana trasa modelu obsługuje vision; aplikacja odrzuci obraz zamiast wysyłać go do niezgodnego modelu.</p>
      <p>Dla wytrenowanej tożsamości z dostępnym pakietem opcja <strong>Użyj Viewer Learning</strong> jest domyślnie włączona. Do rozmowy dołączane są dokładnie jej aktywne <strong>Field Guide</strong> i <strong>Viewer Notes</strong> jako kontekst tylko do odczytu. Możesz wyłączyć tę opcję dla danej rozmowy. Conversation nie tworzy, nie aktualizuje ani nie aktywuje nowych wersji Field Guide lub Viewer Notes.</p>
      <p>Wskaźnik <strong>Szacowany kontekst</strong> pokazuje przybliżone wykorzystanie okna kontekstowego. Gdy aktywne źródła i historia zbliżają się do limitu modelu, usuń niepotrzebne źródła albo rozpocznij nową rozmowę.</p>
    </> : <>
      <p>Conversation lets you hold an ordinary dialogue with a selected Viewer identity that belongs to the active Profile and Conversation Workspace. Enter a message in the composer at the bottom and choose <strong>Send</strong>. The conversation and its history are stored locally; you can create another conversation, rename it, export it, or archive it.</p>
      <p>Use the paperclip button to attach documents and images. Documents are stored as <strong>Workspace Sources</strong>, and you can choose which sources are active. Images are sent with the next turn only when the selected model route supports vision; the app rejects the image instead of sending it to an incompatible model.</p>
      <p>For a trained identity with an available package, <strong>Use Viewer Learning</strong> is enabled by default. That identity’s exact active <strong>Field Guide</strong> and <strong>Viewer Notes</strong> are attached as read-only context. You may disable the option for an individual conversation. Conversation never creates, updates, or activates Field Guide or Viewer Notes versions.</p>
      <p>The <strong>Estimated context</strong> indicator shows the approximate use of the context window. If active sources and conversation history approach the model limit, remove unnecessary sources or start a new conversation.</p>
    </>}
  </section>;
}
