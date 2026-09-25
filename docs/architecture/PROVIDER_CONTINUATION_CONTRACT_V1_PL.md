# AI RV Harness v0.7.13 — Provider Continuation Contract v1

**Etap bazowy:** `CONTINUATION-CONTRACT-0-R1`  
**Aktualny etap runtime:** `GOOGLE-CONTINUITY-1` (`C4`)  
**Status:** OpenRouter continuity działa w Conversation i workflowach C3; C4 aktywuje Google native `google-thought-parts` dla potwierdzonego kontraktu text/thought `Part` + `thoughtSignature`, z tym samym persistence schema 025 i exact-event replay  
**Zweryfikowano:** 2026-09-25

## Cel

Ten dokument definiuje kontrakt danych provider-native continuation. C2 dodało trwały zapis schema 025, C3 podłączyło OpenRouter continuation do RV Sessions, Training, Research, post-Reveal i Resume, a C4 aktywuje analogiczny, provider-native replay Google dla zweryfikowanych text/thought `Part` z `thoughtSignature`. State pozostaje przypisany do dokładnej wiadomości `assistant` lub `session_event_id`; nie jest rekonstruowany z transcriptu ani widocznego reasoning.

## Klasy danych

1. **Semantic message** — rola, widoczny tekst, obrazy, identyfikator wiadomości.
2. **Provider continuation state** — minimalny, provider-native state wymagany do bezpiecznego replay.
3. **Diagnostics** — usage, finish reason, request ID, actual model, retry metadata. Nie podlega automatycznemu replay.
4. **Display reasoning** — reasoning możliwy do pokazania w UI. Nie wolno z niego rekonstruować continuation state.

## Kontrakt v1

Kanoniczny kontrakt testowy znajduje się w `src/providers/continuationContract.ts`. Jest zamkniętą unią trzech formatów:

- `openrouter / openrouter-reasoning-details`;
- `google-native / google-thought-parts`;
- `anthropic-native / anthropic-thinking-blocks`.

Nie istnieje `opaque`, `payload: unknown` ani ogólny passthrough JSON.

## Replay fingerprint

Każdy state zawiera:

- transport;
- normalized endpoint;
- `providerConfigId`;
- `credentialId`;
- requested model ID;
- opcjonalny actual model ID (diagnostyczny w generic v1);
- format i wersję formatu.

Generic fingerprint v1 **nie zawiera reasoning effort/mode**. OpenRouter rozróżnia `reasoning.effort` od `reasoning.mode`, a zmiana effort nie jest ogólnym dowodem niekompatybilności zapisanych `reasoning_details`. Jeżeli konkretny transport w przyszłości udowodni taki wymóg, otrzyma provider-specific regułę lub nową wersję fingerprintu.

Automatyczna kompatybilność generic v1 wymaga zgodności transportu, endpointu, `providerConfigId`, `credentialId`, requested model ID oraz formatu/wersji state. Endpoint ma już być znormalizowany przez istniejący credential-binding contract. Sekret ani hash sekretu nie są częścią fingerprintu.

`actualModelId` może zostać zachowany jako diagnostyka odpowiedzi, ale **nie jest warunkiem `replayFingerprintsCompatible()` w v1**. Dla przyszłego C1 OpenRouter nie należy wypełniać ani porównywać `actualModelId` jako replay gate, chyba że przed dispatch istnieje stabilnie znana tożsamość route/modelu i osobny, udokumentowany kontrakt wymaga exact actual-model match.

## Limity v1

Limity są **guardrailami Harnessa**, nie deklarowanymi limitami providerów:

| Limit | Wartość |
|---|---:|
| bloków state / assistant message | 64 |
| pojedynczy blok | 512 KiB UTF-8 |
| state jednej wiadomości | 2 MiB UTF-8 |
| łączny state jednego requestu | 8 MiB UTF-8 |
| maks. głębokość inspekcji wejścia | 128 |
| maks. liczba odwiedzonych węzłów wejścia | 10 000 |

Rationale: oficjalne fixture’y są małe, ale podpisy i encrypted blocks są opaque i mogą być znacznie dłuższe. Guardraile celowo dają duży zapas, jednocześnie blokując nieograniczony JSON. Blok przekraczający limit jest odrzucany w całości; nie wolno go przycinać ani streszczać.

## Capability matrix

