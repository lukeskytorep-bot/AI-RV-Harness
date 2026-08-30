# AI RV Harness v0.7.6 — informacje o wydaniu

Data źródła: 2026-08-19

Wydanie 0.7.6 rozwija kompletne źródło 0.7.5. Nie wymaga kasowania istniejącej bazy ani ręcznego odtwarzania profili. Migracje SQLite pozostają addytywne, a ustawienia już zapisane przez użytkownika zachowują swoje jawne wartości.

## Najważniejsze zmiany

- przenośny backup zapisywany w folderze wybranym przez użytkownika;
- przywracanie z wybranego zewnętrznego folderu, z kontrolą manifestu i sum SHA-256 przed zamknięciem bazy;
- obowiązkowa wewnętrzna kopia bezpieczeństwa bezpośrednio przed przywróceniem;
- usunięcie z ekranu zwykłego użytkownika technicznej listy backupów, ścieżek, hashy oraz dublującego eksportu snapshotu;
- domyślnie duży tekst i pomijanie fabrycznych celów treningowych użytych wcześniej przez wybrany Profil na nowych instalacjach;
- zwykłe automatyczne sesje RV korzystają wyłącznie z `Moich celów`; 84 cele fabryczne są przeznaczone do Training AI;
- jednoznaczna opcja `Cel podany po sesji` z opisem Revealu tekstowego, obrazowego lub mieszanego;
- częściowy trening rozpoczyna się od wartości zero we wszystkich kategoriach;
- rozwijana historia Training i Research z kompletnym podglądem sesji;
- zapis pojedynczej pełnej sesji do wskazanego folderu wraz z Revelem, rozmową po Revealu, wynikami Judge i lokalnymi mediami;
- zapis całego treningu lub researchu do wskazanego folderu, z czytelnymi plikami sesji oraz podsumowaniem HTML/CSV;
- losowy wybór celów Research odbywa się automatycznie przy Preflight/Experiment Lock i zostaje zamrożony;
- transkrypty Full RCP, RV Lite i Custom Protocol zawierają dokładne polecenia wysłane do Viewera;
- polska sesja używa zatwierdzonego polskiego promptu Viewera z określeniami `AI Jest Być` i `Strefa Cienia`;
- nowa konserwatywna „gilotyna” nie przerywa sesji z powodu prawidłowo powtarzanych deskryptorów RV; skraca i oznacza jedynie jednoznacznie uszkodzony ogon generacji;
- edycja Profilu zachowuje widoczne przyciski w zmniejszonym oknie programu;
- wersje aplikacji zsynchronizowane jako `0.7.6` w frontendzie, konfiguracji Tauri, Cargo i nagłówku klienta API.

## Licencje

Source code is licensed under the MIT License. Documentation, bundled prompts, training content, and other non-code visual assets are licensed under CC BY 4.0.

## Weryfikacja

Paczka źródłowa jest przeznaczona do zastąpienia zawartości repozytorium na gałęzi `main`. Workflow `CI` sprawdza TypeScript, Vitest, build Vite, Rust i Clippy. Workflow `Release Windows`, uruchamiany ręcznie, buduje instalator Tauri i tworzy szkic GitHub Release.
