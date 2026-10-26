# AI RV Harness — DIRECT-1A — Mistral nested thinking parser

**Data:** 2026-10-19  
**Baza wejściowa:** `AI_RV_HARNESS_DIRECT_0_SOURCE.zip`  
**SHA-256 bazy wejściowej:** `8cb8d818198e32ecb00c7b69ca1a0dc9dc0d4832b7d4527beead3d33d99ed9ec`  
**Zakres:** pierwszy podetap DIRECT-1. Naprawa odbioru Mistral nested thinking. Bez samplerów, bez SSE, bez płatnych/live wywołań API.

## 1. Wynik

**PASS warunkowy na runtime/CI.** Zmiana produkcyjna parsera została wykonana i ma fixtures oraz testy regresyjne. Statyczne verifiery DIRECT-0 i DIRECT-1A przechodzą. W lokalnym środowisku nie ma Cargo, dlatego Rustowych testów nie można było uruchomić tutaj; wymagają potwierdzenia w GitHub Actions / środowisku Rust.

## 2. Naprawiona luka

Baza DIRECT-0 odtwarzała odpowiedź Mistral o kształcie:

`content = [{ type: "thinking", thinking: [{ type: "text", text: "reasoning" }] }, { type: "text", text: "final" }]`.

Przed zmianą final był odczytywany jako `final`, ale zagnieżdżona tablica `thinking[]` nie była wyciągana do reasoning. DIRECT-1A zmienia wyłącznie ekstrakcję embedded reasoning: gdy część ma typ thinking/reasoning/thought, parser najpierw respektuje bezpośredni tekst, a następnie potrafi wykorzystać istniejący `extract_reasoning_text` dla pola `thinking` albo `reasoning`. Dzięki temu tablica elementów tekstowych jest składana w kolejności.

## 3. Oczekiwany rezultat fixture

Dla podstawowego fixture po DIRECT-1A:

- `content = "final"`;
- `reasoning_content = "reasoning"`;
- `reasoning_source = "mistral_thinking"`;
- `finish_reason = "stop"`.

Drugi fixture potwierdza, że kilka elementów nested thinking jest składanych w kolejności (`first second`) oraz że zwykły tekst zawierający słowo „thinking” nie jest błędnie usuwany z finalnej odpowiedzi.

## 4. Diagnostyka źródła reasoning

Ogólny parser OpenAI-compatible historycznie używa oznaczenia `openai_reasoning_details` także dla reasoning osadzonego w `message.content`. W DIRECT-1A ścieżka wywołana dla `ProviderKind::Mistral` mapuje taki przypadek na `mistral_thinking`, o ile nie ma rzeczywistego pola `reasoning_details`. Nie zmienia to kontraktu innych providerów.

## 5. Replay Mistral — wynik oceny

Replay **nie został zaimplementowany w DIRECT-1A** i nie powinien być dokładany jako szybki alias do OpenRouterowego `reasoning_details`.

Aktualny kontrakt continuation ma jawne transporty:

- `openrouter`;
- `google-native`;
- `anthropic-native`.

Nie ma transportu Mistral. Rustowy `ProviderContinuationState`, TypeScriptowy `ProviderContinuationState`, fingerprinty, walidacja requestu, capture/persistence sesji, resume oraz chat memory są spięte z tym zamkniętym zestawem. Poprawne DIRECT-1B powinno więc dodać osobny kontrakt Mistral, przechowujący dozwolony pełny zestaw content chunks potrzebny do replay, z własnym transportem/formatem i fingerprintem. Nie należy wpychać prywatnego reasoning do widocznego `content` ani podszywać go pod format OpenRouter.

## 6. Sampling i SSE pozostają zamknięte

DIRECT-1A nie zmienia bramki dodatkowych samplerów. `top_p/top_k/seed` nadal są emitowane tylko dla OpenRouter i Custom OpenAI-compatible, a walidacja nadal odrzuca je dla direct Mistral.

Nie dodano jeszcze:

- `seed -> random_seed`;
- Mistral `top_p` / `top_k`;
- SSE dla Mistral;
- zmian UI/Profile/Research/snapshot.

To świadoma granica podetapu, zgodna z planem DIRECT-1: parser/replay najpierw, samplery i streaming później.

## 7. Pliki zmienione względem DIRECT-0

1. `src-tauri/src/providers/reasoning.rs` — obsługa nested thinking arrays.
2. `src-tauri/src/providers/response_parsers.rs` — marker `mistral_thinking`.
3. `src-tauri/src/providers/tests.rs` — dwa testy regresyjne DIRECT-1A.
4. `src/providers/direct-compat-fixtures/mistral-nested-thinking-multi-response.json` — dodatkowy fixture.
5. `scripts/verify-direct-providers-direct1a.mjs` — verifier podetapu.
6. `scripts/verify-direct-providers-direct0.mjs` — historyczny verifier nie wymaga już utrzymywania celowo naprawionego błędu; nadal zamraża bazowe fixture i granice DIRECT-0.
7. ten raport.

## 8. Weryfikacja wykonana lokalnie

Przechodzi:

- `node scripts/verify-direct-providers-direct0.mjs .`;
- `node scripts/verify-direct-providers-direct1a.mjs .`.

`verify-source-integrity.mjs` nadal nie przechodzi z odziedziczonego powodu występującego już w bazie DIRECT-0: ścieżki z literalnymi sekwencjami `#U....` w zasobach treningowych i dokumentach. DIRECT-1A ich nie zmienia.

Nie wykonano lokalnie Cargo test/Clippy, ponieważ środowisko nie ma Cargo.

## 9. Następny krok

**DIRECT-1B — Mistral native replay contract.** Dodać jawny transport continuation dla Mistral oraz pełną ścieżkę capture → persistence → resume → request replay z fingerprintami i limitami. Po jego odbiorze można przejść do DIRECT-1C: model-aware samplery (w tym `seed -> random_seed`) i następnie DIRECT-1D SSE.

## 10. Hash logicznego source tree po DIRECT-1A

`5cc491d166d5e8044fe59ede32ef5aba58f57bd738e01f7d039923739b7abc26`
