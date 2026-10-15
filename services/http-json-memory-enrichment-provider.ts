import type { MemoryEnrichmentProvider } from './memory-enrichment.js';
import {
  buildClassifierPrompt,
  buildExtractorPrompt,
  buildSynthesizerPrompt,
  classifierSchema,
  combineStageOutputs,
  enrichmentSchema,
  extractorSchema,
  parseClassifierOutput,
  parseExtractorOutput,
  parseSynthesizerOutput,
  synthesizerSchema,
} from './enrichment-contract.js';

interface JsonRecord {
  [key: string]: unknown;
}

export interface HttpJsonMemoryEnrichmentProviderOptions {
  name?: string;
  baseUrl: string;
  model: string;
  path?: string;
  responseField?: string;
  fetch?: typeof fetch;
}

export class HttpJsonMemoryEnrichmentProvider implements MemoryEnrichmentProvider {
  readonly name: string;
  readonly model: string;
  private readonly baseUrl: string;
  private readonly path: string;
  private readonly responseField: string;
  private readonly fetchImplementation: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: HttpJsonMemoryEnrichmentProviderOptions) {
    this.name = options.name ?? 'http-json';
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.model = options.model;
    this.path = options.path ?? '/v1/enrich';
    this.responseField = options.responseField ?? 'response';
    this.fetchImplementation = options.fetch ?? fetch;
    this.timeoutMs = 30_000;
  }

  private async callStage(prompt: string, schema: object, timeoutMs = this.timeoutMs): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetchImplementation(`${this.baseUrl}${this.path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          prompt,
          schema,
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw new Error('HTTP JSON enrichment request failed.', { cause: error });
    }

    if (!response.ok) {
      throw new Error(`HTTP JSON enrichment request failed with HTTP ${response.status}.`);
    }

    const body = await response.json() as JsonRecord;
    const output = body[this.responseField];
    if (typeof output !== 'string' || output.trim().length === 0) {
      throw new Error(`HTTP JSON enrichment response field "${this.responseField}" did not contain JSON text.`);
    }

    try {
      return JSON.parse(output) as unknown;
    } catch (error) {
      throw new Error('HTTP JSON enrichment response was not valid JSON.', { cause: error });
    }
  }

  async enrich(content: string): Promise<unknown> {
    const classifierPromise = this.callStage(buildClassifierPrompt(content), classifierSchema)
      .then((raw) => parseClassifierOutput(raw));
    const extractorPromise = this.callStage(buildExtractorPrompt(content, null), extractorSchema)
      .then((raw) => parseExtractorOutput(raw));

    const [classifier, extractor] = await Promise.all([classifierPromise, extractorPromise]);

    let synthesizer = parseSynthesizerOutput(null);
    try {
      const synthesizerRaw = await this.callStage(
        buildSynthesizerPrompt(content, classifier, extractor),
        synthesizerSchema,
        12_000,
      );
      synthesizer = parseSynthesizerOutput(synthesizerRaw);
    } catch {
      synthesizer = parseSynthesizerOutput(null);
    }

    const combined = combineStageOutputs(classifier, extractor, synthesizer);

    return combined ?? {
      type: null,
      summary: null,
      people: [],
      topics: [],
      dates: [],
      actions: [],
      evidence: {
        type: null,
        summary: null,
        people: [],
        topics: [],
        dates: [],
        actions: [],
      },
    };
  }
}