| ProviderKind / transport | Oficjalny state | Wymóg replay | Stan obecnego Harnessa | Decyzja C0 |
|---|---|---|---|---|
| OpenRouter | `message.reasoning_details[]`: `reasoning.summary`, `reasoning.encrypted`, `reasoning.text` | przy special/encrypted/summarized reasoning zachować pełną tablicę i kolejność | **ACTIVE C1–C3:** capture, persistence, exact-message/event replay, Resume i post-Reveal | **ACTIVE** |
| Google native (`generateContent`) | `Part.thoughtSignature` na dokładnym part; thought parts mogą mieć `thought=true` | signature należy zwrócić dokładnie na właściwym part | **ACTIVE C4 dla zweryfikowanego text/thought subsetu:** parser zachowuje kompletną wspieraną sekwencję Parts, persistence wiąże ją z exact assistant turn/event, a request builder replayuje `thoughtSignature` na tym samym Part | **ACTIVE C4; tools/function parts nadal poza v1** |
| Anthropic native | `thinking { thinking, signature }`, `redacted_thinking { data }` | zachować bloki, kolejność i opaque signature/data; modyfikacja może dać 400 | parser zachowuje `thinking`, ale obecnie zastępuje `redacted_thinking.data` placeholderem; request builder nie replayuje bloków | **CONTRACTED shape; runtime deferred to C5** |
| OpenAI direct | brak zatwierdzonego osobnego Chat Completions continuation fixture w C0 | zależne od API/modelu | text-only continuation | **NOT CONTRACTED** |
| Z.AI direct | brak zatwierdzonego provider-native fixture | nieznane | text-only continuation | **NOT CONTRACTED** |
| DeepSeek direct | brak zatwierdzonego provider-native fixture | nieznane | text-only continuation | **NOT CONTRACTED** |
| Mistral direct | brak zatwierdzonego native fixture; Mistral przez OpenRouter korzysta z kontraktu OpenRouter | zależne od transportu | direct `ProviderKind::Mistral` jest osobnym endpointem | **NOT CONTRACTED for native** |
| Blackbox direct | brak zatwierdzonego provider-native fixture | nieznane | text-only continuation | **NOT CONTRACTED** |
| Custom OpenAI | kontrakt zależy od rzeczywistego backendu | nie wolno inferować z nazwy modelu | compatibility default OpenAI-like bez continuation state | **NOT CONTRACTED** |

## Fixture’y

`src/providers/continuation-fixtures/` zawiera trzy pary response → next request. OpenRouter i Anthropic odwzorowują zatwierdzone wire shapes; Google fixture C4 jest **zanonimizowanym odwzorowaniem rzeczywiście zaobserwowanej odpowiedzi Google native `gemini-3.8-flash` z 2026-09-25**. Repo nie zapisuje prywatnej treści rozmowy, prawdziwego podpisu użytkownika ani klucza API.

- OpenRouter: struktura `reasoning_details` zachowana 1:1 i w kolejności;
- Google: C4 pokazuje zarówno historyczny request bez podpisu, jak i oczekiwany replay, w którym `thoughtSignature` pozostaje na dokładnym text `Part`;
- Anthropic: `thinking` i `redacted_thinking` zachowane bez modyfikacji.

## Prywatność

Validator odrzuca m.in. pola nagłówków, Authorization, API key/secret, raw/full response i debug payload. Ordinary continuation state nie jest miejscem na diagnostics ani pełną odpowiedź HTTP. `credentialId` jest dozwolonym, niejawnym identyfikatorem tożsamości i nie jest sekretem.

## Fail-closed

Validator jest fail-closed dla dowolnego `unknown`: cykle, nadmierna głębokość, struktury nieserializowalne i błędy introspekcji zwracają kontrolowany `invalid_payload` zamiast wyjątku.

Validator odrzuca:

- nieznaną schema version;
- nieznany transport lub format;
- dodatkowe niezatwierdzone pola;
- malformed fingerprint;
- oversized state;
- zbyt wiele bloków;
- provider-native block o nieznanym typie;
- pola mogące zawierać credentiale/headers/full response.

Nie ma heurystycznej naprawy, sortowania, skracania, streszczania ani rekonstrukcji z `reasoningContent`.

## Źródła oficjalne

Sprawdzone 2026-09-22:

- OpenRouter, Reasoning Tokens / Preserving Reasoning / Reasoning Details API Shape: https://openrouter.ai/docs/guides/best-practices/reasoning-tokens
- Google Gemini, Thought signatures: https://ai.google.dev/gemini-api/docs/generate-content/thought-signatures
- Google Gemini, Generate Content `Part` (`thought`, `thoughtSignature`): https://ai.google.dev/api/generate-content
- Anthropic, Extended thinking / preserving thinking blocks: https://platform.claude.com/docs/en/build-with-claude/extended-thinking
- Anthropic, Messages API types: https://platform.claude.com/docs/en/api/messages/create

## Aktywacja C1 — OpenRouter in-memory

C1 aktywuje wyłącznie następujący łańcuch w zwykłej Conversation:

