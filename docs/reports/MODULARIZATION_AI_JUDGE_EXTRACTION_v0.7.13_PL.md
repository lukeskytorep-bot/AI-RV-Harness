# AI RV Harness v0.7.13 — ekstrakcja modułu AI Judge i wspólna prezentacja wyników

**Data:** 5 września 2026  
**Zakres:** kolejny kontrolowany krok Etapu 4 modularizacji  
**Charakter zmiany:** refaktoryzacja modułu oraz uzgodnione ujednolicenie prezentacji i eksportu; bez zmiany zasad oceniania

## Punkt wyjścia

Zmianę wykonano na pełnym źródle po ekstrakcji Workspaces/Conversations i dodaniu centralnego promptu AI Judge do About & Protocols. Przed pracą ponownie odczytano aktywny plan modularizacji oraz bieżący indeks Biblioteki. Plan wskazywał wybór jednego chronionego panelu z bloku RV Sessions/Monitor/Judge. Wybrano Judge, bez równoczesnego przenoszenia RV Sessions ani Monitora.

Inspekcja wykazała, że runtime używał jednego promptu, silnika i rekordu wyniku, lecz pełna RV Session, `SessionInspection`, Training i Research posiadały różne prezentacje tych samych zamrożonych danych. Eksporty zwykłej sesji, Training i Research składały również sekcję Judge'a oddzielnie.

## Wykonane zmiany

- utworzono `src/features/judge/` z publicznym `index.ts`;
- przeniesiono z `App.tsx` interaktywne `JudgeEvaluation` i `BatchEvaluation`;
- zachowano konfigurację 1–3 Judge'ów, odzyskiwanie zapisanych wyników, możliwość dodania kolejnego Judge'a i istniejące wywołanie `runBlindJudging`;
- utworzono wspólny `src/components/JudgeResults.tsx` używany przez aktywną RV Session oraz `SessionInspection`;
- Training i Research, które korzystają z `SessionInspection`, pokazują teraz ten sam pełny układ wyniku co zwykła RV Session;
- wspólny układ zawiera model, wynik całkowity, cztery składowe 3+3+2+2, trafienia, chybienia/sprzeczności, obserwacje konfabulacji/AOL i uzasadnienie;
- dla kilku Judge'ów wspólny układ pokazuje średnią, medianę, rozrzut i odchylenie standardowe;
- utworzono `src/exports/sessionDocument.ts` jako jedynego właściciela kompletnego czytelnego dokumentu sesji oraz sekcji Judge'a;
- zwykły eksport RV Session, eksport pojedynczych sesji w całym Training i eksport Research używają tego samego generatora;
- zachowano `summary.md` Training oraz osobne pakowanie i granice blindingu Research;
- usunięto martwe style dawnej skróconej listy wyników w `SessionInspection`;
- zaktualizowano `CODE_MAP.md`, `MODULE_BOUNDARIES.md` i test granic architektonicznych.

## Zachowane granice bezpieczeństwa

Nie zmieniono:

- `src/judge/prompt.ts` ani tekstu promptu PL/EN;
- `src/judge/engine.ts` ani logiki wywołania, naprawy JSON, korekty języka i atomowego zamrażania grupy ocen;
- `src/domain/judgePacket.ts` ani allowlisty danych przekazywanych Judge'owi;
- `src/domain/scoring.ts`, rubryki 3+3+2+2 ani agregacji;
- formatu rekordów persistence i schematu bazy;
- kolejności sesji, Revealu, Viewer Review ani zasad Resume;
- granic anonimowości eksportu Research.

Sumy SHA-256 tych czterech chronionych plików są identyczne z poprzednim pełnym baseline'em Biblioteki.

## Testy

Dodano lub rozszerzono testy, które potwierdzają:

- renderowanie pełnego wyniku przez publiczny punkt wejścia modułu Judge;
- brak statystyk wielu Judge'ów przy pojedynczej ocenie i ich obecność przy wielu ocenach;
- kompletność wszystkich pól w polskim i angielskim rendererze Markdown;
- wspólną kolejność sekcji dokumentu z metadanymi oraz w anonimowym wariancie Research;
- obecność pełnej rubryki i narracji w zwykłym eksporcie sesji i w sesji wewnątrz eksportu Training;
- użycie wspólnego generatora przez RV Session, Training i Research;
- brak implementacji interfejsu Judge w `App.tsx` i brak głębokich importów modułu.

## Weryfikacja

- pełny zestaw: **100 plików testowych / 301 testów zaliczonych**;
- typecheck: zaliczony;
- produkcyjny build Vite: zaliczony;
- `App.tsx`: zmniejszony z 1923 do 1680 linii;
- chroniony prompt, engine, packet i scoring: SHA-256 zgodne z poprzednim baseline'em;
- nie zmieniono plików Rust/Tauri; standardowe końcowe potwierdzenie pozostaje po stronie GitHub Actions po zastosowaniu paczki.

## Następny krok

Po zielonym GitHub Actions następnym kontrolowanym kandydatem Etapu 4 powinien być jeden z dwóch pozostałych chronionych paneli: RV Sessions albo Monitor. Nie należy przenosić obu równocześnie.
