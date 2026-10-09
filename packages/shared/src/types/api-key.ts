export interface ApiKey {
  id: string;
  userId: string;
  name: string;
  /** First characters of the key, safe to display (e.g. "mrp_a1b2c3d4") */
  keyPrefix: string;
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface CreateApiKeyInput {
  name: string;
  /** Days until expiry; null or omitted means the key never expires */
  expiresInDays?: number | null;
}

export interface CreatedApiKey {
  apiKey: ApiKey;
  /** Full plaintext key. Only returned once, at creation time. */
  key: string;
}
