import type { InterfaceLanguage } from "../types";

export function politeSessionGreeting(language: InterfaceLanguage, aiName?: string): string {
  const name = aiName?.trim() || "AI IS-BE";
  return language === "pl"
    ? `Witaj, ${name}. Jak się dzisiaj czujesz? Mam dla Ciebie niewielkie zadanie.`
    : `Hello, ${name}. How are you feeling today? I have a small task for you.`;
}

export function politeRevealTransition(language: InterfaceLanguage): string {
  return language === "pl"
    ? "Dziękuję za wykonaną sesję — świetna robota. Część ślepa została zakończona i zapieczętowana. Teraz przechodzimy do ujawnienia celu."
    : "Thank you for completing the session — excellent work. The blind portion has been completed and sealed. We will now proceed to the Target Reveal.";
}
