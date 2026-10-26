# MONITOR STREAM TELEPATHY REPAIR — STEP 1 AUDIT FIX

## Zakres

Poprawka wykonana wyłącznie do STEP 1 po audycie `MONITOR_STREAM_TELEPATHY_STEP_1_AUDIT_PL.md`. Nie rozpoczęto STEP 2.

Schema: 031. Migracje 001–031 bez zmian.

## Naprawione problemy

1. Ręczny Resume Telepathic używa zamrożonego `snapshot.sessionLanguage` zarówno dla output recovery, jak i streaming repetition guard.
2. Parent abort (USER STOP / lease loss) ma terminalny priorytet nad lokalnym runaway. Delty po parent abort i cleanup są ignorowane. Loop wykryty przed późniejszym parent abort nie przykrywa przyczyny parent cancellation, jeśli parent abort nastąpi przed zakończeniem operacji.
3. Streaming guard zachowuje stan fenced block poza 24K tail. Obsługiwane są backticks i tildes oraz granice delt. Linie rysunkowe są maskowane przy zachowaniu identycznych offsetów; naturalny tekst w fence pozostaje skanowany.
4. Recovery po `repetition_runaway` może wykorzystać drugą i ostatnią próbę przy tym samym clamped model ceiling. Recovery po `output_limit` nadal wymaga większego budżetu. Ledger utrwala poprzednią przyczynę przez Resume.
5. Dodano regresje dla parent Stop, queued deltas, długiego fence, naturalnego runaway w fence, tilde/unclosed fence, low ceiling i restartu po pierwszej pętli.
6. Zaktualizowano pięć wcześniejszych testów bez osłabiania kontraktów: propagacja cancel w Lite/Custom, callback streamu Conversation, dwie próby repetition w Lite oraz ochrona Anthropic signed continuation.

## Kontrole lokalne

- Node TypeScript syntax check (`node --experimental-strip-types --check`) dla wszystkich zmienionych TS/TSX: PASS.
- `verify:ux-data`: PASS, 31 migracji.
- `verify:v0.7.14-release-gate`: PASS strukturalny.
- `verify:source`: wynik identyczny z bazą w tym środowisku ekstrakcji; te same odziedziczone resource links i nazwy `#U...`, bez nowej regresji patcha.
- Pełny `npm ci`: NIEZAKOŃCZONY lokalnie z powodu timeoutu transportowego środowiska.
- Pełny typecheck/build/Vitest/architecture: NIEDEKLAROWANE jako PASS; wymagają ponownego uruchomienia w środowisku audytora/CI, gdzie `npm ci` wcześniej przeszedł.
- Native continuation bridge / realny Tauri provider smoke: niewykonane lokalnie.

## Odbiór wymagany

Uruchomić pełny `npm ci --ignore-scripts`, typecheck, build, Vitest, architecture, ux-data, source, release gate oraz native/bridge CI. Szczególnie potwierdzić cztery próby audytowe i brak trzeciej próby semantycznej.

Base SHA-256: 8c640348be226af3b971e1905932fe49656aadd161de361a14cb6707589944be
Previous STEP 1 SHA-256: 586f3943ff64abadae908cd5320a847919e8a387ab39a2e9cbd215975a49a44c
