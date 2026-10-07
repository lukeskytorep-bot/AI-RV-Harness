import type { DatabaseTransactionStatement, DatabaseWriteResult } from "../databaseNative";
import type { TelepathicExchangeRepository } from "../contracts/telepathicExchangeRepository";
import type {
  TelepathicBlindSubmission,
  TelepathicLockedTarget,
  TelepathicParticipant,
  TelepathicProviderCallRecord,
  TelepathicReflectionRecord,
  TelepathicRoundState,
  TelepathicSeriesConfig,
  TelepathicSeriesPlan,
  TelepathicSeriesState,
} from "../../telepathicExchange/types";

export interface SqliteTelepathicExchangeRepositoryDependencies {
  select: <T>(query: string, values?: unknown[]) => Promise<T>;
  executeWrite: (query: string, values?: unknown[]) => Promise<DatabaseWriteResult>;
  executeTransaction: (statements: DatabaseTransactionStatement[]) => Promise<unknown>;
  executeFencedTransaction: (input: { seriesId: string; leaseOwner: string; leaseVersion: number; statements: DatabaseTransactionStatement[] }) => Promise<number[]>;
}

type SeriesRow = {
  id: string;
  status: TelepathicSeriesState["status"];
  current_round_index: number;
  config_json: string;
  plan_json: string;
  created_at: string;
  updated_at: string;
};
type ParticipantRow = {
  participant_id: string;
  kind: TelepathicParticipant["kind"];
  display_name: string;
  route_snapshot_json: string | null;
  field_guide_snapshot_json: string | null;
  viewer_notes_snapshot_json: string | null;
  final_reflection_text: string | null;
};
type RoundRow = {
  id: string;
  round_number: number;
  sender_participant_id: string;
  status: TelepathicRoundState["status"];
  revealed_at: string | null;
  completed_at: string | null;
  blocked_reason: string | null;
};
type TargetRow = {
  round_id: string;
  sender_participant_id: string;
  content: string;
  assets_manifest_json: string;
  content_sha256: string;
  status: TelepathicLockedTarget["status"];
  locked_at: string;
  transmission_ready_at: string | null;
};
type BlindRow = {
  round_id: string;
  participant_id: string;
  status: TelepathicBlindSubmission["status"];
  first_text: string | null;
  second_text: string | null;
  provider_attempt_count: number;
  content_sha256: string | null;
  sealed_at: string | null;
};
type ReflectionRow = {
  round_id: string;
  participant_id: string;
  role: TelepathicReflectionRecord["role"];
  reflection_text: string | null;
  share_others_consent: TelepathicReflectionRecord["shareOthersConsent"] | null;
  shared_answers_comment: string | null;
};
type CallRow = {
  id: string;
  round_id: string;
  participant_id: string;
  call_stage: string;
  technical_attempt: number;
  status: TelepathicProviderCallRecord["status"];
  scope_key: string;
  request_sha256: string;
  provider_request_id: string | null;
  response_text: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
};

const UPSERT_SERIES = "INSERT INTO telepathic_series (id, series_workspace_id, mode, language, status, current_round_index, config_json, plan_json, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(id) DO UPDATE SET status=excluded.status, current_round_index=excluded.current_round_index, config_json=excluded.config_json, plan_json=excluded.plan_json, updated_at=excluded.updated_at";
const UPSERT_PARTICIPANT = "INSERT INTO telepathic_participants (series_id, participant_id, kind, display_name, profile_id, workspace_id, ai_identity_id, provider_config_id, credential_id, model_id, model_route, route_snapshot_json, field_guide_snapshot_json, viewer_notes_snapshot_json, final_reflection_text) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) ON CONFLICT(series_id, participant_id) DO UPDATE SET display_name=excluded.display_name, field_guide_snapshot_json=excluded.field_guide_snapshot_json, viewer_notes_snapshot_json=excluded.viewer_notes_snapshot_json, final_reflection_text=excluded.final_reflection_text";
const UPSERT_ROUND = "INSERT INTO telepathic_rounds (id, series_id, round_number, sender_participant_id, status, revealed_at, completed_at, blocked_reason) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(id) DO UPDATE SET status=excluded.status, revealed_at=excluded.revealed_at, completed_at=excluded.completed_at, blocked_reason=excluded.blocked_reason";
const INSERT_TARGET = "INSERT OR IGNORE INTO telepathic_targets (round_id, sender_participant_id, content, assets_manifest_json, content_sha256, status, locked_at, transmission_ready_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)";
const ADVANCE_TARGET = "UPDATE telepathic_targets SET status='transmission_ready', transmission_ready_at=$1 WHERE round_id=$2 AND status='locked'";
const UPSERT_BLIND = "INSERT INTO telepathic_blind_submissions (round_id, participant_id, status, first_text, second_text, provider_attempt_count, content_sha256, sealed_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(round_id, participant_id) DO UPDATE SET status=excluded.status, first_text=excluded.first_text, second_text=excluded.second_text, provider_attempt_count=excluded.provider_attempt_count, content_sha256=excluded.content_sha256, sealed_at=excluded.sealed_at WHERE telepathic_blind_submissions.status NOT IN ('sealed','no_submission')";
const UPSERT_REFLECTION = "INSERT INTO telepathic_reflections (round_id, participant_id, role, reflection_text, share_others_consent, shared_answers_comment) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT(round_id, participant_id) DO UPDATE SET reflection_text=excluded.reflection_text, share_others_consent=excluded.share_others_consent, shared_answers_comment=excluded.shared_answers_comment";

