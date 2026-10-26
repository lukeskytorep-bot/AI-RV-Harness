export function telepathicStageLabel(stage: string, pl: boolean): string {
  const key=stage.split(":")[0];
  const labels:Record<string,[string,string]>={sender_target:["Tworzenie celu","Target creation"],sender_transmission_confirmation:["Potwierdzenie przekazu","Transmission confirmation"],receiver_first:["Pierwszy opis","First description"],receiver_second:["Drugie spojrzenie","Second look"],lead_guidance:["Decyzja prowadzącego","Lead decision"],receiver_guidance:["Prowadzenie","Guidance"],receiver_reveal:["Refleksja po ujawnieniu celu","Post-Reveal reflection"],sender_reveal:["Podsumowanie prowadzącego","Lead summary"],reveal:["Ujawnienie celu","Reveal"],reflection:["Refleksja","Reflection"],sharing_consent:["Zgoda na wypowiedzi innych","Sharing consent"],shared_answers:["Otrzymane wypowiedzi","Received statements"],shared_answers_comment:["Komentarz po wymianie","Post-sharing comment"],series_reflection:["Końcowa refleksja serii","Final series reflection"]};
  const cycle=stage.match(/cycle:(\d)/)?.[1];
  return (labels[key]?.[pl?0:1] ?? key)+(cycle?` · ${pl?"cykl":"cycle"} ${cycle}`:"");
}
