import type { CustomProtocolVersion, SaveCustomProtocolVersionInput } from "../../protocols/types";
import type { CustomProtocolsRepository } from "../contracts/customProtocolsRepository";

type CustomProtocolRow = {
  protocol_id: string;
  version_id: string;
  display_name: string;
  version: string;
  language: "pl" | "en";
  content: string;
  ordered_steps_json: string;
  content_hash: string;
  source_metadata_json: string;
  created_at: string;
};

export class SqliteCustomProtocolsRepository implements CustomProtocolsRepository {
  constructor(private readonly dependencies: {
    select<T>(query: string, values?: unknown[]): Promise<T>;
    executeWrite(query: string, values?: unknown[]): Promise<{ rowsAffected: number }>;
  }) {}

  async listCustomProtocols(language?: "pl" | "en"): Promise<CustomProtocolVersion[]> {
    const rows = language
      ? await this.dependencies.select<CustomProtocolRow[]>(
          `SELECT p.id AS protocol_id, pv.id AS version_id, p.display_name, pv.version, pv.language,
                  pv.content, pv.ordered_steps_json, pv.content_hash, pv.source_metadata_json, pv.created_at
             FROM protocols p JOIN protocol_versions pv ON pv.protocol_id = p.id
            WHERE p.family = 'custom' AND pv.language = $1 ORDER BY p.display_name, pv.created_at DESC`,
          [language],
        )
      : await this.dependencies.select<CustomProtocolRow[]>(
          `SELECT p.id AS protocol_id, pv.id AS version_id, p.display_name, pv.version, pv.language,
                  pv.content, pv.ordered_steps_json, pv.content_hash, pv.source_metadata_json, pv.created_at
             FROM protocols p JOIN protocol_versions pv ON pv.protocol_id = p.id
            WHERE p.family = 'custom' ORDER BY p.display_name, pv.created_at DESC`,
        );
    return rows.map((row) => {
      const metadata = JSON.parse(row.source_metadata_json) as Record<string, unknown>;
      return {
        protocolId: row.protocol_id,
        versionId: row.version_id,
        displayName: row.display_name,
        description: typeof metadata.description === "string" ? metadata.description : undefined,
        version: row.version,
        language: row.language,
        systemPrompt: row.content.trim() || undefined,
        steps: JSON.parse(row.ordered_steps_json) as string[],
        contentHash: row.content_hash,
        createdAt: row.created_at,
      };
    });
  }

  async saveCustomProtocolVersion(input: SaveCustomProtocolVersionInput): Promise<CustomProtocolVersion> {
    const existing = await this.dependencies.select<{ id: string }[]>("SELECT id FROM protocols WHERE id = $1", [input.protocolId]);
    if (!existing.length) {
      await this.dependencies.executeWrite(
        `INSERT INTO protocols (id, family, display_name, built_in, created_at) VALUES ($1, 'custom', $2, 0, $3)`,
        [input.protocolId, input.displayName, input.createdAt],
      );
    }
    await this.dependencies.executeWrite(
      `INSERT INTO protocol_versions
       (id, protocol_id, version, language, content, ordered_steps_json, reveal_policy_json, content_hash, source_metadata_json, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [input.versionId, input.protocolId, input.version, input.language, input.systemPrompt ?? "", JSON.stringify(input.steps), JSON.stringify({ separateRevealStage: true }), input.contentHash, JSON.stringify({ description: input.description ?? "", origin: "user" }), input.createdAt],
    );
    return { ...input, steps: [...input.steps] };
  }
}
