import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';

import { registerHealthRoute } from '../routes/health.js';
import { registerMemoryRoutes } from '../routes/memories.js';
import { registerNotesRoutes } from '../routes/notes.js';
import { BackgroundMemoryEnrichment } from '../services/background-memory-enrichment.js';
import { createDisabledMemoryEnrichmentService, type MemoryEnrichmentService } from '../services/memory-enrichment.js';
import { createDisabledWhisperTranscriptionService, type WhisperTranscriptionService } from '../services/whisper-transcription.js';
import type { Database } from './types.js';

export function buildApp(
  database: Database,
  enrichmentService: MemoryEnrichmentService = createDisabledMemoryEnrichmentService(),
  whisperService: WhisperTranscriptionService = createDisabledWhisperTranscriptionService(),
  obsidianVaultPath = './storage/vault',
): FastifyInstance {
  const app = Fastify({ logger: true });
  const backgroundEnrichment = new BackgroundMemoryEnrichment(database, enrichmentService, obsidianVaultPath, app.log);

  void app.register(multipart, {
    limits: {
      fileSize: 10 * 1024 * 1024,
      files: 1,
    },
  });

  registerHealthRoute(app, database);
  registerNotesRoutes(app, database, (note) => backgroundEnrichment.schedule(note));
  registerMemoryRoutes(app, database, whisperService, (note) => backgroundEnrichment.schedule(note));

  app.addHook('onClose', async () => backgroundEnrichment.stop());

  app.setErrorHandler((error: FastifyError, request, reply) => {
    request.log.error(error);

    if (error.validation) {
      return reply.status(400).send({ error: 'Validation error', message: error.message });
    }

    return reply.status(500).send({ error: 'Internal server error' });
  });

  return app;
}