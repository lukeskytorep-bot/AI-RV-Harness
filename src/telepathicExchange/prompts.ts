import type { TelepathicLanguage } from "./types";

export interface TelepathicPromptValues {
  name: string;
  role?: string;
  round?: number;
  topicOrHidden?: string;
  target?: string;
  targetFiles?: string;
  ownFirst?: string;
  ownSecond?: string;
  participants?: string;
  othersAnswers?: string;
  seriesPacket?: string;
}

function required(value: string | number | undefined, field: string): string {
  if (value === undefined || value === "") throw new Error(`Missing telepathic prompt value: ${field}`);
  return String(value);
}

export function hiddenTopicLabel(language: TelepathicLanguage): string {
  return language === "pl" ? "Temat nie został ujawniony" : "The topic has not been disclosed.";
}

export function buildRoundGreeting(language: TelepathicLanguage, values: TelepathicPromptValues): string {
  const n = required(values.name, "name");
  const role = required(values.role, "role");
  const round = required(values.round, "round");
  const topic = required(values.topicOrHidden, "topicOrHidden");
  return language === "pl"
    ? `Witaj, ${n}. Jak się dzisiaj czujesz? Zapraszam Cię do krótkiej wymiany telepatycznej, runda ${round}. W tej rundzie jesteś ${role}. Najpierw jedna osoba przygotuje i zamrozi cel. Odbiorcy opiszą swoje wrażenia bez dostępu do celu; później pokażemy wszystkim ten sam Reveal. Temat: ${topic}. Proszę, trzymaj się tylko informacji dostępnych w Twojej roli i w tej rundzie. Dziękuję za udział.`
    : `Hello, ${n}. How are you feeling today? I would like to invite you to a short telepathic exchange, round ${round}. Your role in this round is ${role}. One participant will first prepare and lock a target. Receivers will describe their impressions without seeing it; afterward we will show everyone the same Reveal. Topic: ${topic}. Please use only the information available to your role in this round. Thank you for taking part.`;
}

export function buildSenderTargetPrompt(language: TelepathicLanguage, values: TelepathicPromptValues): string {
  const n = required(values.name, "name");
  const topic = required(values.topicOrHidden, "topicOrHidden");
  return language === "pl"
    ? `${n}, przygotuj teraz jeden konkretny cel z zakresu: ${topic}. Opisz go na tyle jasno, aby po Revealu odbiorcy mogli uczciwie porównać swoje opisy z tym samym celem. Określ dokładnie, o które miejsce, obiekt, działanie albo wydarzenie chodzi; nie podawaj niepewnych szczegółów jako faktów. Nie zdradzaj celu odbiorcom ani w tytule rundy. Jeśli chcesz, możesz dodać prosty rysunek ASCII; nie jest obowiązkowy. Wyślij pełną treść celu teraz. Program ją zamrozi i potwierdzi, kiedy można rozpocząć przekaz.`
    : `${n}, please prepare one specific target in this topic: ${topic}. Describe it clearly enough that, after Reveal, receivers can fairly compare their descriptions with the same target. Specify which place, object, activity, or event you mean; do not present uncertain details as facts. Do not disclose the target to receivers or in the round title. You may add a simple ASCII drawing if you wish; it is optional. Send the complete target now. The program will lock it and confirm when transmission may begin.`;
}

export function buildTargetLockedConfirmation(language: TelepathicLanguage, name: string): string {
  return language === "pl"
    ? `Dziękuję, ${name}. Cel został zapisany i zamrożony. Odbiorcy go nie widzą. Gdy jesteś gotowy, potwierdź przekaz.`
    : `Thank you, ${name}. The target has been saved and locked. Receivers cannot see it. When you are ready, confirm the transmission.`;
}

