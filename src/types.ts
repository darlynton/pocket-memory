import type { QueryResultRow } from 'pg';

export interface Database {
  query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: Row[] }>;
}

export interface Note {
  id: string;
  content: string;
  audio_path: string | null;
  created_at: Date;
  updated_at: Date;
}

export const memoryTypes = ['note', 'task', 'idea', 'reminder', 'conversation', 'observation', 'other'] as const;

export type MemoryType = (typeof memoryTypes)[number];

export interface MemoryMetadata {
  note_id: string;
  type: MemoryType | null;
  summary: string | null;
  people: string[];
  topics: string[];
  dates: string[];
  actions: string[];
  type_evidence: string | null;
  summary_evidence: string | null;
  people_evidence: string[];
  topics_evidence: string[];
  dates_evidence: string[];
  actions_evidence: string[];
  quality_score: number;
  validation_flags: string[];
  provider: string | null;
  model: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface NoteWithMetadata {
  note: Note;
  metadata: MemoryMetadata | null;
}