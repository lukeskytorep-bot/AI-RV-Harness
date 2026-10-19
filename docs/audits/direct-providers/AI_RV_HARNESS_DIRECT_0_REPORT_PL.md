# AI RV Harness — DIRECT-0 — dowody i fixtures

**Data wykonania:** 2026-10-19  
**Zakres:** etap DIRECT-0 z planu „Direct Providers Compatibility Audit 2026”  
**Baza wejściowa:** `AI-RV-Harness-ai-rv-2 (2)(2).zip`  
**SHA-256 archiwum wejściowego:** `371773504a23b248c06945984018910e5b156f98922fb96aa0774a26202871e3`  
**Hash logicznego source tree przed zmianą:** `0fe871af22f044093a2df727402c0ce0f8a2a6ec68fa7956c1fa9d0071008ce4`

## 1. Wynik

DIRECT-0 został wykonany jako etap dowodowy. Nie zmieniono kodu produkcyjnego request buildera, parsera, transportu, UI, Research, IPC ani walidacji. Dodano wyłącznie:

1. fixture odpowiedzi Mistral z zagnieżdżonym `thinking`;
2. fixture/matrycę kontraktów direct providerów;
3. dwa testy charakteryzujące aktualny stan kodu w `src-tauri/src/providers/tests.rs`;
4. niezależny statyczny verifier `scripts/verify-direct-providers-direct0.mjs`.

Nie wykonano płatnych ani live wywołań providerów. Nie zmieniono endpointów, credential binding, profili ani snapshotów.

## 2. Tożsamość bazy

Archiwum nie zawiera katalogu `.git`. Z tego powodu nie można uczciwie potwierdzić gałęzi, commita ani czystego `git status`. Zamiast tego zamrożono wejściowe archiwum i logiczny source tree przez SHA-256.

`package.json` deklaruje wersję `0.7.13`.

## 3. Potwierdzony stan kodu Harness

### 3.1. Endpointy direct

W `src-tauri/src/providers/adapters.rs` są obecnie zapisane:

- OpenAI: `https://api.openai.com/v1`;
- Mistral: `https://api.mistral.ai/v1`;
- Z.AI: `https://api.z.ai/api/paas/v4`;
- DeepSeek: `https://api.deepseek.com`;
- Blackbox: `https://api.blackbox.ai`.

### 3.2. Samplery

W `request_builders.rs` pola `top_p`, `top_k` i `seed` są nadal emitowane wyłącznie dla `Openrouter | CustomOpenai`. `validation.rs` odrzuca ich użycie dla direct providerów. DIRECT-0 nie rozszerza tej bramki.

### 3.3. Limity output

Aktualny builder wysyła:

- OpenAI i OpenRouter: `max_completion_tokens`;
- Mistral, Z.AI, DeepSeek, Blackbox: `max_tokens`.

### 3.4. Mistral nested thinking

Fixture odwzorowuje dokumentowany kształt:

```json
{"content":[{"type":"thinking","thinking":[{"type":"text","text":"reasoning"}]},{"type":"text","text":"final"}]}
```

Aktualny parser poprawnie usuwa część `thinking` z finalnej treści i zachowuje `final`, ale `extract_embedded_reasoning` oczekuje `thinking` jako string i nie schodzi do tablicy `thinking[].text`. Test DIRECT-0 celowo zamraża ten stan jako znaną lukę do DIRECT-1.

## 4. Odświeżenie dokumentacji oficjalnej

Dokumentację sprawdzono ponownie 2026-10-19. Wynik nie zmienia kierunku planu:

- OpenAI Chat Completions dokumentuje `max_completion_tokens` i `top_p`; nie znaleziono `top_k` w kontrakcie Chat Completions. Zgodność parametrów nadal musi być oceniana per model/tryb.
  - https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create
- Mistral Chat API dokumentuje `random_seed`, `reasoning_effort` i sampling; seed nie powinien być wysyłany pod nazwą `seed`.
  - https://docs.mistral.ai/api