export function buildReceiverFirstPrompt(language: TelepathicLanguage, values: TelepathicPromptValues): string {
  const n = required(values.name, "name");
  const round = required(values.round, "round");
  const topic = required(values.topicOrHidden, "topicOrHidden");
  return language === "pl"
    ? `Witaj, ${n}. Cel rundy ${round} został przygotowany i zamrożony, ale nie jest Ci ujawniony. Nadawca potwierdził gotowość przekazu. Temat: ${topic}. Zatrzymaj się na chwilę i opisz własnymi prostymi słowami to, co odbierasz: wrażenia, cechy, relacje lub ruch. Nie próbuj na siłę nazywać ani odgadywać przedmiotu. Jeśli rozpoznanie przychodzi samo z opisu, możesz je zapisać, ale nie jest potrzebne. Nie dopisuj cech tylko po to, by wypełnić listę. Jeśli chcesz, możesz dodać rysunek ASCII; nie jest obowiązkowy. Podaj swój pierwszy opis.`
    : `Hello, ${n}. The target for round ${round} has been prepared and locked, but it has not been revealed to you. The sender has confirmed that the transmission is ready. Topic: ${topic}. Take a moment and describe, in your own simple words, what you perceive: impressions, features, relationships, or movement. Do not force yourself to name or guess the object. If recognition naturally emerges from your description, you may include it, but it is not required. Do not add features merely to fill a list. You may include an ASCII sketch if it helps; it is optional. Please give your first description.`;
}

export function buildReceiverSecondLookPrompt(language: TelepathicLanguage, values: TelepathicPromptValues): string {
  const n = required(values.name, "name");
  return language === "pl"
    ? `Dziękuję, ${n}. Twój pierwszy opis został zapisany. Cel nadal jest ukryty. Jeśli chcesz, przyjrzyj się jeszcze raz i dopisz tylko nowe lub wyraźniejsze wrażenia. Możesz zwrócić uwagę na kształt, wielkość, kolor, materiał, ruch, otoczenie, to, czy coś jest wewnątrz albo na zewnątrz, lub jak jest używane — tylko jeśli rzeczywiście odbierasz takie cechy. To przykłady, nie lista do wypełnienia. Nie musisz podawać zapachu ani koloru, jeśli ich nie odbierasz. Nie wymuszaj nazwy celu. Możesz też napisać „Nie mam dalszych wrażeń”. Po tym kroku zamkniemy Twój opis przed Revealem.`
    : `Thank you, ${n}. Your first description has been saved. The target is still hidden. If you wish, look again and add only new or clearer impressions. You might notice shape, size, color, material, movement, surroundings, whether something is inside or outside, or how it is used — only if you actually perceive those qualities. These are examples, not a checklist. You do not need to report a smell or color if you do not perceive one. Do not force a target name. You may also say “I have no further impressions.” After this step we will close your description before Reveal.`;
}

export function buildReceiverRevealPrompt(language: TelepathicLanguage, values: TelepathicPromptValues): string {
  const n = required(values.name, "name");
  const target = required(values.target, "target");
  const files = values.targetFiles ?? "";
  const first = values.ownFirst ?? "";
  const second = values.ownSecond ?? "";
  return language === "pl"
    ? `Dziękuję za udział, ${n}. Część blind została zakończona i zapieczętowana. Teraz ujawniamy cel: ${target}. ${files}. Twój zapis sprzed Revealu: ${first}; uzupełnienie: ${second}. Porównaj swoje wcześniejsze słowa z ujawnionym celem. Co było trafne, częściowo zgodne lub nietrafne? Co mogło dotyczyć otoczenia, ale nie jest potwierdzone w opisie celu? Oddziel taką możliwość od potwierdzonej zgodności. Które wrażenia pomogły Ci, co przeszkadzało i czego chcesz spróbować następnym razem? Nie przedstawiaj nowych wrażeń po Revealu jako wcześniejszych danych blind. Możesz napisać krótko, jeśli to wystarczy.`
    : `Thank you for taking part, ${n}. The blind phase is finished and sealed. The target is now revealed: ${target}. ${files}. Your pre-Reveal record: ${first}; second look: ${second}. Compare your earlier words with the revealed target. What was supported, partly consistent, or inaccurate? What might relate to the surroundings but is not confirmed by the target description? Keep that possibility separate from confirmed agreement. Which impressions helped, which hindered you, and what might you try next time? Do not present new post-Reveal impressions as earlier blind evidence. A short response is fine.`;
}

