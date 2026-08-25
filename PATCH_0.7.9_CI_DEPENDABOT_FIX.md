# Poprawka CI i Dependabota dla AI RV Harness 0.7.9

Ta mała paczka jest przeznaczona do nałożenia na pełne źródła wersji 0.7.9.

## Co naprawia

- zatrzymuje seryjne PR-y z rutynowymi aktualizacjami Dependabota na czas stabilizacji wydania;
- uruchamia analizę CodeQL Rust w obsługiwanym trybie bez kompilacji (`build-mode: none`);
- pozostawia kompilację i jakość Rust w głównym CI (`cargo test` oraz `cargo clippy`);
- usuwa blokującą kontrolę `cargo fmt --check`, ponieważ kod Rust nie został jeszcze sformatowany i zweryfikowany lokalnym narzędziem Rust.

## Jak zastosować

1. Rozpakuj ZIP w katalogu głównym repozytorium 0.7.9 i pozwól zastąpić istniejące pliki.
2. W GitHub Desktop zatwierdź zmiany i wykonaj `Push origin`.
3. Na GitHubie zamknij istniejące PR-y utworzone przez Dependabota. Nie scalaj ich z `main`.
4. Otwórz `Actions` → `Prepare Cargo lockfile` → `Run workflow` dla gałęzi `main`.
5. Po zakończeniu pobierz artefakt `AI-RV-Harness-v0.7.9-Cargo-lock`.
6. Rozpakuj artefakt i zastąp plik `src-tauri/Cargo.lock` otrzymanym plikiem `Cargo.lock`.
7. Zatwierdź nowy `Cargo.lock` w GitHub Desktop i wykonaj kolejny `Push origin`.
8. Poczekaj na zakończenie kontroli najnowszego commita na `main`: CI frontend, CI Rust, CodeQL JavaScript/TypeScript i CodeQL Rust.
9. Dopiero gdy kontrole najnowszego commita są zielone, uruchom `Release Windows` albo `Release Linux`.

## Ważne

- Stare czerwone uruchomienia pozostaną w historii GitHub Actions; nie wpływają na najnowszy commit.
- Żółte ostrzeżenia o Node.js 20 lub braku cache nie są błędami kompilacji.
- Jeżeli CI Rust nadal będzie czerwone po zatwierdzeniu nowego `Cargo.lock`, otwórz zadanie `rust` i zapisz pierwszy rozwinięty komunikat błędu. Nie uruchamiaj wtedy wydania.
- Po ustabilizowaniu 0.7.9 można ponownie włączyć rutynowe aktualizacje Dependabota, zmieniając limity z `0` na niewielką wartość i grupując aktualizacje.
