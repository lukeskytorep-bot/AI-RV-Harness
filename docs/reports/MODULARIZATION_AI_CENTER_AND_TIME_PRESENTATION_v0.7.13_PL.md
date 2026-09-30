# AI RV Harness v0.7.13 — ekstrakcja AI Center i prezentacja czasu

> **Status:** wykonano lokalnie 3 września 2026  
> **Baza:** `AI_RV_Harness_v0.7.13_MODULARIZATION_TARGETS_MODULE_COMPLETE_SOURCE.zip`  
> **Rodzaj:** kolejny mały krok Etapu 4 oraz osobna, uzgodniona korekta prezentacji czasu

## 1. Zakres modularizacji

- przeniesiono `AiCenterScreen` z ogólnego `src/components/` do `src/features/aiCenter/`;
- dodano publiczny punkt wejścia `src/features/aiCenter/index.ts`;
- `App.tsx` składa moduł przez jego publiczny kontrakt i nadal odpowiada za nawigację, aktywny Profil oraz Workspace-owy panel Monitora;
- reguły tożsamości AI, historii Viewer Notes i aktualizacji wyłącznie w Training pozostały w `src/aiCenter/` oraz warstwie repository;
- nie zmieniono zasad tworzenia, aktywowania ani przywracania Viewer Notes;
- dodano test architektury blokujący powrót ekranu do `src/components/` oraz głębokie importy modułu.

## 2. Uzgodniona korekta czasu

Zmiana dotyczy wyłącznie prezentacji i eksportu. Pole `ChatMessage.createdAt` nadal jest zapisywane bez zmian.

- Conversation pokazuje jedną datę i godzinę utworzenia aktywnego wątku na początku rozmowy;
- Conversation nie pokazuje czasu przy każdej wiadomości;
- Manual RV nie pokazuje daty rozpoczęcia ani czasu przy wiadomościach;
- automatyczne i monitorowane RV Sessions już wcześniej renderowały transkrypt bez znaczników czasu przy każdej wypowiedzi; zachowanie pozostawiono bez zmian;
- eksport Manual RV zachowuje `Utworzono` i `Wyeksportowano` w metadanych, ale nagłówki wiadomości zawierają tylko nazwę autora;
- eksport zwykłej Conversation zachowuje dotychczasowy format, ponieważ nie był przedmiotem zmiany formatu eksportu.

Prezentację wiadomości wydzielono do `src/chat/ChatMessageList.tsx`, aby reguły czasu nie pozostawały ukryte w dużym `App.tsx` i mogły mieć bezpośrednie testy.

## 3. Ochronione granice

Nie zmieniono:

- danych przekazywanych modelowi;
- lokalnego kontekstu czasowego przekazywanego w zwykłej Conversation;
- braku tego kontekstu w Manual RV;
- storage, schematu bazy oraz wartości `createdAt`;
- kolejności protokołów, blind/reveal, Resume, Judge, Monitor ani Training;
- zakresu aktualizacji Viewer Notes.

## 4. Testy odbiorcze

Dodane testy sprawdzają:

- renderowanie AI Center przez publiczny punkt wejścia bez pracy repository podczas renderu;
- jedną datę i godzinę rozpoczęcia w Conversation;
- widoczność tej informacji również przed napisaniem pierwszej wiadomości;
- brak czasu przy wiadomościach Conversation;
- brak daty i czasu w widoku Manual RV;
- obecność czasu sesji w metadanych eksportu Manual RV;
- brak czasu w nagłówkach wiadomości eksportu Manual RV;
- zachowanie nazw autorów, treści i ochrony przed eksportem identyfikatora credential;
- granicę importu modułu AI Center.

## 5. Następny kandydat

Po osobnej weryfikacji tego pakietu następnym preferowanym ekranem jest Research. Workspace, Training oraz RV Sessions pozostają na późniejsze kroki ze względu na większe powiązanie ze stanem wykonania i persistence.
