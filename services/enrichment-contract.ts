import type { MemoryType } from '../src/types.js';

export const enrichmentSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['type', 'people', 'topics', 'dates', 'actions', 'evidence'],
  properties: {
    type: { type: ['string', 'null'], enum: ['note', 'task', 'idea', 'reminder', 'conversation', 'observation', 'other', null] },
    summary: { type: ['string', 'null'] },
    people: { type: 'array', items: { type: 'string' } },
    topics: { type: 'array', items: { type: 'string' } },
    dates: { type: 'array', items: { type: 'string' } },
    actions: { type: 'array', items: { type: 'string' } },
    evidence: {
      type: 'object',
      additionalProperties: false,
      required: ['type', 'summary', 'people', 'topics', 'dates', 'actions'],
      properties: {
        type: { type: ['string', 'null'] },
        summary: { type: ['string', 'null'] },
        people: { type: 'array', items: { type: 'string' } },
        topics: { type: 'array', items: { type: 'string' } },
        dates: { type: 'array', items: { type: 'string' } },
        actions: { type: 'array', items: { type: 'string' } },
      },
    },
  },
} as const;

export const classifierSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['intent', 'evidence'],
  properties: {
    intent: { type: ['string', 'null'], enum: ['task', 'idea', 'journal', 'note', null] },
    evidence: { type: ['string', 'null'] },
  },
} as const;

export const extractorSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['action_items', 'dates', 'people', 'topics', 'locations', 'evidence'],
  properties: {
    action_items: { type: 'array', items: { type: 'string' } },
    dates: { type: 'array', items: { type: 'string' } },
    people: { type: 'array', items: { type: 'string' } },
    topics: { type: 'array', items: { type: 'string' } },
    locations: { type: 'array', items: { type: 'string' } },
    evidence: {
      type: 'object',
      additionalProperties: false,
      required: ['action_items', 'dates', 'people', 'topics', 'locations'],
      properties: {
        action_items: { type: 'array', items: { type: 'string' } },
        dates: { type: 'array', items: { type: 'string' } },
        people: { type: 'array', items: { type: 'string' } },
        topics: { type: 'array', items: { type: 'string' } },
        locations: { type: 'array', items: { type: 'string' } },
      },
    },
  },
} as const;

export const synthesizerSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'summary', 'evidence'],
  properties: {
    title: { type: ['string', 'null'] },
    summary: { type: ['string', 'null'] },
    evidence: { type: ['string', 'null'] },
  },
} as const;

export interface ClassifierOutput {
  intent: 'task' | 'idea' | 'journal' | 'note' | null;
  evidence: string | null;
}

export interface ExtractorOutput {
  action_items: string[];
  dates: string[];
  people: string[];
  topics: string[];
  locations: string[];
  evidence: {
    action_items: string[];
    dates: string[];
    people: string[];
    topics: string[];
    locations: string[];
  };
}

export interface SynthesizerOutput {
  title: string | null;
  summary: string | null;
  evidence: string | null;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function uniqueOrdered(values: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];

  for (const value of values) {
    const normalized = normalizeWhitespace(value);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(normalized);
  }

  return output;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => normalizeWhitespace(item))
    .filter((item) => item.length > 0);
}

function toNullableText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = normalizeWhitespace(value);
  return normalized.length > 0 ? normalized : null;
}

const actionPrefixes = [
  /^i need to\s+/i,
  /^remember to\s+/i,
  /^we should\s+/i,
  /^i should\s+/i,
  /^let'?s\s+/i,
  /^we need to\s+/i,
  /^please\s+/i,
  /^can you\s+/i,
] as const;

function toSentenceCase(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function normalizeActionItem(value: string): string {
  let normalized = normalizeWhitespace(value);
  for (const expression of actionPrefixes) {
    normalized = normalized.replace(expression, '');
  }
  normalized = normalized.replace(/^to\s+/i, '');
  normalized = normalized.replace(/^[\-–—•]\s*/, '');
  normalized = normalized.replace(/[.\s]+$/g, '');
  return toSentenceCase(normalized);
}

function enforceDescriptiveTitle(title: string | null, summary: string | null): string | null {
  const candidate = title ?? summary;
  if (!candidate) return null;
  const cleaned = normalizeWhitespace(candidate).replace(/[.\s]+$/g, '');
  if (!cleaned) return null;

  const genericWords = new Set(['fix', 'todo', 'task', 'note', 'idea', 'journal', 'reminder']);
  const wordCount = cleaned.split(' ').length;
  if (wordCount === 1 && genericWords.has(cleaned.toLowerCase())) {
    return summary ?? null;
  }

  return toSentenceCase(cleaned);
}

function mapClassifierIntentToMemoryType(intent: ClassifierOutput['intent']): MemoryType | null {
  if (intent === 'task') return 'task';
  if (intent === 'idea') return 'idea';
  if (intent === 'note') return 'note';
  if (intent === 'journal') return 'observation';
  return null;
}

export function parseClassifierOutput(value: unknown): ClassifierOutput {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { intent: null, evidence: null };
  }

  const output = value as Record<string, unknown>;
  const intent = output.intent;
  const safeIntent = intent === 'task' || intent === 'idea' || intent === 'journal' || intent === 'note'
    ? intent
    : null;

  return {
    intent: safeIntent,
    evidence: toNullableText(output.evidence),
  };
}