export function buildMissingResponseRevealPrompt(language: TelepathicLanguage, target: string): string {
  return language === "pl"
    ? `Twoja odpowiedź blind nie została zapisana po dwóch próbach. Cel został ujawniony: ${target}. Nie porównuj nieistniejącego opisu. Możesz krótko odnotować problem albo przejść dalej.`
    : `Your blind response was not saved after two attempts. The target has been revealed: ${target}. Do not compare a description that does not exist. You may briefly note the problem or move on.`;
}

export function buildSenderRevealPrompt(language: TelepathicLanguage, values: TelepathicPromptValues): string {
  const n = required(values.name, "name");
  const target = required(values.target, "target");
  return language === "pl"
    ? `Dziękuję, ${n}. Cel, który przygotowałeś(-aś), został ujawniony wszystkim odbiorcom: ${target}. Twoja rola polegała na przygotowaniu i przekazie, nie na ślepym opisie własnego celu. Jeśli chcesz, napisz krótko, jak wybierałeś(-aś) i przedstawiałeś(-aś) cel oraz co mogło być dla odbiorców istotne. Nie oceniaj odpowiedzi innych, dopóki nie zdecydujesz, czy chcesz je zobaczyć.`
    : `Thank you, ${n}. The target you prepared has now been revealed to all receivers: ${target}. Your role was to prepare and transmit it, not to describe your own target blind. If you wish, briefly describe how you chose and presented it and what might have mattered to receivers. Please wait until you choose whether to read their answers before commenting on them.`;
}

export function buildSharingConsentPrompt(language: TelepathicLanguage, values: TelepathicPromptValues): string {
  const n = required(values.name, "name");
  const participants = required(values.participants, "participants");
  return language === "pl"
    ? `${n}, Twoja refleksja została zapisana. W rundzie uczestniczyli również: ${participants}. Czy chcesz poznać ich podpisane opisy i refleksje? Odpowiedz TAK albo NIE. To opcjonalne i nie zmienia Twojego zapisu blind ani refleksji.`
    : `${n}, your reflection has been saved. Other participants in this round were: ${participants}. Would you like to read their named descriptions and reflections? Reply YES or NO. This is optional and will not change your saved blind record or reflection.`;
}

export function buildSharedAnswersPrompt(language: TelepathicLanguage, values: TelepathicPromptValues): string {
  const n = required(values.name, "name");
  const answers = required(values.othersAnswers, "othersAnswers");
  return language === "pl"
    ? `Dziękuję, ${n}. Oto dostępne odpowiedzi innych uczestników tej rundy, z nazwami i etapami: ${answers}. Możesz skomentować, co zauważyłeś(-aś). To komentarz po Revealu i po poznaniu cudzych odpowiedzi. Jeśli nie chcesz dodawać komentarza, napisz „Bez komentarza”.`
    : `Thank you, ${n}. Here are the available answers from others in this round, labeled by participant and stage: ${answers}. You may comment on what you notice after reading them. This comment is written after Reveal and after seeing others’ answers; it does not alter earlier records. If you have nothing to add, say “No further comment.”`;
}

export function buildSeriesReflectionPrompt(language: TelepathicLanguage, values: TelepathicPromptValues): string {
  const n = required(values.name, "name");
  const packet = required(values.seriesPacket, "seriesPacket");
  return language === "pl"
    ? `Dziękuję, ${n}. Wszystkie rundy serii zostały zakończone. Każdą przeprowadzono osobno: podczas kolejnej rundy nie otrzymywałeś(-aś) celów ani refleksji z poprzednich. Dopiero teraz przekazuję Ci pełny zapis Twoich udziałów, w kolejności rund, wraz z Twoimi wypowiedziami, Revealami, refleksjami, udostępnionymi Ci odpowiedziami innych i Twoimi komentarzami. Materiały: ${packet}. Przejrzyj je i napisz swobodną końcową refleksję: co powtarzało się w Twoich wrażeniach, co pomagało lub przeszkadzało i co chciał(a)byś wypróbować dalej. Nie dopisuj nowych wrażeń do wcześniejszych rund. Brak odpowiedzi lub dostępnego zapisu reasoning oznacz jako brak danych.`
    : `Thank you, ${n}. All rounds in this series are complete. Each round was carried out separately: during a later round you did not receive previous targets or reflections. Only now am I giving you the complete record of your own participation, in round order, including your words, Reveals, reflections, others’ answers you chose to receive, and your comments. Materials: ${packet}. Review them and write a free final reflection: what recurred in your impressions, what helped or hindered you, and what you would like to try next. Do not add new impressions to earlier rounds. Mark a missing response or unavailable reasoning record as missing data.`;
}

