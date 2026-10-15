import type { Database, MemoryMetadata, Note, NoteWithMetadata } from '../src/types.js';

const noteColumns = 'id, content, audio_path, created_at, updated_at';

interface NoteWithMetadataRow {
  note_id: string;
  note_content: string;
  note_audio_path: string | null;
  note_created_at: Date;
  note_updated_at: Date;
  metadata_note_id: string | null;
  metadata_type: MemoryMetadata['type'];
  metadata_summary: string | null;
  metadata_people: string[] | null;
  metadata_topics: string[] | null;
  metadata_dates: string[] | null;
  metadata_actions: string[] | null;
  metadata_type_evidence: string | null;
  metadata_summary_evidence: string | null;
  metadata_people_evidence: string[] | null;
  metadata_topics_evidence: string[] | null;
  metadata_dates_evidence: string[] | null;
  metadata_actions_evidence: string[] | null;
  metadata_quality_score: number | null;
  metadata_validation_flags: string[] | null;
  metadata_provider: string | null;
  metadata_model: string | null;
  metadata_created_at: Date | null;
  metadata_updated_at: Date | null;
}

export interface MemoriesQuery {
  q?: string;
  type?: MemoryMetadata['type'];
  person?: string;
  topic?: string;
  hasAction?: boolean;
  hasMetadata?: boolean;
  limit: number;
  offset: number;
}

export async function createNote(database: Database, content: string, audioPath: string | null = null): Promise<Note> {
  const result = await database.query<Note>(
    `INSERT INTO notes (content, audio_path)
     VALUES ($1, $2)
     RETURNING ${noteColumns}`,
    [content, audioPath],
  );

  return result.rows[0];
}

export async function listNotes(database: Database): Promise<Note[]> {
  const result = await database.query<Note>(
    `SELECT ${noteColumns}
     FROM notes
     ORDER BY created_at DESC, id DESC`,
  );

  return result.rows;
}

export async function findNote(database: Database, id: string): Promise<Note | null> {
  const result = await database.query<Note>(
    `SELECT ${noteColumns}
     FROM notes
     WHERE id = $1`,
    [id],
  );

  return result.rows[0] ?? null;
}

export async function saveMemoryMetadata(
  database: Database,
  metadata: Omit<MemoryMetadata, 'created_at' | 'updated_at'>,
): Promise<MemoryMetadata> {
  const result = await database.query<MemoryMetadata>(
    `INSERT INTO memory_metadata (
      note_id, type, summary, people, topics, dates, actions,
      type_evidence, summary_evidence, people_evidence, topics_evidence, dates_evidence, actions_evidence,
      quality_score, validation_flags, provider, model
     )
     VALUES (
      $1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb,
      $8, $9, $10::jsonb, $11::jsonb, $12::jsonb, $13::jsonb,
      $14, $15::jsonb, $16, $17
     )
     ON CONFLICT (note_id) DO UPDATE SET
       type = EXCLUDED.type,
       summary = EXCLUDED.summary,
       people = EXCLUDED.people,
       topics = EXCLUDED.topics,
       dates = EXCLUDED.dates,
       actions = EXCLUDED.actions,
       type_evidence = EXCLUDED.type_evidence,
       summary_evidence = EXCLUDED.summary_evidence,
       people_evidence = EXCLUDED.people_evidence,
       topics_evidence = EXCLUDED.topics_evidence,
       dates_evidence = EXCLUDED.dates_evidence,
       actions_evidence = EXCLUDED.actions_evidence,
       quality_score = EXCLUDED.quality_score,
       validation_flags = EXCLUDED.validation_flags,
       provider = EXCLUDED.provider,
       model = EXCLUDED.model,
       updated_at = NOW()
     RETURNING note_id, type, summary, people, topics, dates, actions,
       type_evidence, summary_evidence, people_evidence, topics_evidence, dates_evidence, actions_evidence,
       quality_score, validation_flags,
       provider, model, created_at, updated_at`,
    [
      metadata.note_id,
      metadata.type,
      metadata.summary,
      JSON.stringify(metadata.people),
      JSON.stringify(metadata.topics),
      JSON.stringify(metadata.dates),
      JSON.stringify(metadata.actions),
      metadata.type_evidence,
      metadata.summary_evidence,
      JSON.stringify(metadata.people_evidence),
      JSON.stringify(metadata.topics_evidence),
      JSON.stringify(metadata.dates_evidence),
      JSON.stringify(metadata.actions_evidence),
      metadata.quality_score,
      JSON.stringify(metadata.validation_flags),
      metadata.provider,
      metadata.model,
    ],
  );

  return result.rows[0];
}

export async function findNoteWithMetadata(database: Database, id: string): Promise<NoteWithMetadata | null> {
  const note = await findNote(database, id);
  if (!note) return null;

  const result = await database.query<MemoryMetadata>(
    `SELECT note_id, type, summary, people, topics, dates, actions,
      type_evidence, summary_evidence, people_evidence, topics_evidence, dates_evidence, actions_evidence,
      quality_score, validation_flags,
      provider, model, created_at, updated_at
     FROM memory_metadata
     WHERE note_id = $1`,
    [id],
  );

  return { note, metadata: result.rows[0] ?? null };
}

