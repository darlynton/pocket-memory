import type { Config } from '../src/config.js';
import type { MemoryEnrichmentProvider, MemoryEnrichmentService } from './memory-enrichment.js';
import { createDisabledMemoryEnrichmentService, createMemoryEnrichmentService } from './memory-enrichment.js';
import { HttpJsonMemoryEnrichmentProvider } from './http-json-memory-enrichment-provider.js';
import { OllamaMemoryEnrichmentProvider } from './ollama-memory-enrichment-provider.js';

class UnavailableMemoryEnrichmentProvider implements MemoryEnrichmentProvider {
  readonly model: string | null;

  constructor(readonly name: string, model: string | undefined) {
    this.model = model ?? null;
  }

  async enrich(): Promise<unknown> {
    throw new Error(`Memory enrichment provider "${this.name}" is not implemented.`);
  }
}

export function createConfiguredMemoryEnrichmentService(config: Config): MemoryEnrichmentService {
  if (config.memoryEnrichmentProvider === 'disabled') {
    return createDisabledMemoryEnrichmentService();
  }

  if (config.memoryEnrichmentProvider === 'ollama') {
    if (!config.memoryEnrichmentModel || !config.memoryEnrichmentBaseUrl) {
      throw new Error('MEMORY_ENRICHMENT_MODEL and MEMORY_ENRICHMENT_BASE_URL are required for Ollama enrichment.');
    }

    return createMemoryEnrichmentService(new OllamaMemoryEnrichmentProvider({
      baseUrl: config.memoryEnrichmentBaseUrl,
      model: config.memoryEnrichmentModel,
    }));
  }

  if (config.memoryEnrichmentProvider === 'http-json') {
    if (!config.memoryEnrichmentModel || !config.memoryEnrichmentBaseUrl) {
      throw new Error('MEMORY_ENRICHMENT_MODEL and MEMORY_ENRICHMENT_BASE_URL are required for HTTP JSON enrichment.');
    }

    return createMemoryEnrichmentService(new HttpJsonMemoryEnrichmentProvider({
      name: 'http-json',
      baseUrl: config.memoryEnrichmentBaseUrl,
      model: config.memoryEnrichmentModel,
      path: config.memoryEnrichmentApiPath,
      responseField: config.memoryEnrichmentResponseField,
    }));
  }

  return createMemoryEnrichmentService(
    new UnavailableMemoryEnrichmentProvider(config.memoryEnrichmentProvider, config.memoryEnrichmentModel),
  );
}