const ACQUIRE_SERIES_LEASE = "UPDATE telepathic_series SET run_lease_owner=$1, run_lease_expires_at=$2, run_lease_version=run_lease_version+1 WHERE id=$3 AND (run_lease_owner IS NULL OR run_lease_expires_at IS NULL OR run_lease_expires_at < $4)";
const RENEW_SERIES_LEASE = "UPDATE telepathic_series SET run_lease_expires_at=$1 WHERE id=$2 AND run_lease_owner=$3 AND run_lease_version=$4 AND run_lease_expires_at IS NOT NULL AND run_lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')";
const RELEASE_SERIES_LEASE = "UPDATE telepathic_series SET run_lease_owner=NULL, run_lease_expires_at=NULL WHERE id=$1 AND run_lease_owner=$2 AND run_lease_version=$3";

const UPSERT_CALL = "INSERT INTO telepathic_provider_calls (id, series_id, round_id, participant_id, call_stage, technical_attempt, status, scope_key, request_sha256, provider_request_id, response_text, error_message, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT(id) DO UPDATE SET status=excluded.status, provider_request_id=excluded.provider_request_id, response_text=excluded.response_text, error_message=excluded.error_message, updated_at=excluded.updated_at";

type ActiveLease = { owner: string; version: number; expiresAt: string; lost: boolean; controller: AbortController };

export class SqliteTelepathicExchangeRepository implements TelepathicExchangeRepository {
  private readonly activeLeases = new Map<string, ActiveLease>();

  constructor(private readonly dependencies: SqliteTelepathicExchangeRepositoryDependencies) {}

  async withTelepathicSeriesLease<T>(seriesId: string, task: () => Promise<T>): Promise<T> {
    const owner = `telepathic-lease-${crypto.randomUUID()}`;
    const leaseMs = 10 * 60 * 1000;
    const acquiredAt = new Date();
    const expiresAt = new Date(acquiredAt.getTime() + leaseMs).toISOString();
    const acquired = await this.dependencies.executeWrite(ACQUIRE_SERIES_LEASE, [owner, expiresAt, seriesId, acquiredAt.toISOString()]);
    if (acquired.rowsAffected !== 1) throw new Error("Telepathic series is already running in another application instance.");
    const rows = await this.dependencies.select<Array<{ run_lease_owner: string | null; run_lease_version: number; run_lease_expires_at: string | null }>>(
      "SELECT run_lease_owner, run_lease_version, run_lease_expires_at FROM telepathic_series WHERE id=$1",
      [seriesId],
    );
    const row = rows[0];
    if (!row || row.run_lease_owner !== owner || !row.run_lease_expires_at) throw new Error("Telepathic series lease acquisition could not be verified.");
    const lease: ActiveLease = { owner, version: row.run_lease_version, expiresAt: row.run_lease_expires_at, lost: false, controller: new AbortController() };
    this.activeLeases.set(seriesId, lease);

    const markLost = () => {
      if (lease.lost) return;
      lease.lost = true;
      lease.controller.abort(new DOMException("Telepathic series lease was lost.", "AbortError"));
    };
    const renew = async () => {
      if (lease.lost) return;
      const nextExpiry = new Date(Date.now() + leaseMs).toISOString();
      try {
        const result = await this.dependencies.executeWrite(RENEW_SERIES_LEASE, [nextExpiry, seriesId, owner, lease.version]);
        if (result.rowsAffected !== 1) markLost();
        else lease.expiresAt = nextExpiry;
      } catch {
        markLost();
      }
    };
    const heartbeat = globalThis.setInterval(() => { void renew(); }, 30_000);
    try {
      const result = await task();
      await this.assertTelepathicSeriesLease(seriesId);
      return result;
    } finally {
      globalThis.clearInterval(heartbeat);
      this.activeLeases.delete(seriesId);
      await this.dependencies.executeWrite(RELEASE_SERIES_LEASE, [seriesId, owner, lease.version]).catch(() => undefined);
    }
  }