function mapJoinedRow(row: NoteWithMetadataRow): NoteWithMetadata {
  return {
    note: {
      id: row.note_id,
      content: row.note_content,
      audio_path: row.note_audio_path,
      created_at: row.note_created_at,
      updated_at: row.note_updated_at,
    },
    metadata: row.metadata_note_id
      ? {
        note_id: row.metadata_note_id,
        type: row.metadata_type,
        summary: row.metadata_summary,
        people: row.metadata_people ?? [],
        topics: row.metadata_topics ?? [],
        dates: row.metadata_dates ?? [],
        actions: row.metadata_actions ?? [],
        type_evidence: row.metadata_type_evidence,
        summary_evidence: row.metadata_summary_evidence,
        people_evidence: row.metadata_people_evidence ?? [],
        topics_evidence: row.metadata_topics_evidence ?? [],
        dates_evidence: row.metadata_dates_evidence ?? [],
        actions_evidence: row.metadata_actions_evidence ?? [],
        quality_score: row.metadata_quality_score ?? 0,
        validation_flags: row.metadata_validation_flags ?? [],
        provider: row.metadata_provider,
        model: row.metadata_model,
        created_at: row.metadata_created_at as Date,
        updated_at: row.metadata_updated_at as Date,
      }
      : null,
  };
}

const joinedColumns = `
  n.id AS note_id,
  n.content AS note_content,
  n.audio_path AS note_audio_path,
  n.created_at AS note_created_at,
  n.updated_at AS note_updated_at,
  m.note_id AS metadata_note_id,
  m.type AS metadata_type,
  m.summary AS metadata_summary,
  m.people AS metadata_people,
  m.topics AS metadata_topics,
  m.dates AS metadata_dates,
  m.actions AS metadata_actions,
  m.type_evidence AS metadata_type_evidence,
  m.summary_evidence AS metadata_summary_evidence,
  m.people_evidence AS metadata_people_evidence,
  m.topics_evidence AS metadata_topics_evidence,
  m.dates_evidence AS metadata_dates_evidence,
  m.actions_evidence AS metadata_actions_evidence,
  m.quality_score AS metadata_quality_score,
  m.validation_flags AS metadata_validation_flags,
  m.provider AS metadata_provider,
  m.model AS metadata_model,
  m.created_at AS metadata_created_at,
  m.updated_at AS metadata_updated_at`;

export async function listMemories(database: Database, query: MemoriesQuery): Promise<NoteWithMetadata[]> {
  const values: unknown[] = [];
  const where: string[] = [];

  if (query.type) {
    values.push(query.type);
    where.push(`m.type = $${values.length}`);
  }

  if (query.person) {
    values.push(query.person);
    where.push(`m.people ? $${values.length}`);
  }

  if (query.topic) {
    values.push(query.topic);
    where.push(`m.topics ? $${values.length}`);
  }

  if (typeof query.hasAction === 'boolean') {
    where.push(query.hasAction ? 'jsonb_array_length(m.actions) > 0' : 'coalesce(jsonb_array_length(m.actions), 0) = 0');
  }

  if (typeof query.hasMetadata === 'boolean') {
    where.push(query.hasMetadata ? 'm.note_id IS NOT NULL' : 'm.note_id IS NULL');
  }

  values.push(query.limit, query.offset);
  const filter = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

  const result = await database.query<NoteWithMetadataRow>(
    `SELECT ${joinedColumns}
     FROM notes n
     LEFT JOIN memory_metadata m ON m.note_id = n.id
     ${filter}
     ORDER BY n.created_at DESC, n.id DESC
     LIMIT $${values.length - 1}
     OFFSET $${values.length}`,
    values,
  );

  return result.rows.map(mapJoinedRow);
}

export async function searchMemories(database: Database, query: MemoriesQuery): Promise<NoteWithMetadata[]> {
  const values: unknown[] = [];
  const where: string[] = [];

  if (query.q && query.q.trim().length > 0) {
    values.push(`%${query.q}%`);
    where.push(`(
      n.content ILIKE $${values.length}
      OR coalesce(m.summary, '') ILIKE $${values.length}
      OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(coalesce(m.people, '[]'::jsonb)) item WHERE item ILIKE $${values.length})
      OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(coalesce(m.topics, '[]'::jsonb)) item WHERE item ILIKE $${values.length})
      OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(coalesce(m.actions, '[]'::jsonb)) item WHERE item ILIKE $${values.length})
    )`);
  }

  if (query.type) {
    values.push(query.type);
    where.push(`m.type = $${values.length}`);
  }

  values.push(query.limit, query.offset);
  const filter = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

  const result = await database.query<NoteWithMetadataRow>(
    `SELECT ${joinedColumns}
     FROM notes n
     LEFT JOIN memory_metadata m ON m.note_id = n.id
     ${filter}
     ORDER BY n.created_at DESC, n.id DESC
     LIMIT $${values.length - 1}
     OFFSET $${values.length}`,
    values,
  );

  return result.rows.map(mapJoinedRow);
}