1. kompletne `reasoning_details` z odpowiedzi OpenRouter jest walidowane kontraktem v1;
2. zwalidowany state jest przypisany w pamięci do dokładnego `ChatMessage.id` wiadomości assistant;
3. kolejny zgodny request otrzymuje ten state na tej samej wiadomości assistant;
4. zgodność wymaga tego samego `providerConfigId`, `credentialId`, requested model ID, normalized endpoint i formatu/wersji;
5. normalized endpoint pochodzi z natywnego credential-binding normalizer, nie z drugiej implementacji TypeScript;
6. przy niezgodności provider/model/credential/endpoint request zatrzymuje się przed provider call; użytkownik Conversation może jawnie wybrać `Continue text-only`, co usuwa in-memory state tego wątku;
7. `actualModelId` pozostaje diagnostyczny i nie jest replay gate; generic fingerprint nie zawiera reasoning effort/mode;
8. `reasoning_details`, Google `thoughtSignature` oraz tekst ukrytych `thought:true` parts są redagowane z detailed debug payloadu; widoczny semantic text pozostaje diagnostycznie czytelny.

C2 zachowuje powyższy kontrakt C1 i dodaje wyłącznie warstwę persistence:

- schema 025 tworzy `chat_message_provider_state` oraz `session_event_provider_state`;
- payload nie trafia do `chat_messages.content`, `session_events.metadata_json`, zwykłych eksportów ani logów;
- Conversation zapisuje assistant message + state atomowo i po restarcie hydratuje zwalidowany state przed kolejnym kompatybilnym requestem;
- hash SHA-256, rozmiar UTF-8, format, wersja i fingerprint są sprawdzane ponownie przy odczycie;
- Browser storage zachowuje logiczną parytetowość z SQLite, włącznie z rollbackiem zapisu i controlled purge;
- Session storage ma atomowe API event + state przypisane do dokładnego `session_event_id`; C3 używa go w RV Sessions, Training, Research, post-Reveal i Resume dla OpenRouter;
- historyczne rekordy bez state nadal działają text-only;
- C4 używa tego samego schema 025 dla Google native bez migracji 026;
- Anthropic runtime replay pozostaje wyłączone do C5.

C2 nie rekonstruuje state z widocznego reasoning ani z transcriptu. Persistence przechowuje wyłącznie zwalidowany provider-native state wymagany do replay.

## Hardening C1-R1 — context budget

C1-R1 domyka preflight kontekstu po aktywacji provider-native state. `continuationState` jest dołączany do historycznej wiadomości assistant **przed** `estimateContextBudget()` i jego zwalidowany rozmiar UTF-8 jest uwzględniany przed `executeProviderChat()`. State nie jest przycinany.

Estymacja continuation payload jest celowo bardziej konserwatywna niż zwykłego tekstu, ponieważ signed/encrypted/base64-like data ma inną charakterystykę tokenizacji:

- bazowo: `2 UTF-8 bytes / estimated token`;
- dodatkowy safety factor: `1.25`;
- jest to lokalny preflight bezpieczeństwa, nie tokenizer billingowy providera.

Jeżeli widoczny input + obrazy + continuation estimate + zarezerwowany output przekraczają context window modelu, Conversation zatrzymuje request przed provider dispatch. UI context meter używa tego samego `estimateContextBudget()` i dolicza aktualny in-memory continuation state wątku, aby nie pokazywać zaniżonego kontekstu.

C1-R1 nie zmienia limitów kontraktu 64 / 512 KiB / 2 MiB / 8 MiB. Tamte limity pozostają guardrailami struktury/payloadu; context budget jest osobnym limitem modelu.



## Aktywacja C4 — Google native text/thought parts

C4 aktywuje wyłącznie potwierdzony kontrakt Google native `generateContent` dla text/thought `Part`:

1. parser Rust wykrywa continuation, gdy odpowiedź zawiera `thought=true` lub niepusty `thoughtSignature`;
2. jeżeli continuation istnieje, zachowywana jest kompletna **wspierana** kolejność text/thought Parts, ponieważ Gemini 3 może dołączyć `thoughtSignature` bezpośrednio do widocznego text Part;
3. TypeScript waliduje zamknięty format `google-native / google-thought-parts`, canonical base64 signature, limity i exact visible-content binding;
4. Conversation, Session, Resume i post-Reveal korzystają z istniejącego persistence schema 025 i exact-message/event ownership;
5. request builder Google odtwarza zapisane Parts wraz z niezmienionym `thoughtSignature` zamiast rekonstruować tylko `{ text }`;
6. zmiana provider config, credential, endpointu lub requested model ID unieważnia automatyczny replay;
7. historyczne rekordy bez Google state pozostają text-only;
8. function/tool parts, pełny uniwersalny `parts[]` AST i Google function calling pozostają poza ProviderMessage v1 i wymagają osobnego etapu/fixture’ów;
9. Anthropic continuation pozostaje wyłączone do C5.
