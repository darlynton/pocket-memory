import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';

import OpenAI from 'openai';

import type { Config } from '../src/config.js';

export interface WhisperTranscriptionResult {
  transcript: string;
  audioPath: string;
}

export interface WhisperTranscriptionService {
  readonly enabled: boolean;
  saveUploadedAudio(stream: NodeJS.ReadableStream, filename: string): Promise<string>;
  transcribeStoredAudio(audioPath: string): Promise<string>;
  transcribeAudio(stream: NodeJS.ReadableStream, filename: string): Promise<WhisperTranscriptionResult>;
}

export interface LocalWhisperTranscriptionServiceOptions {
  baseUrl: string;
  apiKey: string;
  model?: string;
  storageDir: string;
}

export class LocalWhisperTranscriptionService implements WhisperTranscriptionService {
  readonly enabled = true;

  private readonly client: OpenAI;
  private readonly model: string;
  private readonly storageDir: string;

  constructor(options: LocalWhisperTranscriptionServiceOptions) {
    this.client = new OpenAI({
      baseURL: options.baseUrl,
      apiKey: options.apiKey,
    });
    this.model = options.model ?? 'small.en';
    this.storageDir = path.resolve(options.storageDir);
  }

  private async createPersistentAudioPath(filename: string): Promise<{ tempPath: string; persistentPath: string; relativePath: string }> {
    await fs.promises.mkdir(this.storageDir, { recursive: true });

    const extension = path.extname(filename) || '.bin';
    const tempPath = path.join(os.tmpdir(), `pocket-memory-audio-${randomUUID()}${extension}`);
    const baseName = path.basename(filename, extension).replace(/[^a-z0-9-_]/gi, '_').slice(0, 80) || 'audio';
    const persistentName = `${Date.now()}-${randomUUID()}-${baseName}${extension}`;
    const persistentPath = path.join(this.storageDir, persistentName);

    return {
      tempPath,
      persistentPath,
      relativePath: path.relative(process.cwd(), persistentPath),
    };
  }

  async saveUploadedAudio(stream: NodeJS.ReadableStream, filename: string): Promise<string> {
    const { tempPath, persistentPath, relativePath } = await this.createPersistentAudioPath(filename);

    await pipeline(stream, fs.createWriteStream(tempPath));

    try {
      try {
        await fs.promises.rename(tempPath, persistentPath);
      } catch (error) {
        const maybeErrno = error as NodeJS.ErrnoException;
        if (maybeErrno.code !== 'EXDEV') throw error;
        await fs.promises.copyFile(tempPath, persistentPath);
        await fs.promises.unlink(tempPath);
      }

      return relativePath;
    } finally {
      await fs.promises.rm(tempPath, { force: true });
    }
  }

  async transcribeStoredAudio(audioPath: string): Promise<string> {
    const absolutePath = path.isAbsolute(audioPath) ? audioPath : path.resolve(process.cwd(), audioPath);

    const transcription = await this.client.audio.transcriptions.create({
      file: fs.createReadStream(absolutePath),
      model: this.model,
    });

    const text = typeof transcription.text === 'string' ? transcription.text.trim() : '';
    if (!text) {
      throw new Error('Whisper transcription returned empty text.');
    }

    return text;
  }

  async transcribeAudio(stream: NodeJS.ReadableStream, filename: string): Promise<WhisperTranscriptionResult> {
    const audioPath = await this.saveUploadedAudio(stream, filename);
    const transcript = await this.transcribeStoredAudio(audioPath);
    return { transcript, audioPath };
  }
}

class DisabledWhisperTranscriptionService implements WhisperTranscriptionService {
  readonly enabled = false;

  async saveUploadedAudio(): Promise<string> {
    throw new Error('Whisper transcription service is not configured.');
  }

  async transcribeStoredAudio(): Promise<string> {
    throw new Error('Whisper transcription service is not configured.');
  }

  async transcribeAudio(): Promise<WhisperTranscriptionResult> {
    throw new Error('Whisper transcription service is not configured.');
  }
}

export function createDisabledWhisperTranscriptionService(): WhisperTranscriptionService {
  return new DisabledWhisperTranscriptionService();
}

export function createConfiguredWhisperTranscriptionService(config: Config): WhisperTranscriptionService {
  if (!config.whisperBaseUrl || !config.whisperApiKey) {
    return createDisabledWhisperTranscriptionService();
  }

  return new LocalWhisperTranscriptionService({
    baseUrl: config.whisperBaseUrl,
    apiKey: config.whisperApiKey,
    model: config.whisperModel,
    storageDir: config.audioStorageDir,
  });
}
