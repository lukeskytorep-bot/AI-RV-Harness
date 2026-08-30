# AI RV Harness v0.7.12 — plan wdrożenia AI Center

Status: wdrożony kandydat do testów. Baza: publiczne v0.7.11.

## Cel

AI Center jest osobną główną sekcją aplikacji, niezależną od pojedynczego Workspace. Działa dla aktywnego Profilu i łączy istniejący AI Monitor, rejestr dokładnych AI Identities oraz eksperymentalne Viewer Notes. Monitor Notes, pamięć Judge i Continuous Conversation pozostają poza v0.7.12.

## Zatwierdzone reguły Viewer Notes

- Właścicielem notatek jest dokładna kombinacja: Profil + pseudonim credential/API identity + provider i endpoint + model route + rola Viewer.
- Notatki działają we wszystkich Workspace’ach tego samego Profilu, lecz nigdy nie są przenoszone między modelami, credentialami ani rolami.
- W obsługiwanych sesjach przełącznik jest prosty i domyślnie włączony.
- Przed rozpoczęciem sesji powstaje niezmienny snapshot. Sesja nie pobiera nowszej wersji w połowie przebiegu.
- Notatki są osobnym, oznaczonym blokiem systemowym tylko do odczytu. Nie zastępują System Promptu ani protokołu.
- Refleksja jest wykonywana przez tę samą trasę Viewera po Revealu i jego własnej ocenie, ale przed oceną Monitora.
- Monitor, Judge i późniejsza rozmowa po Revealu nie są przekazywane do refleksji.
- Model zwraca pełną nową wersję `UPDATE` albo `NO_CHANGE`; aplikacja nie stosuje tekstowych patchy.
- Poprawna wersja staje się aktywna bez akceptacji człowieka. Treść nie ma edytora ręcznego.
- Wersje są niezmienne. Człowiek może przywrócić wcześniejszą wersję po ostrzeżeniu, a operacja zostaje zapisana jako `human_restore`.
- Pojemność: 1024, 2048, 4096 lub 8192 tokenów estymowanych konserwatywnie jako `ceil(chars / 3.5 × 1.15)`. Nie wolno obcinać treści po cichu.
- Limit można zmniejszyć tylko wtedy, gdy aktywna treść mieści się w nowej pojemności.
- Aktualizacja używa optimistic concurrency: refleksja oparta na nieaktualnej wersji nie może nadpisać nowszych notatek.

## Kolejność zdarzeń

1. Przed sesją aplikacja identyfikuje dokładnego Viewera i zapisuje snapshot aktywnych notatek.
2. Viewer wykonuje część blind bez dostępu do Revealu.
3. Aplikacja pieczętuje dowód pre-Reveal.
4. Viewer otrzymuje Reveal i przygotowuje własną ocenę.
5. Jeśli Notes były włączone, ta sama trasa otrzymuje pakiet refleksji: bieżące notatki, sealed Viewer evidence, Reveal oraz własną ocenę Viewera.
6. Aplikacja przyjmuje `UPDATE` albo `NO_CHANGE`, sprawdza JSON, pojemność, delimitery i zgodność wersji bazowej.
7. Dopiero potem może zostać wykonana opinia AI Monitora.

## Research

Szablon `Viewer Notes Impact` porównuje dokładnie dwa warunki: `No Notes` oraz `Frozen Notes`. Użytkownik wybiera jedną z pięciu ostatnich wersji tego samego Viewera. Pełna treść, hash, wersja, tożsamość i warunek są częścią Experiment Lock. Aktualizacje notatek są wyłączone w Research, więc pamięć nie zmienia się między sesjami. Judge otrzymuje wyłącznie dotychczasowy anonimowy pakiet dowodowy i nie zna przydziału warunku. Ocena 3+3+2+2 oraz freeze-before-unblind pozostają bez zmian.

## Odporność i audyt

- Własne tabele SQLite przechowują identities, settings, reflection runs, immutable versions i activation events.
- Triggery blokują edycję/usunięcie wersji i aktywację wersji należącej do innej tożsamości.
- Błędy providera, parsera, schematu, pojemności i stale-base nie niszczą aktywnej wersji.
- Jedna próba naprawy dotyczy wyłącznie formatu JSON i używa tej samej trasy modelu; nie zmienia merytorycznej decyzji.
- Reasoning pozostaje w osobnym kanale providera. Do parsera trafia finalna odpowiedź, nie ukryte rozumowanie.
- Obrazy Revealu są przekazywane tej samej trasie Viewera, jeśli refleksja ich wymaga i model obsługuje vision.

## Kryteria odbioru

- Migracja istniejącej bazy nie usuwa danych v0.7.11.
- AI Center jest dostępne z lewego menu i działa dla wszystkich Workspace’ów aktywnego Profilu.
- Sesje z Notes ON/OFF dają odtwarzalne snapshoty.
- Nie powstają duplikaty po retry, a równoległe refleksje nie nadpisują nowszej wersji.
- Monitor review następuje po refleksji Viewera.
- Research zamraża wybraną wersję i zachowuje blinding Judge.
- TypeScript, Vitest, build Vite oraz wymagane kontrole Rust/Clippy przechodzą przed publikacją.

