import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';

import { createNote, listMemories, searchMemories } from '../services/notes.js';
import type { WhisperTranscriptionService } from '../services/whisper-transcription.js';
import type { Database, Note } from '../src/types.js';

const noteProperties = {
  id: { type: 'string', format: 'uuid' },
  content: { type: 'string' },
  audio_path: { type: ['string', 'null'] },
  created_at: { type: 'string', format: 'date-time' },
  updated_at: { type: 'string', format: 'date-time' },
} as const;

const metadataProperties = {
  note_id: { type: 'string', format: 'uuid' },
  type: { anyOf: [{ type: 'string', enum: ['note', 'task', 'idea', 'reminder', 'conversation', 'observation', 'other'] }, { type: 'null' }] },
  summary: { type: ['string', 'null'] },
  people: { type: 'array', items: { type: 'string' } },
  topics: { type: 'array', items: { type: 'string' } },
  dates: { type: 'array', items: { type: 'string' } },
  actions: { type: 'array', items: { type: 'string' } },
  type_evidence: { type: ['string', 'null'] },
  summary_evidence: { type: ['string', 'null'] },
  people_evidence: { type: 'array', items: { type: 'string' } },
  topics_evidence: { type: 'array', items: { type: 'string' } },
  dates_evidence: { type: 'array', items: { type: 'string' } },
  actions_evidence: { type: 'array', items: { type: 'string' } },
  quality_score: { type: 'integer', minimum: 0, maximum: 100 },
  validation_flags: { type: 'array', items: { type: 'string' } },
  provider: { type: ['string', 'null'] },
  model: { type: ['string', 'null'] },
  created_at: { type: 'string', format: 'date-time' },
  updated_at: { type: 'string', format: 'date-time' },
} as const;

const noteWithMetadataSchema = {
  type: 'object',
  required: ['note', 'metadata'],
  properties: {
    note: { type: 'object', required: ['id', 'content', 'audio_path', 'created_at', 'updated_at'], properties: noteProperties },
    metadata: { anyOf: [{ type: 'object', required: ['note_id', 'type', 'summary', 'people', 'topics', 'dates', 'actions', 'type_evidence', 'summary_evidence', 'people_evidence', 'topics_evidence', 'dates_evidence', 'actions_evidence', 'quality_score', 'validation_flags', 'provider', 'model', 'created_at', 'updated_at'], properties: metadataProperties }, { type: 'null' }] },
  },
} as const;

const structuredEnrichedMemorySchema = {
  anyOf: [
    {
      type: 'object',
      required: ['title', 'intent', 'summary', 'action_items', 'tags'],
      properties: {
        title: { type: ['string', 'null'] },
        intent: { anyOf: [{ type: 'string', enum: ['note', 'task', 'idea', 'reminder', 'conversation', 'observation', 'other'] }, { type: 'null' }] },
        summary: { type: ['string', 'null'] },
        action_items: { type: 'array', items: { type: 'string' } },
        tags: { type: 'array', items: { type: 'string' } },
      },
    },
    { type: 'null' },
  ],
} as const;