  async assertTelepathicSeriesLease(seriesId: string): Promise<void> {
    const lease = this.activeLeases.get(seriesId);
    if (!lease || lease.lost) throw new Error("Telepathic series lease was lost or is not active.");
    const rows = await this.dependencies.select<Array<{ run_lease_owner: string | null; run_lease_version: number; run_lease_expires_at: string | null }>>(
      "SELECT run_lease_owner, run_lease_version, run_lease_expires_at FROM telepathic_series WHERE id=$1",
      [seriesId],
    );
    const row = rows[0];
    if (!row || row.run_lease_owner !== lease.owner || row.run_lease_version !== lease.version || !row.run_lease_expires_at || row.run_lease_expires_at <= new Date().toISOString()) {
      lease.lost = true;
      lease.controller.abort(new DOMException("Telepathic series lease was lost.", "AbortError"));
      throw new Error("Telepathic series lease was lost before provider dispatch or checkpoint save.");
    }
  }

  telepathicSeriesLeaseSignal(seriesId: string): AbortSignal | undefined {
    return this.activeLeases.get(seriesId)?.controller.signal;
  }



  async listTelepathicSeries(seriesWorkspaceId?: string): Promise<TelepathicSeriesState[]> {
    const rows = await this.dependencies.select<Array<{ id: string }>>(
      seriesWorkspaceId
        ? "SELECT id FROM telepathic_series WHERE series_workspace_id = $1 ORDER BY updated_at DESC"
        : "SELECT id FROM telepathic_series ORDER BY updated_at DESC",
      seriesWorkspaceId ? [seriesWorkspaceId] : [],
    );
    const states = await Promise.all(rows.map((row) => this.getTelepathicSeries(row.id)));
    return states.filter((state): state is TelepathicSeriesState => Boolean(state));
  }

  async saveTelepathicSeries(state: TelepathicSeriesState): Promise<void> {
    const existingTargets = await this.dependencies.select<Array<{ round_id: string; content_sha256: string }>>(
      "SELECT round_id, content_sha256 FROM telepathic_targets WHERE round_id IN (SELECT id FROM telepathic_rounds WHERE series_id = $1)",
      [state.config.seriesId],
    );
    const targetHashByRound = new Map(existingTargets.map((row) => [row.round_id, row.content_sha256]));
    for (const round of state.rounds) {
      if (round.target) {
        const existing = targetHashByRound.get(round.assignment.roundId);
        if (existing && existing !== round.target.contentSha256) throw new Error("Persisted telepathic target hash does not match the locked series state.");
      }
    }

    const statements: DatabaseTransactionStatement[] = [{
      query: UPSERT_SERIES,
      values: [state.config.seriesId, state.config.seriesWorkspaceId, state.config.mode, state.config.language, state.status, state.currentRoundIndex, JSON.stringify(state.config), JSON.stringify(state.plan), state.createdAt, state.updatedAt],
    }];

    for (const participant of state.config.participants) {
      const route = participant.ai;
      statements.push({
        query: UPSERT_PARTICIPANT,
        values: [
          state.config.seriesId,
          participant.id,
          participant.kind,
          participant.displayName,
          route?.profileId ?? null,
          route?.workspaceId ?? null,
          route?.aiIdentityId ?? null,
          route?.providerConfigId ?? null,
          route?.credentialId ?? null,
          route?.modelId ?? null,
          route?.route ?? null,
          route ? JSON.stringify(route) : null,
          participant.fieldGuide ? JSON.stringify(participant.fieldGuide) : null,
          participant.viewerNotes ? JSON.stringify(participant.viewerNotes) : null,
          state.finalReflections[participant.id] ?? null,
        ],
      });
    }

    for (const round of state.rounds) {
      statements.push({ query: UPSERT_ROUND, values: [round.assignment.roundId, state.config.seriesId, round.assignment.roundNumber, round.assignment.senderParticipantId, round.status, round.revealedAt ?? null, round.completedAt ?? null, round.blockedReason ?? null] });
      if (round.target) {
        statements.push({ query: INSERT_TARGET, values: [round.assignment.roundId, round.target.senderParticipantId, round.target.content, JSON.stringify(round.target.assets), round.target.contentSha256, round.target.status, round.target.lockedAt, round.target.transmissionReadyAt ?? null] });
        if (round.target.status === "transmission_ready") statements.push({ query: ADVANCE_TARGET, values: [round.target.transmissionReadyAt ?? round.target.lockedAt, round.assignment.roundId] });
      }
      for (const blind of Object.values(round.blindByParticipant)) {
        statements.push({ query: UPSERT_BLIND, values: [round.assignment.roundId, blind.participantId, blind.status, blind.first ?? null, blind.second ?? null, blind.providerAttemptCount, blind.contentSha256 ?? null, blind.sealedAt ?? null] });
      }
      for (const reflection of Object.values(round.reflectionsByParticipant)) {
        statements.push({ query: UPSERT_REFLECTION, values: [round.assignment.roundId, reflection.participantId, reflection.role, reflection.reflection ?? null, reflection.shareOthersConsent ?? null, reflection.sharedAnswersComment ?? null] });
      }
    }

    for (const call of state.providerCalls) {
      statements.push({ query: UPSERT_CALL, values: [call.id, call.seriesId, call.roundId, call.participantId, call.callStage, call.technicalAttempt, call.status, call.scopeKey, call.requestSha256, call.providerRequestId ?? null, call.responseText ?? null, call.errorMessage ?? null, call.createdAt, call.updatedAt] });
    }
    const lease = this.activeLeases.get(state.config.seriesId);
    if (lease) {
      if (lease.lost) throw new Error("Telepathic series lease was lost before checkpoint save.");
      await this.dependencies.executeFencedTransaction({ seriesId: state.config.seriesId, leaseOwner: lease.owner, leaseVersion: lease.version, statements });
    } else {
      await this.dependencies.executeTransaction(statements);
    }
  }

