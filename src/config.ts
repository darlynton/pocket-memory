export interface Config {
  databaseUrl: string;
  databasePoolMax: number;
  host: string;
  port: number;
  memoryEnrichmentProvider: string;
  memoryEnrichmentModel: string | undefined;
  memoryEnrichmentBaseUrl: string | undefined;
  memoryEnrichmentApiPath: string | undefined;
  memoryEnrichmentResponseField: string | undefined;
  whisperBaseUrl: string | undefined;
  whisperApiKey: string | undefined;
  whisperModel: string | undefined;
  audioStorageDir: string;
  obsidianVaultPath: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required.');
  }

  const port = Number(env.PORT ?? '3001');
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535.');
  }

  const databasePoolMax = Number(env.DB_POOL_MAX ?? '5');
  if (!Number.isInteger(databasePoolMax) || databasePoolMax < 1 || databasePoolMax > 100) {
    throw new Error('DB_POOL_MAX must be an integer between 1 and 100.');
  }

  return {
    databaseUrl,
    databasePoolMax,
    host: env.HOST ?? '0.0.0.0',
    port,
    memoryEnrichmentProvider: env.MEMORY_ENRICHMENT_PROVIDER ?? 'disabled',
    memoryEnrichmentModel: env.MEMORY_ENRICHMENT_MODEL,
    memoryEnrichmentBaseUrl: env.MEMORY_ENRICHMENT_BASE_URL,
    memoryEnrichmentApiPath: env.MEMORY_ENRICHMENT_API_PATH,
    memoryEnrichmentResponseField: env.MEMORY_ENRICHMENT_RESPONSE_FIELD,
    whisperBaseUrl: env.WHISPER_BASE_URL,
    whisperApiKey: env.WHISPER_API_KEY,
    whisperModel: env.WHISPER_MODEL,
    audioStorageDir: env.AUDIO_STORAGE_DIR ?? './storage/audio',
    obsidianVaultPath: env.OBSIDIAN_VAULT_PATH ?? './storage/vault',
  };
}