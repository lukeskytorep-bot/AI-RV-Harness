# AI RV Harness v0.7.13 — AI Judge System Prompt w About & Protocols

**Data:** 5 września 2026  
**Zakres:** widoczność i zapis centralnego promptu AI Judge’a  
**Ryzyko:** niskie

## Wykonane zmiany

- po AI Viewer System Prompt i AI Monitor System Prompt dodano kartę AI Judge System Prompt;
- karta udostępnia osobno wersję polską i angielską;
- dialog pokazuje identyfikator `ai-rv-harness-blind-judge`, wersję `1.0.0` oraz licencję CC BY 4.0;
- przycisk zapisu korzysta z istniejącego mechanizmu zapisywania promptów do Markdown;
- treść nie jest skopiowana do UI: zasób korzysta bezpośrednio z `getJudgePrompt(language)` w `src/judge/prompt.ts`;
- test potwierdza kolejność Viewer → Monitor → Judge oraz identyczność zasobu PL/EN z promptem runtime.

Zmiana nie wpływa na wykonywanie ocen. AI Judge w Training, zwykłych RV Sessions i Research nadal otrzymuje ten sam centralny prompt zależny wyłącznie od języka zapisanej sesji.

## Weryfikacja

Zmiana weszła do tego samego pełnego przebiegu: **98 plików testowych / 294 testy**, typecheck i produkcyjny build Vite — zaliczone.
