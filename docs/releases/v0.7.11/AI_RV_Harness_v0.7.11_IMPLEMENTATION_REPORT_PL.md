# AI RV Harness v0.7.11 — raport implementacji zgodności reasoning

**Baza:** publiczne `v0.7.10`, commit `95e25c8b3a89e399c796264db46a874be758418b`  
**Wersja docelowa:** `0.7.11`  
**Zakres:** centralna normalizacja reasoning/final content i naprawa przepływu AI Monitora

## Zaimplementowane zmiany

### 1. Wspólny kontrakt odpowiedzi providera

`ProviderChatResponse` otrzymał osobne pola:

- `content` — wyłącznie finalna wypowiedź modelu;
- `reasoningContent` — reasoning/thinking;
- `reasoningDetails` — opcjonalne bloki strukturalne;
- `reasoningSource` — informacja, z którego formatu pochodzi reasoning.

Zmiana działa centralnie, więc obejmuje AI Monitor, Viewera, Conversation, Manual RV, Research, Judge i wywołania po Revealu. Istniejący kod nadal korzysta z `content`, ale otrzymuje już tylko finalną treść.

### 2. Obsługiwane formaty

Backend Rust rozdziela:

- OpenAI/OpenRouter-compatible: `reasoning`, `reasoning_content`, `reasoning_details`, `thinking` i typowane części tablic;
- Google: części `thought: true` od zwykłych części tekstowych;
- Anthropic: `thinking` i `redacted_thinking` od bloków `text`;
- znane znaczniki fallback: `<think>`, `<thinking>`, `<reason>`, `<reasoning>`, `<thought>` oraz `<|begin_of_thought|>`.

Nie ma heurystyk opartych na stylu tekstu ani słowach takich jak „Wait” lub „Let me think”. Niezamknięty blok reasoning bez finalnej wypowiedzi jest traktowany jako odpowiedź niedokończona.

### 3. Brak cenzury polecenia Monitora

AI Monitor używa wyłącznie finalnego `content`:

- dokładne `CONTINUE_PROTOCOL` steruje kontrolerem;
- każda inna niepusta finalna treść jest przekazywana Viewerowi w całości;
- Harness nie skraca, nie przepisuje i nie ogranicza liczby zdań.

### 4. Budżet i odzyskiwanie

Usunięto stały limit 800 tokenów dla AI Monitora.

- pierwsza próba: do 4096 tokenów;
- kontrolowana kolejna próba: do 8192 tokenów;
- każda wartość jest ograniczana maksimum raportowanym przez trasę modelu;
- istniejące ustawienie reasoning i natywny transport providera pozostają włączone.

Reasoning bez finalnego `content` oraz odpowiedź Monitora zakończona przez `length`/`max_tokens` nie trafiają do Viewera. Błąd kwalifikuje się do jednej kontrolowanej próby zgodnie z ustawieniami retry.

### 5. Telemetria i wznowienie

Reasoning nie trafia do sealed transcript. Telemetria zapisuje jego źródło i rozmiar, natomiast pełny surowy payload pozostaje dostępny tylko w istniejącym, świadomie włączanym trybie szczegółowej diagnostyki.

Niedokończona odpowiedź Monitora jest oznaczana jako nieudana, dzięki czemu mechanizm `Kontynuuj` nie odtworzy jej jako zapisanej interwencji. Finalna interwencja nie jest dublowana.

### 6. Wersjonowanie

Do `0.7.11` zaktualizowano:

- `package.json` i `package-lock.json`;
- `src/version.ts`;
- `src-tauri/tauri.conf.json`;
- `src-tauri/Cargo.toml`;
- wpis głównego pakietu w `src-tauri/Cargo.lock`.

Dodano test spójności wersji frontendu, pakietu npm i konfiguracji Tauri.

## Testy regresyjne

Dodane testy obejmują między innymi:

- natywne pola OpenRouter/DeepSeek i `reasoning_details`;
- Ollama-style `thinking`;
- typowane części reasoning w tablicy `content`;
- reasoning bez finalnej odpowiedzi i `finish_reason: length`;
- zamknięte i niezamknięte tagi reasoning;
- wszystkie wspierane pary tagów bez heurystyk semantycznych;
- Google `thought: true`;
- Anthropic `thinking`, `redacted_thinking` i finalny `text`;
- zwykły model bez reasoning;
- wielozdaniową finalną instrukcję Monitora przekazaną bez zmian;
- zwiększenie budżetu 4096 → 8192 przy retry;
- brak powtórzenia pracy Viewera;
- regresję Protokołu Telepatycznego: reasoning po kroku 7 nie wywołuje wcześniejszego ani podwójnego kroku 8;
- replay pomijający niedokończoną telemetrię Monitora.

## Wynik lokalnej weryfikacji

- TypeScript: OK;
- Vitest: `193/193` testy, `71/71` plików;
- Vite production build: OK;
- npm audit: 0 podatności;
- `git diff --check`: OK.

Rust nie był dostępny w lokalnym środowisku wykonawczym, dlatego testy parserów Rust oraz Clippy muszą zostać ostatecznie potwierdzone przez istniejący GitHub CI. Testy Rust są dołączone do źródeł i uruchomią się w workflowie.

## Pozostała weryfikacja ręczna

Przed publicznym wydaniem należy wykonać rzeczywiste sesje DeepSeek, NVIDIA/Nemotron i Google oraz sprawdzić pola odpowiedzi w zredagowanej diagnostyce. Release Notes nie są częścią tej paczki — powinny powstać po testach praktycznych.
