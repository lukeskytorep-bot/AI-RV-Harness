import { useEffect, useState } from "react";

/** Compare during render as well as clearing on drift, so Start never sees stale approval. */
export function useTelepathicSetupConfirmation(participantsKey: string, participantsValid: boolean, leadKey: string, leadValid: boolean, context: unknown) {
  const [participantsSnapshot, setParticipantsSnapshot] = useState<string | null>(null);
  const [leadSnapshot, setLeadSnapshot] = useState<string | null>(null);
  useEffect(() => { setParticipantsSnapshot(null); setLeadSnapshot(null); }, [participantsKey, context]);
  useEffect(() => { setLeadSnapshot(null); }, [leadKey]);
  const participantsConfirmed = participantsValid && participantsSnapshot === participantsKey;
  const leadConfirmed = participantsConfirmed && leadValid && leadSnapshot === leadKey;
  return {
    participantsConfirmed, leadConfirmed,
    confirmParticipants() { if (participantsValid) { setParticipantsSnapshot(participantsKey); setLeadSnapshot(null); } },
    editParticipants() { setParticipantsSnapshot(null); setLeadSnapshot(null); },
    confirmLead() { if (participantsConfirmed && leadValid) setLeadSnapshot(leadKey); },
    editLead() { setLeadSnapshot(null); },
  };
}
