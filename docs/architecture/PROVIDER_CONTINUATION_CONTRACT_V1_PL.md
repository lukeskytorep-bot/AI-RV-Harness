# AI RV Harness v0.7.13 — Provider Continuation Contract v1

**Etap:** `CONTINUATION-CONTRACT-0-R1`  
**Status:** contract-only / no runtime activation  
**Zweryfikowano:** 2026-09-22

## Cel

Ten dokument zamraża kontrakt danych wymaganych do przyszłego provider-native replay. Nie aktywuje replay, persistence ani migracji. `ProviderMessage` pozostaje bez pola continuation state do etapu C1.

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
| OpenRouter | `message.reasoning_details[]`: `reasoning.summary`, `reasoning.encrypted`, `reasoning.text` | przy special/encrypted/summarized reasoning zachować pełną tablicę i kolejność | parser już zachowuje całe `reasoning_details`, request builder go nie odsyła | **CONTRACTED; C1 first runtime transport** |
| Google native (`generateContent`) | `Part.thoughtSignature` na dokładnym part; thought parts mogą mieć `thought=true` | signature należy zwrócić dokładnie na właściwym part; function calling Gemini 3 wymaga ścisłego round-trip | parser zbiera tylko `thought=true` parts; signature na zwykłym final part może zostać zgubiony; request builder rekonstruuje tekst/obrazy | **CONTRACTED shape; runtime deferred to C4** |
| Anthropic native | `thinking { thinking, signature }`, `redacted_thinking { data }` | zachować bloki, kolejność i opaque signature/data; modyfikacja może dać 400 | parser zachowuje `thinking`, ale obecnie zastępuje `redacted_thinking.data` placeholderem; request builder nie replayuje bloków | **CONTRACTED shape; runtime deferred to C5** |
| OpenAI direct | brak zatwierdzonego osobnego Chat Completions continuation fixture w C0 | zależne od API/modelu | text-only continuation | **NOT CONTRACTED** |
| Z.AI direct | brak zatwierdzonego provider-native fixture | nieznane | text-only continuation | **NOT CONTRACTED** |
| DeepSeek direct | brak zatwierdzonego provider-native fixture | nieznane | text-only continuation | **NOT CONTRACTED** |
| Mistral direct | brak zatwierdzonego native fixture; Mistral przez OpenRouter korzysta z kontraktu OpenRouter | zależne od transportu | direct `ProviderKind::Mistral` jest osobnym endpointem | **NOT CONTRACTED for native** |
| Blackbox direct | brak zatwierdzonego provider-native fixture | nieznane | text-only continuation | **NOT CONTRACTED** |
| Custom OpenAI | kontrakt zależy od rzeczywistego backendu | nie wolno inferować z nazwy modelu | compatibility default OpenAI-like bez continuation state | **NOT CONTRACTED** |

## Fixture’y

`src/providers/continuation-fixtures/` zawiera trzy pary response → next request. Są to **zanonimizowane fixture’y odwzorowujące oficjalnie opublikowane wire shapes**, a nie zapis prywatnego ruchu użytkownika ani odpowiedzi z klucza API.

- OpenRouter: struktura `reasoning_details` zachowana 1:1 i w kolejności;
- Google: `thoughtSignature` pozostaje na dokładnym part;
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

## Granica aktywacji

C0 nie zmienia:

- `ProviderMessage`;
- request/response runtime;
- persistence;
- schema SQLite 24;
- migration registry;
- retry T1;
- Training/Research/Sessions/Resume;
- export/logging UI.

Pierwsza aktywacja runtime może nastąpić dopiero w `OPENROUTER-CONTINUITY-IN-MEMORY-1` po niezależnym audycie C0.
