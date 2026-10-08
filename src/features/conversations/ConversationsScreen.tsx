import { Check, CircleHelp, X } from "lucide-react";
import { useCallback, useRef, useState } from "react";

import { PageHeader } from "../../components/PageHeader";
import { ProfileSelector } from "../../components/ProfileSelector";
import { aiIsBeDisplayName } from "../../domain/isBeIdentity";
import type { getCopy } from "../../i18n";
import type { AppRepository } from "../../storage/repository";
import type { AppSettings, Profile, Workspace } from "../../types";
import { ChatPanel } from "./ChatPanel";
import { TelepathicExchangePanel } from "./TelepathicExchangePanel";

export interface ConversationsScreenProps {
  copy: ReturnType<typeof getCopy>;
  settings: AppSettings;
  profile: Profile | null;
  workspace: Workspace;
  repository: AppRepository | null;
  profiles: Profile[];
  workspaces: Workspace[];
  onProfileChange: (profileId: string) => void;
  createdNotice: { workspaceId: string; workspaceName: string; profileName: string } | null;
  onDismissCreatedNotice: () => void;
  onOperationBusyChange?: (busy: boolean) => void;
}

export function ConversationsScreen({
  copy,
  settings,
  profile,
  workspace,
  repository,
  profiles,
  workspaces,
  onProfileChange,
  createdNotice,
  onDismissCreatedNotice,
  onOperationBusyChange,
}: ConversationsScreenProps) {
  const [helpOpen, setHelpOpen] = useState(false);
  const [surface, setSurface] = useState<"conversation" | "telepathic">("conversation");
  const [operationBusy, setOperationBusy] = useState(false);
  const operationBusyRef = useRef(false);
  const handleBusyChange = useCallback((busy: boolean) => { operationBusyRef.current = busy; setOperationBusy(busy); onOperationBusyChange?.(busy); }, [onOperationBusyChange]);

  return (
    <>
      <div className="page workspace-page conversations-page">
        <PageHeader
          title={copy.conversationsNav}
          subtitle={`${workspace.name} · ${profile ? aiIsBeDisplayName(profile) : "—"}`}
          action={<div className="workspace-header-actions"><ProfileSelector profiles={profiles} value={workspace.profileId} onChange={onProfileChange} language={settings.interfaceLanguage} disabled={operationBusy} /><button className="secondary-button" aria-expanded={helpOpen} aria-controls="conversation-help-panel" onClick={() => setHelpOpen((current) => !current)}><CircleHelp size={15} />{surface === "telepathic" ? (settings.interfaceLanguage === "pl" ? "Jak działa wymiana telepatyczna?" : "How does telepathic exchange work?") : (settings.interfaceLanguage === "pl" ? "Jak działa rozmowa?" : "How does Conversation work?")}</button></div>}
        />
        <div className="conversation-surface-switch" role="tablist" aria-label={settings.interfaceLanguage === "pl" ? "Tryb rozmowy" : "Conversation mode"}><button role="tab" aria-selected={surface === "conversation"} className={surface === "conversation" ? "active" : ""} disabled={operationBusy} onClick={() => { if (!operationBusyRef.current) setSurface("conversation"); }}>{settings.interfaceLanguage === "pl" ? "Zwykła rozmowa" : "Normal conversation"}</button><button role="tab" aria-selected={surface === "telepathic"} className={surface === "telepathic" ? "active" : ""} disabled={operationBusy} onClick={() => { if (!operationBusyRef.current) setSurface("telepathic"); }}>{settings.interfaceLanguage === "pl" ? "Wymiana telepatyczna" : "Telepathic exchange"}</button></div>
        {helpOpen && (surface === "telepathic" ? <TelepathicExchangeHelpPanel language={settings.interfaceLanguage} /> : <ConversationHelpPanel language={settings.interfaceLanguage} />)}
        {createdNotice && <div className="workspace-created-notice"><Check size={16} /><span><strong>{copy.workspaceCreated}</strong><small>{createdNotice.profileName} → {createdNotice.workspaceName}</small></span><button className="icon-button" onClick={onDismissCreatedNotice}><X size={14} /></button></div>}
        {surface === "conversation"
          ? <ChatPanel copy={copy} settings={settings} profile={profile} workspace={workspace} repository={repository} fixedMode="conversation" onBusyChange={handleBusyChange} />
          : <TelepathicExchangePanel key={workspace.id} copy={copy} settings={settings} profile={profile} workspace={workspace} repository={repository} profiles={profiles} workspaces={workspaces} onBusyChange={handleBusyChange} />}
      </div>
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


function TelepathicExchangeHelpPanel({ language }: { language: AppSettings["interfaceLanguage"] }) {
  const pl = language === "pl";
  return <section id="conversation-help-panel" className="panel workspace-help-panel" aria-label={pl ? "Jak działa wymiana telepatyczna?" : "How does telepathic exchange work?"}>
    <h2>{pl ? "Jak działa wymiana telepatyczna?" : "How does telepathic exchange work?"}</h2>
    <p>{pl ? "Wybierz uczestników i zdecyduj, kto przygotowuje cel: Ty, jeden Profil AI albo kolejni uczestnicy na zmianę. Nadawca zapisuje i zamraża cel przed rozpoczęciem opisu. Odbiorcy nie widzą go; najpierw zapisują wrażenia, a potem mogą spojrzeć drugi raz. Nie muszą zgadywać, czym jest cel." : "Choose the participants and decide who prepares the target: you, one AI Profile, or participants taking turns. The sender saves and locks the target before any descriptions begin. Receivers cannot see it; they first record impressions, then may take a second look. They do not have to guess what the target is."}</p>
    <p>{pl ? "Kiedy wszystkie opisy zostaną zamknięte, aplikacja ujawnia zamrożony cel i pokazuje odpowiedzi. Każdy może napisać własną refleksję. AI może następnie wybrać, czy chce poznać odpowiedzi innych. Każda nowa runda jest oddzielna, a dopiero po całej serii AI może przejrzeć zapis wszystkich swoich rund." : "After all descriptions are closed, the app reveals the locked target and shows the answers. Each participant can write a reflection. An AI may then choose whether to see the other answers. Each new round is separate; only after the whole series may an AI review all its own rounds."}</p>
    <p>{pl ? "Gdy Reveal zawiera obraz, dodaj krótki opis tekstowy, ponieważ nie wszystkie modele odczytują obrazy." : "If Reveal includes an image, add a short text description because not every model can read images."}</p>
  </section>;
}
