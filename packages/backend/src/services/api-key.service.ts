import { createHash, randomBytes } from "node:crypto";
import { v4 as uuidv4 } from "uuid";
import { getDb } from "../db/connection.js";
import type { ApiKey, CreateApiKeyInput, CreatedApiKey } from "@mrp/shared";

interface DbApiKey {
  id: string;
  user_id: string;
  name: string;
  key_prefix: string;
  key_hash: string;
  created_by: string | null;
  expires_at: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

const KEY_PREFIX = "mrp_";
const DISPLAY_PREFIX_LENGTH = KEY_PREFIX.length + 8;
// Avoid a DB write on every request: only refresh last_used_at once per minute
const LAST_USED_UPDATE_INTERVAL_MS = 60 * 1000;

function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

function mapDbApiKey(row: DbApiKey): ApiKey {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    keyPrefix: row.key_prefix,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
  };
}

function listByUser(userId: string): ApiKey[] {
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM api_keys WHERE user_id = ? ORDER BY created_at DESC")
    .all(userId) as DbApiKey[];
  return rows.map(mapDbApiKey);
}

function create(
  userId: string,
  input: CreateApiKeyInput,
  createdBy: string
): CreatedApiKey {
  const db = getDb();
  const id = uuidv4();
  const key = `${KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
  const now = new Date();
  const expiresAt = input.expiresInDays
    ? new Date(now.getTime() + input.expiresInDays * 24 * 60 * 60 * 1000).toISOString()
    : null;

  db.prepare(`
    INSERT INTO api_keys (id, user_id, name, key_prefix, key_hash, created_by, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    userId,
    input.name,
    key.slice(0, DISPLAY_PREFIX_LENGTH),
    hashKey(key),
    createdBy,
    expiresAt,
    now.toISOString()
  );

  const row = db.prepare("SELECT * FROM api_keys WHERE id = ?").get(id) as DbApiKey;
  return { apiKey: mapDbApiKey(row), key };
}

function revoke(userId: string, keyId: string): boolean {
  const db = getDb();
  const result = db
    .prepare(
      "UPDATE api_keys SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL"
    )
    .run(new Date().toISOString(), keyId, userId);
  return result.changes > 0;
}

/**
 * Resolves a plaintext API key to its owner's user ID.
 * Returns null if the key is unknown, revoked or expired.
 */
function authenticate(key: string): { userId: string; keyId: string } | null {
  if (!key.startsWith(KEY_PREFIX)) {
    return null;
  }

  const db = getDb();
  const row = db
    .prepare("SELECT * FROM api_keys WHERE key_hash = ?")
    .get(hashKey(key)) as DbApiKey | undefined;

  if (!row || row.revoked_at) {
    return null;
  }

  const now = new Date();
  if (row.expires_at && new Date(row.expires_at) <= now) {
    return null;
  }

  const staleBefore = new Date(now.getTime() - LAST_USED_UPDATE_INTERVAL_MS).toISOString();
  db.prepare(
    "UPDATE api_keys SET last_used_at = ? WHERE id = ? AND (last_used_at IS NULL OR last_used_at < ?)"
  ).run(now.toISOString(), row.id, staleBefore);

  return { userId: row.user_id, keyId: row.id };
}

export const apiKeyService = {
  listByUser,
  create,
  revoke,
  authenticate,
};
