import OpenAI from 'openai';
import fs from 'fs';

const baseURL = process.env.WHISPER_BASE_URL ?? 'http://192.168.0.48:9000/v1';
const apiKey = process.env.WHISPER_API_KEY;
const audioPath = process.env.WHISPER_AUDIO_PATH ?? './scripts/test-audio.wav';

if (!apiKey) {
  throw new Error('WHISPER_API_KEY is required.');
}

const whisper = new OpenAI({
  baseURL,
  apiKey,
});

async function testTranscription() {
  try {
    const transcription = await whisper.audio.transcriptions.create({
      file: fs.createReadStream(audioPath),
      model: 'small.en',
    });
    console.log('Transcript:', transcription.text);
  } catch (err) {
    console.error('Transcription error:', err);
    process.exitCode = 1;
  }
}

testTranscription();