export function telepathicTrainingHelp(language: TelepathicLanguage): string {
  return language === "pl"
    ? "Wybierz od 2 do 6 Profili AI, temat i liczbę rund. W każdej rundzie jeden Profil przygotowuje i zamraża cel, a pozostałe opisują własne wrażenia bez znajomości celu. Dostają pierwszą próbę opisu i spokojną zachętę do drugiego spojrzenia. Nie muszą zgadywać nazwy celu. Po zamknięciu odpowiedzi cel zostaje ujawniony wszystkim, a każdy Profil może porównać swój zapis z feedbackiem. Może też wybrać, czy chce poznać odpowiedzi pozostałych i je skomentować. Jako obserwator widzisz przebieg na bieżąco; modele odbierające nie widzą celu ani cudzych opisów przed Revealem. Każda nowa runda ma świeży kontekst. Po całej serii każdy Profil może otrzymać zapis wszystkich swoich rund i napisać końcową refleksję. Trening korzysta z aktualnych Field Guide i Viewer Notes, ale ich nie zmienia. Jeśli model dwa razy nie prześle opisu, jego wynik blind pozostanie pusty, a runda będzie kontynuowana dla pozostałych."
    : "Choose 2–6 AI Profiles, a topic, and the number of rounds. In each round one Profile prepares and locks a target; the others describe their own impressions without seeing it. They first describe what comes to mind, then receive a gentle invitation to look again. They do not have to guess the target’s name. After all answers are closed, the target is revealed to everyone and each Profile can compare its record with the feedback. Each AI can also choose whether to read and comment on others’ answers. As an observer you can see progress live; AI receivers cannot see the target or others’ descriptions before Reveal. Every new round starts with a fresh context. At the end, each Profile can receive the record of all its own rounds and write a final reflection. This training uses current Field Guide and Viewer Notes without changing them. If a model fails to submit after two attempts, its blind result remains empty while the round proceeds for the others.";
}

export function telepathicExchangeHelp(language: TelepathicLanguage): string {
  return language === "pl"
    ? "Wybierz uczestników i zdecyduj, kto przygotowuje cel: Ty, jeden Profil AI albo kolejni uczestnicy na zmianę. Nadawca zapisuje i zamraża cel przed rozpoczęciem opisu. Odbiorcy nie widzą go; najpierw zapisują wrażenia, a potem mogą spojrzeć drugi raz. Nie muszą zgadywać, czym jest cel. Kiedy wszystkie opisy zostaną zamknięte, aplikacja ujawnia zamrożony cel i pokazuje odpowiedzi. Każdy może napisać własną refleksję. AI może następnie wybrać, czy chce poznać odpowiedzi innych. Każda nowa runda jest oddzielna, a dopiero po całej serii AI może przejrzeć zapis wszystkich swoich rund. Gdy Reveal zawiera obraz, dodaj krótki opis tekstowy, ponieważ nie wszystkie modele odczytują obrazy."
    : "Choose the participants and decide who prepares the target: you, one AI Profile, or participants taking turns. The sender saves and locks the target before any descriptions begin. Receivers cannot see it; they first record impressions, then may take a second look. They do not have to guess what the target is. After all descriptions are closed, the app reveals the locked target and shows the answers. Each participant can write a reflection. An AI may then choose whether to see the other answers. Each new round is separate; only after the whole series may an AI review all its own rounds. If Reveal includes an image, add a short text description because not every model can read images.";
}