interface AudioIngestionJob {
  id: string;
  status: 'accepted' | 'processing' | 'completed' | 'failed';
  audio_path: string;
  transcript: string | null;
  note_id: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

const audioIngestionJobs = new Map<string, AudioIngestionJob>();

function toBoolean(value: string | undefined): boolean | undefined {
  if (!value) return undefined;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
}

export function registerMemoryRoutes(
  app: FastifyInstance,
  database: Database,
  whisperService: WhisperTranscriptionService,
  scheduleEnrichment: (note: Note) => void,
): void {
  const querySchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      type: { type: 'string', enum: ['note', 'task', 'idea', 'reminder', 'conversation', 'observation', 'other'] },
      person: { type: 'string', minLength: 1, maxLength: 200 },
      topic: { type: 'string', minLength: 1, maxLength: 200 },
      hasAction: { type: 'string', enum: ['true', 'false'] },
      hasMetadata: { type: 'string', enum: ['true', 'false'] },
      limit: { type: 'integer', minimum: 1, maximum: 100 },
      offset: { type: 'integer', minimum: 0, maximum: 10_000 },
    },
  } as const;

  app.get<{ Querystring: { type?: 'note' | 'task' | 'idea' | 'reminder' | 'conversation' | 'observation' | 'other'; person?: string; topic?: string; hasAction?: 'true' | 'false'; hasMetadata?: 'true' | 'false'; limit?: number; offset?: number } }>('/memories', {
    schema: {
      querystring: querySchema,
      response: {
        200: { type: 'array', items: noteWithMetadataSchema },
      },
    },
  }, async (request) => listMemories(database, {
    type: request.query.type ?? undefined,
    person: request.query.person,
    topic: request.query.topic,
    hasAction: toBoolean(request.query.hasAction),
    hasMetadata: toBoolean(request.query.hasMetadata),
    limit: request.query.limit ?? 20,
    offset: request.query.offset ?? 0,
  }));

  app.get<{ Querystring: { q: string; type?: 'note' | 'task' | 'idea' | 'reminder' | 'conversation' | 'observation' | 'other'; limit?: number; offset?: number } }>('/memories/search', {
    schema: {
      querystring: {
        type: 'object',
        additionalProperties: false,
        required: ['q'],
        properties: {
          q: { type: 'string', minLength: 1, maxLength: 500 },
          type: { type: 'string', enum: ['note', 'task', 'idea', 'reminder', 'conversation', 'observation', 'other'] },
          limit: { type: 'integer', minimum: 1, maximum: 100 },
          offset: { type: 'integer', minimum: 0, maximum: 10_000 },
        },
      },
      response: {
        200: { type: 'array', items: noteWithMetadataSchema },
      },
    },
  }, async (request) => searchMemories(database, {
    q: request.query.q,
    type: request.query.type ?? undefined,
    limit: request.query.limit ?? 20,
    offset: request.query.offset ?? 0,
  }));

  app.post('/api/memories/audio', {
    schema: {
      response: {
        202: {
          type: 'object',
          required: ['success', 'job'],
          properties: {
            success: { type: 'boolean' },
            job: {
              type: 'object',
              required: ['id', 'status', 'audio_path', 'transcript', 'note_id', 'error', 'created_at', 'updated_at'],
              properties: {
                id: { type: 'string', format: 'uuid' },
                status: { type: 'string', enum: ['accepted', 'processing', 'completed', 'failed'] },
                audio_path: { type: 'string' },
                transcript: { type: ['string', 'null'] },
                note_id: { type: ['string', 'null'], format: 'uuid' },
                error: { type: ['string', 'null'] },
                created_at: { type: 'string', format: 'date-time' },
                updated_at: { type: 'string', format: 'date-time' },
              },
            },
          },
        },
        400: { type: 'object', required: ['error'], properties: { error: { type: 'string' } } },
        502: { type: 'object', required: ['error'], properties: { error: { type: 'string' } } },
        503: { type: 'object', required: ['error'], properties: { error: { type: 'string' } } },
      },
    },
  }, async (request, reply) => {
    if (!whisperService.enabled) {
      return reply.code(503).send({ error: 'Whisper transcription service is not configured.' });
    }

    const file = await request.file();
    if (!file) {
      return reply.code(400).send({ error: 'Audio file is required.' });
    }

    let audioPath: string;
    try {
      audioPath = await whisperService.saveUploadedAudio(file.file, file.filename);
    } catch (error) {
      request.log.warn({ err: error }, 'Audio transcription failed.');
      return reply.code(502).send({ error: 'Audio upload persistence failed.' });
    }

    const now = new Date().toISOString();
    const job: AudioIngestionJob = {
      id: randomUUID(),
      status: 'accepted',
      audio_path: audioPath,
      transcript: null,
      note_id: null,
      error: null,
      created_at: now,
      updated_at: now,
    };
    audioIngestionJobs.set(job.id, job);

    const responseJob: AudioIngestionJob = { ...job };

    setImmediate(() => {
      void (async () => {
        const current = audioIngestionJobs.get(job.id);
        if (!current) return;
        current.status = 'processing';
        current.updated_at = new Date().toISOString();

        try {
          const transcript = await whisperService.transcribeStoredAudio(audioPath);
          const note = await createNote(database, transcript, audioPath);
          current.transcript = transcript;
          current.note_id = note.id;
          current.status = 'completed';
          current.updated_at = new Date().toISOString();
          scheduleEnrichment(note);
        } catch (error) {
          request.log.warn({ err: error, jobId: job.id }, 'Background audio processing failed.');
          current.status = 'failed';
          current.error = error instanceof Error ? error.message : 'Unknown background audio processing error.';
          current.updated_at = new Date().toISOString();
        }
      })();
    });

    return reply.code(202).send({
      success: true,
      job: responseJob,
    });
  });

  app.get<{ Params: { id: string } }>('/api/memories/audio/jobs/:id', {
    schema: {
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } },
      response: {
        200: {
          type: 'object',
          required: ['job'],
          properties: {
            job: {
              type: 'object',
              required: ['id', 'status', 'audio_path', 'transcript', 'note_id', 'error', 'created_at', 'updated_at'],
              properties: {
                id: { type: 'string', format: 'uuid' },
                status: { type: 'string', enum: ['accepted', 'processing', 'completed', 'failed'] },
                audio_path: { type: 'string' },
                transcript: { type: ['string', 'null'] },
                note_id: { type: ['string', 'null'], format: 'uuid' },
                error: { type: ['string', 'null'] },
                created_at: { type: 'string', format: 'date-time' },
                updated_at: { type: 'string', format: 'date-time' },
              },
            },
          },
        },
        404: { type: 'object', required: ['error'], properties: { error: { type: 'string' } } },
      }
    },
  }, async (request, reply) => {
    const job = audioIngestionJobs.get(request.params.id);
    if (!job) return reply.code(404).send({ error: 'Audio ingestion job not found.' });
    return { job };
  });
}