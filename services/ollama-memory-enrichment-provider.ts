import type { MemoryEnrichmentProvider } from './memory-enrichment.js';
import {
  buildClassifierPrompt,
  buildExtractorPrompt,
  buildSynthesizerPrompt,
  classifierSchema,
  combineStageOutputs,
  extractorSchema,
  parseClassifierOutput,
  parseExtractorOutput,
  parseSynthesizerOutput,
  synthesizerSchema,
} from './enrichment-contract.js';

interface OllamaGenerateResponse {
  response?: unknown;
  thinking?: unknown;
}

export interface OllamaMemoryEnrichmentProviderOptions {
  baseUrl: string;
  model: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export class OllamaMemoryEnrichmentProvider implements MemoryEnrichmentProvider {
  readonly name = 'ollama';
  readonly model: string;
  private readonly baseUrl: string;
  private readonly fetchImplementation: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: OllamaMemoryEnrichmentProviderOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.model = options.model;
    this.fetchImplementation = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 45_000;
  }

  private async callStage(prompt: string, format: object, timeoutMs = this.timeoutMs): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetchImplementation(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          stream: false,
          think: false,
          format,
          prompt,
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw new Error('Ollama enrichment request failed.', { cause: error });
    }

    if (!response.ok) {
      throw new Error(`Ollama enrichment request failed with HTTP ${response.status}.`);
    }

    const body = await response.json() as OllamaGenerateResponse;
    const output = typeof body.response === 'string' && body.response.trim().length > 0
      ? body.response
      : body.thinking;
    if (typeof output !== 'string' || output.trim().length === 0) {
      throw new Error('Ollama enrichment response did not contain JSON text.');
    }

    try {
      return JSON.parse(output) as unknown;
    } catch (error) {
      throw new Error('Ollama enrichment response was not valid JSON.', { cause: error });
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

    return combineStageOutputs(classifier, extractor, synthesizer);
  }
}