  async getTelepathicSeries(seriesId: string): Promise<TelepathicSeriesState | null> {
    const seriesRows = await this.dependencies.select<SeriesRow[]>("SELECT id, status, current_round_index, config_json, plan_json, created_at, updated_at FROM telepathic_series WHERE id = $1", [seriesId]);
    const series = seriesRows[0];
    if (!series) return null;
    const [participantRows, roundRows, targetRows, blindRows, reflectionRows, callRows] = await Promise.all([
      this.dependencies.select<ParticipantRow[]>("SELECT participant_id, kind, display_name, route_snapshot_json, field_guide_snapshot_json, viewer_notes_snapshot_json, final_reflection_text FROM telepathic_participants WHERE series_id = $1 ORDER BY rowid", [seriesId]),
      this.dependencies.select<RoundRow[]>("SELECT id, round_number, sender_participant_id, status, revealed_at, completed_at, blocked_reason FROM telepathic_rounds WHERE series_id = $1 ORDER BY round_number", [seriesId]),
      this.dependencies.select<TargetRow[]>("SELECT t.round_id, t.sender_participant_id, t.content, t.assets_manifest_json, t.content_sha256, t.status, t.locked_at, t.transmission_ready_at FROM telepathic_targets t JOIN telepathic_rounds r ON r.id=t.round_id WHERE r.series_id = $1", [seriesId]),
      this.dependencies.select<BlindRow[]>("SELECT b.round_id, b.participant_id, b.status, b.first_text, b.second_text, b.provider_attempt_count, b.content_sha256, b.sealed_at FROM telepathic_blind_submissions b JOIN telepathic_rounds r ON r.id=b.round_id WHERE r.series_id = $1", [seriesId]),
      this.dependencies.select<ReflectionRow[]>("SELECT f.round_id, f.participant_id, f.role, f.reflection_text, f.share_others_consent, f.shared_answers_comment FROM telepathic_reflections f JOIN telepathic_rounds r ON r.id=f.round_id WHERE r.series_id = $1", [seriesId]),
      this.dependencies.select<CallRow[]>("SELECT id, round_id, participant_id, call_stage, technical_attempt, status, scope_key, request_sha256, provider_request_id, response_text, error_message, created_at, updated_at FROM telepathic_provider_calls WHERE series_id = $1 ORDER BY created_at, id", [seriesId]),
    ]);

    const config = JSON.parse(series.config_json) as TelepathicSeriesConfig;
    const plan = JSON.parse(series.plan_json) as TelepathicSeriesPlan;
    const participants: TelepathicParticipant[] = participantRows.map((row) => ({
      id: row.participant_id,
      kind: row.kind,
      displayName: row.display_name,
      ...(row.route_snapshot_json ? { ai: JSON.parse(row.route_snapshot_json) as TelepathicParticipant["ai"] } : {}),
      ...(row.field_guide_snapshot_json ? { fieldGuide: JSON.parse(row.field_guide_snapshot_json) as NonNullable<TelepathicParticipant["fieldGuide"]> } : {}),
      ...(row.viewer_notes_snapshot_json ? { viewerNotes: JSON.parse(row.viewer_notes_snapshot_json) as NonNullable<TelepathicParticipant["viewerNotes"]> } : {}),
    }));
    config.participants = participants;

    const targetByRound = new Map(targetRows.map((row) => [row.round_id, {
      schemaVersion: 1 as const,
      roundId: row.round_id,
      senderParticipantId: row.sender_participant_id,
      content: row.content,
      assets: JSON.parse(row.assets_manifest_json) as TelepathicLockedTarget["assets"],
      contentSha256: row.content_sha256,
      lockedAt: row.locked_at,
      status: row.status,
      ...(row.transmission_ready_at ? { transmissionReadyAt: row.transmission_ready_at } : {}),
    }]));
    const blindsByRound = new Map<string, Record<string, TelepathicBlindSubmission>>();
    for (const row of blindRows) {
      const map = blindsByRound.get(row.round_id) ?? {};
      map[row.participant_id] = {
        participantId: row.participant_id,
        status: row.status,
        ...(row.first_text ? { first: row.first_text } : {}),
        ...(row.second_text ? { second: row.second_text } : {}),
        providerAttemptCount: row.provider_attempt_count,
        ...(row.content_sha256 ? { contentSha256: row.content_sha256 } : {}),
        ...(row.sealed_at ? { sealedAt: row.sealed_at } : {}),
      };
      blindsByRound.set(row.round_id, map);
    }
    const reflectionsByRound = new Map<string, Record<string, TelepathicReflectionRecord>>();
    for (const row of reflectionRows) {
      const map = reflectionsByRound.get(row.round_id) ?? {};
      map[row.participant_id] = {
        participantId: row.participant_id,
        role: row.role,
        ...(row.reflection_text !== null ? { reflection: row.reflection_text } : {}),
        ...(row.share_others_consent ? { shareOthersConsent: row.share_others_consent } : {}),
        ...(row.shared_answers_comment ? { sharedAnswersComment: row.shared_answers_comment } : {}),
      };
      reflectionsByRound.set(row.round_id, map);
    }
    const rounds: TelepathicRoundState[] = roundRows.map((row) => {
      const assignment = plan.rounds.find((item) => item.roundId === row.id);
      if (!assignment) throw new Error("Persisted telepathic round is missing from the locked series plan.");
      return {
        assignment,
        status: row.status,
        ...(targetByRound.get(row.id) ? { target: targetByRound.get(row.id) } : {}),
        blindByParticipant: blindsByRound.get(row.id) ?? {},
        reflectionsByParticipant: reflectionsByRound.get(row.id) ?? {},
        ...(row.revealed_at ? { revealedAt: row.revealed_at } : {}),
        ...(row.completed_at ? { completedAt: row.completed_at } : {}),
        ...(row.blocked_reason ? { blockedReason: row.blocked_reason } : {}),
      };
    });
    const providerCalls: TelepathicProviderCallRecord[] = callRows.map((row) => ({
      id: row.id,
      seriesId,
      roundId: row.round_id,
      participantId: row.participant_id,
      callStage: row.call_stage,
      technicalAttempt: row.technical_attempt,
      status: row.status,
      scopeKey: row.scope_key,
      requestSha256: row.request_sha256,
      ...(row.provider_request_id ? { providerRequestId: row.provider_request_id } : {}),
      ...(row.response_text ? { responseText: row.response_text } : {}),
      ...(row.error_message ? { errorMessage: row.error_message } : {}),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
    const finalReflections = Object.fromEntries(participantRows.filter((row) => row.final_reflection_text).map((row) => [row.participant_id, row.final_reflection_text!])) as Record<string, string>;
    return { schemaVersion: 1, config, plan, currentRoundIndex: series.current_round_index, status: series.status, rounds, providerCalls, finalReflections, createdAt: series.created_at, updatedAt: series.updated_at };
  }
}
