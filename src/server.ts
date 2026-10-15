import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createDatabase } from './db.js';
import { createConfiguredMemoryEnrichmentService } from '../services/memory-enrichment-provider.js';
import { createConfiguredWhisperTranscriptionService } from '../services/whisper-transcription.js';

const config = loadConfig();
const database = createDatabase(config.databaseUrl, config.databasePoolMax);
const app = buildApp(
  database,
  createConfiguredMemoryEnrichmentService(config),
  createConfiguredWhisperTranscriptionService(config),
  config.obsidianVaultPath,
);

async function start(): Promise<void> {
  try {
    await app.listen({ host: config.host, port: config.port });
  } catch (error) {
    app.log.error(error);
    await database.close();
    process.exit(1);
  }
}

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, 'Shutting down');
  await app.close();
  await database.close();
  process.exit(0);
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

void start();