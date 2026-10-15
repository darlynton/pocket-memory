import type { FastifyInstance } from 'fastify';

import { createNote, findNoteWithMetadata, listNotes } from '../services/notes.js';
import type { Database, NoteWithMetadata } from '../src/types.js';

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

export function registerNotesRoutes(
  app: FastifyInstance,
  database: Database,
  scheduleEnrichment: (note: NoteWithMetadata['note']) => void,
): void {
  app.post<{ Body: { content: string } }>('/notes', {
    schema: {
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['content'],
        properties: {
          content: { type: 'string', minLength: 1, maxLength: 10_000, pattern: '.*\\S.*' },
        },
      },
      response: {
        201: noteWithMetadataSchema,
      },
    },
  }, async (request, reply) => {
    const note = await createNote(database, request.body.content);
    scheduleEnrichment(note);
    return reply.code(201).send({ note, metadata: null });
  });

  app.get('/notes', {
    schema: {
      response: {
        200: { type: 'array', items: { type: 'object', required: ['id', 'content', 'audio_path', 'created_at', 'updated_at'], properties: noteProperties } },
      },
    },
  }, async () => listNotes(database));

  app.get<{ Params: { id: string } }>('/notes/:id', {
    schema: {
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } },
      response: {
        200: noteWithMetadataSchema,
        404: { type: 'object', required: ['error'], properties: { error: { type: 'string' } } },
      },
    },
  }, async (request, reply): Promise<NoteWithMetadata | { error: string }> => {
    const note = await findNoteWithMetadata(database, request.params.id);
    if (!note) return reply.code(404).send({ error: 'Note not found' });
    return note;
  });

  app.post<{ Params: { id: string } }>('/notes/:id/enrich', {
    schema: {
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } },
      response: {
        202: noteWithMetadataSchema,
        404: { type: 'object', required: ['error'], properties: { error: { type: 'string' } } },
      },
    },
  }, async (request, reply): Promise<NoteWithMetadata | { error: string }> => {
    const note = await findNoteWithMetadata(database, request.params.id);
    if (!note) return reply.code(404).send({ error: 'Note not found' });

    scheduleEnrichment(note.note);
    return reply.code(202).send(note);
  });
}