import type { FastifyBaseLogger } from 'fastify';

import type { Database, Note } from '../src/types.js';
import type { MemoryEnrichmentService } from './memory-enrichment.js';
import { writeObsidianVoiceNote } from './obsidian-vault.js';
import { saveMemoryMetadata } from './notes.js';

export class BackgroundMemoryEnrichment {
  private readonly tasks = new Set<Promise<void>>();
  private stopping = false;

  constructor(
    private readonly database: Database,
    private readonly enrichmentService: MemoryEnrichmentService,
    private readonly obsidianVaultPath: string,
    private readonly logger: FastifyBaseLogger,
  ) {}

  schedule(note: Note): void {
    if (this.stopping) {
      this.logger.warn({ noteId: note.id }, 'Memory enrichment skipped during shutdown.');
      return;
    }

    const task = this.enrich(note);
    this.tasks.add(task);
    void task.finally(() => this.tasks.delete(task));
  }

  async stop(): Promise<void> {
    this.stopping = true;
    await Promise.allSettled(this.tasks);
  }

  private async enrich(note: Note): Promise<void> {
    try {
      const enrichment = await this.enrichmentService.enrich(note.content);
      if (!enrichment) return;

      await saveMemoryMetadata(this.database, {
        note_id: note.id,
        ...enrichment,
        provider: this.enrichmentService.provider.name,
        model: this.enrichmentService.provider.model,
      });

      if (note.audio_path) {
        await writeObsidianVoiceNote(this.obsidianVaultPath, note, enrichment);
      }
    } catch (error) {
      this.logger.warn({ err: error, noteId: note.id }, 'Memory enrichment failed; raw note was stored.');
    }
  }
}