export function parseExtractorOutput(value: unknown): ExtractorOutput {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {
      action_items: [],
      dates: [],
      people: [],
      topics: [],
      locations: [],
      evidence: {
        action_items: [],
        dates: [],
        people: [],
        topics: [],
        locations: [],
      },
    };
  }

  const output = value as Record<string, unknown>;
  const evidence = typeof output.evidence === 'object' && output.evidence !== null && !Array.isArray(output.evidence)
    ? output.evidence as Record<string, unknown>
    : {};

  return {
    action_items: uniqueOrdered(toStringArray(output.action_items).map(normalizeActionItem).filter((item) => item.length > 0)),
    dates: uniqueOrdered(toStringArray(output.dates)),
    people: uniqueOrdered(toStringArray(output.people)),
    topics: uniqueOrdered(toStringArray(output.topics)),
    locations: uniqueOrdered(toStringArray(output.locations)),
    evidence: {
      action_items: uniqueOrdered(toStringArray(evidence.action_items)),
      dates: uniqueOrdered(toStringArray(evidence.dates)),
      people: uniqueOrdered(toStringArray(evidence.people)),
      topics: uniqueOrdered(toStringArray(evidence.topics)),
      locations: uniqueOrdered(toStringArray(evidence.locations)),
    },
  };
}

export function parseSynthesizerOutput(value: unknown): SynthesizerOutput {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { title: null, summary: null, evidence: null };
  }

  const output = value as Record<string, unknown>;
  const summary = toNullableText(output.summary);
  const title = enforceDescriptiveTitle(toNullableText(output.title), summary);

  return {
    title,
    summary,
    evidence: toNullableText(output.evidence),
  };
}

export function combineStageOutputs(
  classifier: ClassifierOutput,
  extractor: ExtractorOutput,
  synthesizer: SynthesizerOutput,
): unknown {
  const mappedType = mapClassifierIntentToMemoryType(classifier.intent);
  const combinedTopics = uniqueOrdered([...extractor.topics, ...extractor.locations]);

  return {
    title: synthesizer.title,
    type: mappedType,
    summary: synthesizer.summary,
    people: extractor.people,
    topics: combinedTopics,
    dates: extractor.dates,
    actions: extractor.action_items,
    evidence: {
      type: classifier.evidence ?? synthesizer.evidence,
      summary: synthesizer.evidence,
      people: extractor.evidence.people,
      topics: uniqueOrdered([...extractor.evidence.topics, ...extractor.evidence.locations]),
      dates: extractor.evidence.dates,
      actions: extractor.evidence.action_items,
    },
  };
}

export function buildClassifierPrompt(content: string): string {
  return `Stage 1 of 3: classify the memory intent.

Return only JSON matching the supplied schema.

Intent options:
- task: a concrete action to perform
- idea: a proposal or possibility to explore
- journal: reflective/status personal logging
- note: neutral factual capture

Rules:
- Pick exactly one best intent.
- Use journal when the text is reflective or day-log style.
- evidence must be a direct verbatim snippet from memory text or null.

Captured memory:
${content}`;
}

export function buildExtractorPrompt(content: string, intent: ClassifierOutput['intent']): string {
  return `Stage 2 of 3: extract structure from the memory.

Return only JSON matching the supplied schema.

Detected intent from Stage 1: ${intent ?? 'unknown'}

Rules:
- Extract only explicitly stated facts.
- Action items must start with strong imperative verbs.
- Strip conversational filler prefixes from action items: "I need to", "remember to", "we should", "I should", "let's", "we need to".
- Keep actions concise and actionable.
- For each list field, evidence must be verbatim snippets from the memory.
- If no values are present, return empty arrays.

Few-shot examples:
Input: "I need to fix the docker container before dinner."
Output action_items: ["Fix the docker container"]

Input: "Remember to buy milk and steak tomorrow."
Output action_items: ["Buy milk and steak"]
Output dates: ["tomorrow"]

Input: "We should call Sarah on Friday about the design review."
Output action_items: ["Call Sarah about the design review"]
Output people: ["Sarah"]
Output dates: ["Friday"]

Captured memory:
${content}`;
}

export function buildSynthesizerPrompt(
  content: string,
  classifier: ClassifierOutput,
  extractor: ExtractorOutput,
): string {
  return `Stage 3 of 3: synthesize a clean title and summary.

Return only JSON matching the supplied schema.

Context from previous stages:
- intent: ${classifier.intent ?? 'unknown'}
- action_items: ${JSON.stringify(extractor.action_items)}
- people: ${JSON.stringify(extractor.people)}
- dates: ${JSON.stringify(extractor.dates)}
- topics: ${JSON.stringify(extractor.topics)}

Rules:
- Title must be descriptive and human-readable.
- Never output a single generic title such as "fix", "todo", or "note".
- Summary must be informative and concise, 1-2 sentences maximum.
- If there is no meaningful summary, set summary to null.
- evidence must be a direct verbatim snippet from memory text or null.

Captured memory:
${content}`;
}

export function buildEnrichmentPrompt(content: string): string {
  return `${buildClassifierPrompt(content)}\n\n${buildExtractorPrompt(content, null)}\n\n${buildSynthesizerPrompt(content, { intent: null, evidence: null }, {
    action_items: [],
    dates: [],
    people: [],
    topics: [],
    locations: [],
    evidence: {
      action_items: [],
      dates: [],
      people: [],
      topics: [],
      locations: [],
    },
  })}`;
}