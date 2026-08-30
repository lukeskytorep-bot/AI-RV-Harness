# Końcowa poprawka CI i CodeQL dla AI RV Harness 0.7.9

Paczka jest przeznaczona do nałożenia na repozytorium 0.7.9 po zatwierdzeniu wygenerowanego pliku `src-tauri/Cargo.lock`.

## Naprawione problemy

- jawny typ konfiguracji `()` dla wtyczki Tauri `pre-migration-backup`, wymagany przez Tauri 2.11.5;
- cztery ostrzeżenia Rust wykryte podczas `cargo test`;
- jednoznaczna kontrola separatora klucza modelu wskazana przez CodeQL;
- całkowita blokada zapisywania metadanych poświadczeń przez przeglądarkowe repozytorium demonstracyjne.

Pełne klucze API nadal są przechowywane wyłącznie przez natywną aplikację w systemowym magazynie poświadczeń. Produkcyjna aplikacja desktopowa przechowuje w SQLite tylko identyfikator, zamaskowaną podpowiedź i fingerprint. Repozytorium przeglądarkowe nie przyjmuje już nawet tych metadanych.

## Zastosowanie

1. Rozpakuj ZIP w katalogu głównym lokalnego repozytorium 0.7.9 i pozwól zastąpić istniejące pliki.
2. Nie zastępuj ponownie pliku `src-tauri/Cargo.lock`; pozostaw wersję wygenerowaną przez workflow `Prepare Cargo lockfile`.
3. W GitHub Desktop wykonaj commit i `Push origin`.
4. Poczekaj na CI oraz CodeQL dla najnowszego commita na `main`.
5. Nie uruchamiaj wydania, jeśli `CI / rust` pozostanie czerwone.