- Z.AI Chat Completion dokumentuje `do_sample`, `stream`, `thinking`, `reasoning_effort`, `temperature` i `top_p`; dla GLM-5.3/5.3-FLASH thinking ma szczególne ograniczenia.
  - https://docs.z.ai/api-reference/llm/chat-completion
- DeepSeek dokumentuje modelowo zależne zachowanie `top_p`: Flash i V4 Pro nie mają jednej wspólnej semantyki.
  - https://api-docs.deepseek.com/guides/thinking_mode/
- Blackbox dokumentuje `top_p`, `top_k`, `seed` oraz routing, ale część routingu jest opisana dla `enterprise.blackbox.ai`; obecnego `api.blackbox.ai` nie zmieniono bez live potwierdzenia konta/produktu.
  - https://docs.blackbox.ai/api-reference/parameters
  - https://docs.blackbox.ai/api-reference/provider-routing

## 5. Dodane dowody/fixtures

### `src/providers/direct-compat-fixtures/mistral-nested-thinking-response.json`

Minimalny fixture odpowiedzi potrzebny do DIRECT-1. Nie zawiera danych konta ani kluczy.

### `src/providers/direct-compat-fixtures/direct-provider-contract-baseline.json`

Maszynowo czytelna fotografia DIRECT-0: endpoint, pole output-token, udokumentowane możliwości i status aktualnej bramki sampling.

### `src-tauri/src/providers/tests.rs`

Dodano dwa testy:

- `direct0_characterizes_direct_provider_sampling_gate_without_enabling_it`;
- `direct0_characterizes_mistral_nested_thinking_gap_from_fixture`.

Pierwszy pilnuje, by DIRECT-0 nie włączył samplerów direct bokiem. Drugi odtwarza konkretną lukę Mistral i potwierdza, że widoczny final nie jest tracony.

### `scripts/verify-direct-providers-direct0.mjs`

Verifier bez zależności zewnętrznych sprawdza endpointy, obecną bramkę sampling, nazwy pól output oraz kształt fixture Mistral. Wynik lokalny:

`DIRECT-0 static evidence verification PASS`

## 6. Weryfikacja i ograniczenia środowiska

### PASS

`node scripts/verify-direct-providers-direct0.mjs .` — PASS.

### Rust

Nie uruchomiono `cargo test`, ponieważ w środowisku wykonawczym nie ma programu `cargo` (`cargo: command not found`). Testy Rust zostały dodane, ale ich kompilacja musi zostać potwierdzona przez GitHub Actions / środowisko developerskie z Rust.

### `verify:source`

`npm run verify:source` nie przechodzi na dostarczonym ZIP-ie z powodów istniejących już w bazie: archiwum zawiera ścieżki z literalnymi sekwencjami typu `#U015b`/`#U00f3` oraz niespójne nazwy trzech dokumentów Unicode. DIRECT-0 nie naprawia tego niezwiązanego problemu i nie zmienia tych plików.

### `verify:architecture`

Nie wykonano pełnego verifiera architektury, ponieważ paczka nie zawiera `node_modules`, a środowisko nie ma zainstalowanego `@babel/parser`. DIRECT-0 nie instaluje zależności ani nie modyfikuje lockfile.

## 7. Co DIRECT-0 świadomie NIE robi

- nie dodaje samplerów żadnemu direct providerowi;
- nie naprawia jeszcze parsera Mistral;
- nie dodaje SSE direct;
- nie zmienia OpenAI na Responses API;
- nie zmienia endpointu Blackbox;
- nie dodaje preserved thinking Z.AI;
- nie koduje jednej globalnej semantyki DeepSeek;
- nie wykonuje płatnych smoke testów.

## 8. Następny etap

Naturalny następny krok to `DIRECT-1 — Mistral`: najpierw zmienić charakterystykę nested thinking tak, aby fixture dawał osobno `reasoning_content="reasoning"` i `content="final"`, następnie ocenić replay pełnej wiadomości assistant. Dopiero później dodać translację `seed -> random_seed`, model-aware sampling i SSE.
