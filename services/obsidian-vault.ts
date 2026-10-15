import fs from 'node:fs';
import path from 'node:path';

import type { MemoryEnrichment } from './memory-enrichment.js';
import type { Note } from '../src/types.js';

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function formatTimestamp(date: Date): string {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}`;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function yamlQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function buildMarkdown(note: Note, enrichment: MemoryEnrichment): string {
  const title = normalizeWhitespace(enrichment.title ?? enrichment.summary ?? `Memory ${note.id.slice(0, 8)}`);
  const safeTitle = title.length > 0 ? title : `Memory ${note.id.slice(0, 8)}`;
  const summary = normalizeWhitespace(enrichment.summary ?? 'No summary available.');
  const tags = enrichment.topics;
  const actionItems = enrichment.actions;
  const audioPath = note.audio_path ?? '';

  const frontmatter = [
    '---',
    `id: ${yamlQuote(note.id)}`,
    `created_at: ${yamlQuote(note.created_at.toISOString())}`,
    `intent: ${enrichment.type ? yamlQuote(enrichment.type) : 'null'}`,
    'tags:',
    ...(tags.length > 0 ? tags.map((tag) => `  - ${yamlQuote(tag)}`) : ['  -']),
    `audio_path: ${audioPath ? yamlQuote(audioPath) : 'null'}`,
    '---',
  ].join('\n');

  const summaryCallout = [
    '> [!summary] Summary',
    `> ${summary}`,
  ].join('\n');

  const actionsSection = actionItems.length > 0
    ? actionItems.map((action) => `- [ ] ${action}`).join('\n')
    : '- [ ]';

  const audioLink = audioPath ? `[[${audioPath}]]` : '';

  return [
    frontmatter,
    '',
    `# ${safeTitle}`,
    '',
    summaryCallout,
    '',
    '## ✍️ Raw Transcript',
    note.content,
    '',
    '## 📋 Action Items',
    actionsSection,
    '',
    audioLink,
    '',
  ].join('\n');
}

export async function writeObsidianVoiceNote(
  vaultPath: string,
  note: Note,
  enrichment: MemoryEnrichment,
): Promise<string> {
  const title = normalizeWhitespace(enrichment.title ?? enrichment.summary ?? `memory-${note.id.slice(0, 8)}`);
  const slug = slugify(title) || `memory-${note.id.slice(0, 8)}`;
  const fileName = `${formatTimestamp(note.created_at)}-${slug}.md`;

  const absoluteVaultPath = path.resolve(vaultPath);
  await fs.promises.mkdir(absoluteVaultPath, { recursive: true });

  const filePath = path.join(absoluteVaultPath, fileName);
  await fs.promises.writeFile(filePath, buildMarkdown(note, enrichment), 'utf8');

  return filePath;
}
