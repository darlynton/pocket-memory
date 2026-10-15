import { memoryTypes, type MemoryMetadata, type MemoryType } from '../src/types.js';

export interface MemoryEnrichment {
  title: string | null;
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
}

export interface StructuredMemoryObject {
  title: string | null;
  intent: string | null;
  summary: string | null;
  action_items: string[];
  tags: string[];
}

interface EvidencePayload {
  type: unknown;
  summary: unknown;
  people: unknown;
  topics: unknown;
  dates: unknown;
  actions: unknown;
}

export interface MemoryEnrichmentProvider {
  readonly name: string;
  readonly model: string | null;
  enrich(content: string): Promise<unknown>;
}

export interface MemoryEnrichmentService {
  enrich(content: string): Promise<MemoryEnrichment | null>;
  provider: Pick<MemoryEnrichmentProvider, 'name' | 'model'>;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function hasText(value: string | null): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalize(value: string): string {
  return value.toLowerCase();
}

function sourceContains(source: string, candidate: string): boolean {
  return normalize(source).includes(normalize(candidate));
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function uniqueOrdered(values: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];

  values.forEach((value) => {
    const normalized = normalizeWhitespace(value);
    if (normalized.length === 0) return;
    const key = normalized.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    output.push(normalized);
  });

  return output;
}

function collectRegexMatches(source: string, expression: RegExp): string[] {
  const flags = expression.flags.includes('g') ? expression.flags : `${expression.flags}g`;
  const globalExpression = new RegExp(expression.source, flags);
  const values: string[] = [];
  for (const match of source.matchAll(globalExpression)) {
    const snippet = match[0];
    if (snippet) values.push(snippet);
  }
  return uniqueOrdered(values);
}

function splitIntoClauses(sourceContent: string): string[] {
  const normalized = normalizeWhitespace(sourceContent);
  if (normalized.length === 0) return [];

  const roughClauses = normalized
    .split(/(?<=[.!?])\s+|\s+(?:and then|afterwards?|after that|because|since|while|but|so|also|then)\s+|\s+(?=(?:i|we|you|they|he|she)\s+(?:have to|need to|must|will|would|am|was|were|checked|check|make sure|turn|turns|turned|lock|locks|locked|clean|continue|consider(?:ing)?|going to|go|want to|pick up|buy|call|schedule|arrange|stay|get|got)\b)/i)
    .map((part) => normalizeWhitespace(part))
    .filter((part) => part.length > 0);

  return uniqueOrdered(roughClauses.length > 0 ? roughClauses : [normalized]);
}

function deriveProfileSummary(sourceContent: string): string | null {
  const normalized = normalizeWhitespace(sourceContent);
  if (normalized.length === 0) return null;

  const rolePatterns = [
    /\bi currently work as (?:an?\s+)?(.+?)\s+at\s+(.+?)(?=\s+(?:i started|and i started|my current base salary|salary|i have worked|i worked|one project involved|my role|my position)\b|$)/i,
    /\bi work as (?:an?\s+)?(.+?)\s+at\s+(.+?)(?=\s+(?:since|from|i started|my current base salary|salary|i have worked|i worked|one project involved|my role|my position)\b|$)/i,
    /\bi(?:'m| am) (?:an?\s+)?(.+?)\s+at\s+(.+?)(?=\s+(?:since|from|i started|my current base salary|salary|i have worked|i worked|one project involved|my role|my position)\b|$)/i,
    /\bmy (?:role|position) is (?:an?\s+)?(.+?)\s+at\s+(.+?)(?=\s+(?:since|from|i started|salary|i have worked|i worked|one project involved)\b|$)/i,
  ];

  const roleMatch = rolePatterns
    .map((pattern) => normalized.match(pattern))
    .find((match) => match !== null);

  const startedPatterns = [
    /\bi started in\s+([^.,;]+?)(?=\s+(?:and|my|i|with|$))/i,
    /\bsince\s+([^.,;]+?)(?=\s+(?:and|my|i|with|$))/i,
    /\bfrom\s+([^.,;]+?)(?=\s+(?:to|and|my|i|with|$))/i,
  ];

  const startedMatch = startedPatterns
    .map((pattern) => normalized.match(pattern))
    .find((match) => match !== null);

  if (!roleMatch) return null;

  const role = normalizeWhitespace(roleMatch[1] ?? '');
  const company = normalizeWhitespace(roleMatch[2] ?? '');
  if (!role || !company) return null;

  const started = normalizeWhitespace(startedMatch?.[1] ?? '').replace(/\b(?:the|a|an)\b\s*/i, '');
  const summary = started
    ? `${role} at ${company} since ${started}`
    : `${role} at ${company}`;

  return shortenSummary(summary);
}

function extractDateFallbacks(sourceContent: string): string[] {
  const patterns = [
    /\b(?:today|tonight|tomorrow|yesterday)\b/gi,
    /\b(?:this|next|last)\s+(?:week|month|year|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi,
    /\b(?:by|before|after|on|in|at)\s+(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi,
    /\b\d{1,2}:\d{2}\s?(?:am|pm)\b/gi,
    /\b(?:at|around)\s+\d{1,2}(?::\d{2})?\s?(?:am|pm)?\b/gi,
  ];

  const clauses = splitIntoClauses(sourceContent);
  const matches = clauses.flatMap((clause) => patterns.flatMap((pattern) => collectRegexMatches(clause, pattern)));
  return uniqueOrdered(matches);
}

function extractActionFallbacks(sourceContent: string): string[] {
  const clauses = splitIntoClauses(sourceContent);
  const patterns = [
    /\b(?:consider(?:ing)?|plan(?:ning)?|intend(?:ing)?|need(?:ing)?|want(?:ing)?|going|have to|must|remember|remind|continue)\b[^,.!?;]{0,140}/ig,
    /\b(?:check(?:ed|ing)?|make sure|turn(?:ed)? off|lock(?:ed)?|clean(?:ed)?|pick up|buy|call|schedule|arrange|stay up late)\b[^,.!?;]{0,140}/ig,
  ];

  const matches = clauses.flatMap((clause) => patterns.flatMap((pattern) => collectRegexMatches(clause, pattern).map(shortenSummary)));
  return uniqueOrdered(matches.filter((value) => isInformativeAction(value)));
}

function extractTopicFallbacks(sourceContent: string): string[] {
  const stopwords = new Set([
    'the', 'a', 'an', 'lot', 'bit', 'space', 'place', 'time', 'day', 'week', 'month', 'year',
  ]);

  const boundaryTokens = new Set([
    'by', 'because', 'however', 'but', 'if', 'when', 'then', 'while', 'not', 'is', 'are', 'was', 'were', 'have', 'has', 'had', 'to', 'for', 'and', 'or', 'with', 'of', 'in', 'on', 'at', 'off', 'just', 'well', 'still', 'maybe', 'so', 'that', 'which', 'who', 'as', 'from', 'this', 'these', 'those',
  ]);
  const trailingNoise = new Set([
    'a', 'an', 'the', 'i', 'me', 'my', 'we', 'our', 'you', 'your', 'turn', 'turned', 'checked', 'check', 'make', 'sure', 'clean', 'locked', 'turns', 'mowing', 'mow', 'stay', 'continue', 'going', 'looks', 'look', 'doing', 'did', 'does', 'do', 'need', 'needed', 'want', 'wanted', 'consider', 'considering',
  ]);

  function sanitizeTopic(value: string): string {
    const tokens = normalizeWhitespace(value).split(' ').filter((token) => token.length > 0);
    const collected: string[] = [];
    for (const token of tokens) {
      const lower = token.toLowerCase();
      if (boundaryTokens.has(lower) || trailingNoise.has(lower)) break;
      collected.push(token);
    }
    while (collected.length > 0 && trailingNoise.has(collected[collected.length - 1].toLowerCase())) {
      collected.pop();
    }
    return collected.join(' ');
  }

  const explicitPhrases = [
    /\blong recordings?\b/gi,
    /\blong sentences?\b/gi,
    /\blong messages?\b/gi,
    /\blong conversations?\b/gi,
    /\bpocket memory\b/gi,
    /\blong notes?\b/gi,
    /\bsummary\b/gi,
    /\bclassification\b/gi,
    /\bdatabase\b/gi,
  ];

  const explicitTopics = explicitPhrases.flatMap((pattern) => collectRegexMatches(sourceContent, pattern));

  const clauses = splitIntoClauses(sourceContent);
  const nounPhrases = clauses.flatMap((clause) => Array.from(clause.matchAll(/\b(?:a|an|the|my|our|their|this|that)\s+([a-z][a-z'’-]*(?:\s+[a-z][a-z'’-]*){0,3})/gi))
    .map((match) => sanitizeTopic(match[1] ?? '')))
    .filter((value) => value.length >= 4)
    .filter((value) => !stopwords.has(value.toLowerCase()));

  const combined = [...explicitTopics, ...nounPhrases].filter((value) => {
    const lower = value.toLowerCase();
    if (!lower) return false;
    if (/\b(?:write|resolve|goes|going|want|see|able|interpret|make sure|update|latest update|plan|latest|model|go|how it|getting on)\b/.test(lower)) return false;
    if (wordCount(value) > 4) return false;
    return true;
  });

  return uniqueOrdered(combined);
}

function refineTypeFromSource(type: MemoryType | null, sourceContent: string): MemoryType | null {
  const text = normalizeWhitespace(sourceContent).toLowerCase();
  const hasIdeaCue = /\b(?:consider(?:ing)?|thinking about|idea|maybe|get(?:ting)?|could)\b/.test(text);
  const hasReminderCue = /\b(?:remember|remind|don't forget)\b/.test(text);
  const hasTaskCue = /\b(?:need to|must|todo|to do|have to|make sure|check(?:ed|ing)?|turn(?:ed)? off|lock(?:ed)?|clean(?:ed)?|continue to|stay up late|go to|going to|pick up|buy|call(?!\s+to\s+action)|schedule|arrange)\b/.test(text);
  const hasProfileCue = /\b(?:i currently work as|i work as|i started in|base salary|experience (?:bands|includes?)|i have worked on|one project involved)\b/.test(text);
  const hasDialogueMarkers = /[“”"']/g.test(sourceContent) || /\b(?:said|asked|told|replied|responded|says|asks|tells)\b/.test(text);
  const hasConversationCue = hasDialogueMarkers && /\b(?:conversation|dialogue|talk(?:ed|ing)?|chat(?:ted|ting)?|discussion)\b/.test(text);

  if (hasProfileCue && !hasReminderCue && !hasTaskCue) return 'observation';
  if (hasReminderCue) return 'reminder';
  if (hasTaskCue) return 'task';
  if (type === 'conversation' && !hasConversationCue) {
    if (hasIdeaCue) return 'idea';
    if (/\b(?:i spent|i reviewed|i am|i'm|i have|i want|i need|i was|i've)\b/.test(text)) return 'observation';
    return 'note';
  }
  if (hasConversationCue && type !== 'task' && type !== 'reminder' && type !== 'idea') return 'conversation';

  if (type === 'conversation' || type === 'note' || type === 'observation' || type === 'other' || type === null) {
    if (hasIdeaCue) return 'idea';
  }

  return type;
}

function filterPeople(values: string[], evidence: string[]): { values: string[]; evidence: string[] } {
  const pronouns = new Set(['i', 'me', 'my', 'mine', 'we', 'us', 'our', 'ours']);
  const filteredValues: string[] = [];
  const filteredEvidence: string[] = [];

  for (let index = 0; index < values.length; index += 1) {
    const person = normalizeWhitespace(values[index]);
    if (pronouns.has(person.toLowerCase())) continue;
    filteredValues.push(person);
    filteredEvidence.push(evidence[index] ?? person);
  }

  return { values: filteredValues, evidence: filteredEvidence };
}

function filterTopics(values: string[], evidence: string[]): { values: string[]; evidence: string[] } {
  const filteredValues: string[] = [];
  const filteredEvidence: string[] = [];
  const noisyPatterns = /\b(?:write|resolve|goes|going|want|see|able|interpret|make sure|update|latest update|plan)\b/i;

  for (let index = 0; index < values.length; index += 1) {
    const topic = normalizeWhitespace(values[index]);
    if (!topic) continue;
    if (wordCount(topic) > 4) continue;
    if (noisyPatterns.test(topic)) continue;
    filteredValues.push(topic);
    filteredEvidence.push(evidence[index] ?? topic);
  }

  return { values: filteredValues, evidence: filteredEvidence };
}

function wordCount(value: string): number {
  const trimmed = normalizeWhitespace(value);
  return trimmed.length === 0 ? 0 : trimmed.split(' ').length;
}

function isConciseSummary(summary: string): boolean {
  const words = wordCount(summary);
  return words >= 3 && words <= 12 && normalizeWhitespace(summary).length <= 90;
}

function shortenSummary(value: string): string {
  const cleaned = normalizeWhitespace(value).replace(/[\s,;:.!?-]+$/g, '');
  const words = cleaned.split(' ');
  return words.length <= 12 ? cleaned : words.slice(0, 12).join(' ');
}

function isInformativeAction(value: string): boolean {
  return wordCount(value) >= 4;
}

function deriveSummaryFromSource(sourceContent: string): string {
  const clauses = splitIntoClauses(sourceContent);
  const scoredClauses = clauses.map((clause) => {
    const lower = clause.toLowerCase();
    let score = 0;
    if (/\b(?:consider|considering|need|want|plan|going to|make sure|check|checked|turn(?:ed)? off|lock(?:ed)?|clean(?:ed)?|continue|remember|remind)\b/.test(lower)) score += 4;
    if (/\b(?:today|tonight|tomorrow|yesterday|next|last|by|before|after|at|around)\b/.test(lower)) score += 2;
    if (/\b(i|we|you)\b/.test(lower)) score += 1;
    if (wordCount(clause) <= 4) score -= 1;
    if (wordCount(clause) > 18) score -= 1;
    return { clause, score };
  });

  const bestClause = scoredClauses.sort((a, b) => b.score - a.score)[0]?.clause ?? clauses[0] ?? normalizeWhitespace(sourceContent);
  const withoutLeadingSubject = bestClause.replace(/^(?:i['’]?m|i am|i['’]?ll|i will|we['’]?re|we are|we['’]?ll|we will)\s+/i, '');
  return shortenSummary(withoutLeadingSubject);
}

function deriveIntentSummary(sourceContent: string): string | null {
  const text = normalizeWhitespace(sourceContent).toLowerCase();
  const mentionsPocketMemory = /\bpocket memory\b/.test(text);
  const mentionsTesting = /\b(?:test|testing|try|verify|see how|getting on|check how|latest update)\b/.test(text);
  const mentionsLongForm = /\b(?:long recordings?|long sentences?|long messages?|long conversations?)\b/.test(text);
  const mentionsOutputs = /\b(?:summary|classification|database|interpret|transcribe|enrichment)\b/.test(text);

  if (!mentionsTesting && !mentionsLongForm && !mentionsOutputs) {
    return null;
  }

  const subject = mentionsPocketMemory ? 'Pocket Memory' : 'enrichment';
  const focusBits: string[] = [];
  if (mentionsLongForm) focusBits.push('long recordings and conversations');
  if (mentionsOutputs) focusBits.push('summary/classification output');

  if (focusBits.length === 0) {
    focusBits.push('the recording workflow');
  }

  const actionVerb = mentionsTesting ? 'Testing' : 'Working on';
  return shortenSummary(`${actionVerb} ${subject} for ${focusBits[0]}`);
}

function buildSummaryDecision(
  type: MemoryType | null,
  sourceContent: string,
  summaryCandidate: string | null,
  actions: string[],
  actionsEvidence: string[],
  typeEvidence: string | null,
): { summary: string | null; summary_evidence: string | null; summary_source: 'model' | 'derived' | 'none' } {
  const profileSummary = deriveProfileSummary(sourceContent);

  if (profileSummary && (type === 'observation' || type === 'note' || type === 'other' || type === null || type === 'task')) {
    return {
      summary: profileSummary,
      summary_evidence: profileSummary,
      summary_source: 'derived',
    };
  }

  if (summaryCandidate && isConciseSummary(summaryCandidate) && sourceContains(sourceContent, summaryCandidate)) {
    return {
      summary: shortenSummary(summaryCandidate),
      summary_evidence: summaryCandidate,
      summary_source: 'model',
    };
  }

  if (type === 'task' || type === 'reminder' || type === 'idea') {
    const intentSummary = deriveIntentSummary(sourceContent);
    if (intentSummary) {
      return {
        summary: intentSummary,
        summary_evidence: intentSummary,
        summary_source: 'derived',
      };
    }

    const firstActionIndex = actions.findIndex((action) => hasText(action));
    if (firstActionIndex >= 0) {
      const firstAction = actions[firstActionIndex];
      if (isInformativeAction(firstAction)) {
        return {
          summary: shortenSummary(firstAction),
          summary_evidence: actionsEvidence[firstActionIndex] ?? firstAction,
          summary_source: 'derived',
        };
      }
    }
  }

  const derived = buildFallbackSummary(sourceContent, actions);
  return {
    summary: derived.length > 0 ? derived : null,
    summary_evidence: derived.length > 0 ? derived : typeEvidence,
    summary_source: derived.length > 0 ? 'derived' : 'none',
  };
}

function preferInformativeActions(values: string[], evidence: string[]): { values: string[]; evidence: string[] } {
  if (values.length === 0) return { values, evidence };

  const filteredValues: string[] = [];
  const filteredEvidence: string[] = [];
  for (let index = 0; index < values.length; index += 1) {
    const action = values[index];
    if (!isInformativeAction(action)) continue;
    filteredValues.push(action);
    filteredEvidence.push(evidence[index] ?? action);
  }

  return filteredValues.length > 0
    ? { values: filteredValues, evidence: filteredEvidence }
    : { values: [], evidence: [] };
}
function buildFallbackSummary(sourceContent: string, actions: string[]): string {
  const firstAction = actions.map((action) => normalizeWhitespace(action)).find((action) => action.length > 0);
  if (firstAction) {
    return shortenSummary(firstAction);
  }

  return deriveSummaryFromSource(sourceContent);
}

function sanitizeEvidenceArray(
  source: string,
  values: string[],
  evidence: unknown,
  field: 'people' | 'topics' | 'dates' | 'actions',
): { values: string[]; evidence: string[] } {
  if (!isStringArray(evidence) || values.length === 0) {
    return { values: [], evidence: [] };
  }

  const safeValues: string[] = [];
  const safeEvidence: string[] = [];
  const pairCount = Math.min(values.length, evidence.length);

  for (let index = 0; index < pairCount; index += 1) {
    const value = values[index];
    const snippet = evidence[index];
    if (!hasText(snippet)) continue;
    if (!sourceContains(source, snippet)) continue;
    if (!sourceContains(snippet, value)) continue;
    safeValues.push(value);
    safeEvidence.push(snippet);
  }

  return { values: safeValues, evidence: safeEvidence };
}

function mergeWithFallback(values: string[], evidence: unknown, fallbackValues: string[]): { values: string[]; evidence: string[] } {
  if (values.length > 0) {
    return {
      values,
      evidence: isStringArray(evidence) ? evidence : [],
    };
  }

  const fallback = uniqueOrdered(fallbackValues);
  return {
    values: fallback,
    evidence: fallback,
  };
}

function computeQualityScore(type: MemoryType | null, summary: string | null, people: string[], topics: string[], dates: string[], actions: string[], summarySource: 'model' | 'derived' | 'none'): { quality_score: number; validation_flags: string[] } {
  let score = 100;
  const flags: string[] = [];

  if (!type) {
    score -= 10;
    flags.push('type_missing');
  }

  if ((type === 'task' || type === 'reminder' || type === 'idea') && !summary) {
    score -= 15;
    flags.push('summary_missing');
  }

  if (summarySource === 'derived') {
    flags.push('summary_derived');
  }

  if (people.length === 0) {
    score -= 5;
    flags.push('people_empty');
  }

  if (topics.length === 0) {
    score -= 10;
    flags.push('topics_empty');
  }

  if (dates.length === 0) {
    score -= 5;
    flags.push('dates_empty');
  }

  if (actions.length === 0) {
    score -= 5;
    flags.push('actions_empty');
  }

  if ((type === 'task' || type === 'reminder') && actions.length === 0) {
    score -= 15;
    flags.push('actionable_type_without_actions');
  }

  return {
    quality_score: Math.max(0, score),
    validation_flags: flags,
  };
}

export function validateMemoryEnrichment(value: unknown, sourceContent: string): MemoryEnrichment {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('AI enrichment must be a JSON object.');
  }

  const output = value as Record<string, unknown>;
  const allowedKeys = new Set(['title', 'type', 'summary', 'people', 'topics', 'dates', 'actions', 'evidence']);
  if (Object.keys(output).some((key) => !allowedKeys.has(key))) {
    throw new Error('AI enrichment contains unsupported fields.');
  }

  if (output.title !== undefined && output.title !== null && typeof output.title !== 'string') {
    throw new Error('AI enrichment title must be a string or null.');
  }

  const title = (output.title ?? null) as string | null;

  const type = output.type;
  if (type !== null && !memoryTypes.includes(type as MemoryType)) {
    throw new Error('AI enrichment has an invalid type.');
  }

  if (output.summary !== undefined && output.summary !== null && typeof output.summary !== 'string') {
    throw new Error('AI enrichment summary must be a string or null.');
  }

  const summary = (output.summary ?? null) as string | null;
  const refinedType = refineTypeFromSource(type as MemoryType | null, sourceContent);
  const people = output.people;
  const topics = output.topics;
  const dates = output.dates;
  const actions = output.actions;
  if (!isStringArray(people) || !isStringArray(topics) || !isStringArray(dates) || !isStringArray(actions)) {
    throw new Error('AI enrichment arrays must contain only strings.');
  }

  const evidence = output.evidence as EvidencePayload | undefined;
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
    throw new Error('AI enrichment evidence must be an object.');
  }

  const typeEvidence = evidence.type;
  const summaryEvidence = evidence.summary;

  if (typeEvidence !== null && typeof typeEvidence !== 'string') {
    throw new Error('AI enrichment type evidence must be a string or null.');
  }

  if (summaryEvidence !== null && typeof summaryEvidence !== 'string') {
    throw new Error('AI enrichment summary evidence must be a string or null.');
  }

  let normalizedTypeEvidence = hasText(typeEvidence as string | null) ? typeEvidence as string : null;
  const normalizedSummaryEvidence = hasText(summaryEvidence as string | null) ? summaryEvidence as string : null;

  if (normalizedTypeEvidence && !sourceContains(sourceContent, normalizedTypeEvidence)) {
    normalizedTypeEvidence = null;
  }

  if (refinedType !== null && !normalizedTypeEvidence) {
    normalizedTypeEvidence = normalizedSummaryEvidence;
  }

  if (refinedType !== null && !normalizedTypeEvidence) {
    const candidateFromActionEvidence = isStringArray(evidence.actions)
      ? evidence.actions.find((snippet) => hasText(snippet) && sourceContains(sourceContent, snippet)) ?? null
      : null;
    const candidateFromSource = deriveSummaryFromSource(sourceContent);
    const fallbackCandidate = candidateFromActionEvidence ?? candidateFromSource;
    normalizedTypeEvidence = hasText(fallbackCandidate) && sourceContains(sourceContent, fallbackCandidate)
      ? fallbackCandidate
      : null;
  }

  if (refinedType !== null && !normalizedTypeEvidence) {
    throw new Error('AI enrichment type evidence is required when type is present.');
  }

  const summaryDecision = buildSummaryDecision(
    refinedType,
    sourceContent,
    typeof summary === 'string' ? summary : null,
    actions,
    isStringArray(evidence.actions) ? evidence.actions : [],
    normalizedTypeEvidence,
  );

  const shouldBackfill = refinedType === 'task' || refinedType === 'reminder' || refinedType === 'idea';
  const groundedPeople = filterPeople(
    ...((() => {
      const safe = sanitizeEvidenceArray(sourceContent, people, evidence.people, 'people');
      return [safe.values, safe.evidence] as const;
    })()),
  );
  const groundedTopics = filterTopics(
    ...((() => {
      const safe = sanitizeEvidenceArray(sourceContent, topics, evidence.topics, 'topics');
      return [safe.values, safe.evidence] as const;
    })()),
  );
  const groundedDates = sanitizeEvidenceArray(sourceContent, dates, evidence.dates, 'dates');
  const groundedActions = preferInformativeActions(
    ...((() => {
      const safe = sanitizeEvidenceArray(sourceContent, actions, evidence.actions, 'actions');
      return [safe.values, safe.evidence] as const;
    })()),
  );

  const mergedDates = shouldBackfill
    ? mergeWithFallback(groundedDates.values, groundedDates.evidence, extractDateFallbacks(sourceContent))
    : groundedDates;
  const mergedActions = shouldBackfill
    ? mergeWithFallback(groundedActions.values, groundedActions.evidence, extractActionFallbacks(sourceContent))
    : groundedActions;
  const mergedTopics = shouldBackfill
    ? filterTopics(
      ...((() => {
        const merged = mergeWithFallback(groundedTopics.values, groundedTopics.evidence, extractTopicFallbacks(sourceContent));
        return [merged.values, merged.evidence] as const;
      })()),
    )
    : groundedTopics;

  const quality = computeQualityScore(
    refinedType,
    summaryDecision.summary,
    groundedPeople.values,
    mergedTopics.values,
    mergedDates.values,
    mergedActions.values,
    summaryDecision.summary_source,
  );

  return {
    title,
    type: refinedType,
    summary: summaryDecision.summary,
    people: groundedPeople.values,
    topics: mergedTopics.values,
    dates: mergedDates.values,
    actions: mergedActions.values,
    type_evidence: normalizedTypeEvidence,
    summary_evidence: summaryDecision.summary_evidence ?? normalizedSummaryEvidence,
    people_evidence: groundedPeople.evidence,
    topics_evidence: mergedTopics.evidence,
    dates_evidence: mergedDates.evidence,
    actions_evidence: mergedActions.evidence,
    quality_score: quality.quality_score,
    validation_flags: quality.validation_flags,
  };
}

export function createMemoryEnrichmentService(provider: MemoryEnrichmentProvider): MemoryEnrichmentService {
  return {
    provider: { name: provider.name, model: provider.model },
    async enrich(content: string): Promise<MemoryEnrichment> {
      return validateMemoryEnrichment(await provider.enrich(content), content);
    },
  };
}

export function createDisabledMemoryEnrichmentService(): MemoryEnrichmentService {
  return {
    provider: { name: 'disabled', model: null },
    async enrich(): Promise<null> {
      return null;
    },
  };
}

export function toStructuredMemoryObject(enrichment: MemoryEnrichment | null): StructuredMemoryObject | null {
  if (!enrichment) return null;

  const title = enrichment.title
    ? shortenSummary(enrichment.title)
    : enrichment.summary
      ? shortenSummary(enrichment.summary)
      : enrichment.actions[0] ?? enrichment.topics[0] ?? null;

  return {
    title,
    intent: enrichment.type,
    summary: enrichment.summary,
    action_items: enrichment.actions,
    tags: enrichment.topics,
  };
}