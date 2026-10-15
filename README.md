# Pocket Memory

A text-first personal memory capture API. Raw note content is the source of truth. Phase 3 can optionally store separate AI-generated enrichment metadata without modifying the captured memory.

## Technical decisions

- **Fastify** provides a small HTTP server with JSON Schema request validation.
- **pg** uses PostgreSQL directly with parameterized SQL. No ORM is used.
- SQL migrations are stored in `database/migrations` and tracked in the database's `schema_migrations` table.
- `GET /health` verifies the running API can execute a PostgreSQL query.
- AI enrichment is behind a provider-agnostic service boundary. Provider output must be structured JSON and is validated before metadata is stored.
- Enrichment is best-effort: a provider or validation failure is logged, but the raw note remains stored and the API still returns HTTP 201.

## Setup

1. Create a PostgreSQL database and role using your normal PostgreSQL administration process. This project does not modify PostgreSQL server configuration.
2. Copy `.env.example` to `.env` and set `DATABASE_URL` to that database.
3. Install dependencies with `npm install`.
4. Apply the schema with `npm run migrate`.
5. Start development mode with `npm run dev`.

For a production build, run `npm run build` followed by `npm start`.

## Environment variables

| Name | Required | Default | Purpose |
| --- | --- | --- | --- |
| `DATABASE_URL` | Yes | — | PostgreSQL connection string. |
| `HOST` | No | `0.0.0.0` | API listen address. |
| `PORT` | No | `3001` | API listen port. |
| `MEMORY_ENRICHMENT_PROVIDER` | No | `disabled` | Enrichment provider identifier: `disabled` or `ollama`. |
| `MEMORY_ENRICHMENT_MODEL` | Required for `ollama` | — | Ollama model name; stored with successful metadata. |
| `MEMORY_ENRICHMENT_BASE_URL` | Required for `ollama` | — | Ollama server base URL. |
| `WHISPER_BASE_URL` | Required for audio transcription | — | OpenAI-compatible base URL for local Whisper container (for example `http://127.0.0.1:9000/v1`). |
| `WHISPER_API_KEY` | Required for audio transcription | — | API key for the local Whisper container. |
| `WHISPER_MODEL` | No | `small.en` | Whisper transcription model passed to `audio.transcriptions.create`. |
| `AUDIO_STORAGE_DIR` | No | `./storage/audio` | Directory where uploaded audio files are stored permanently after successful transcription. |

## API

### `GET /health`

Runs `SELECT 1` against PostgreSQL. A successful response is:

```json
{ "status": "ok", "database": "ok" }
```

Database failures return HTTP 500.

### `POST /notes`

Creates a note. The body must contain only a non-blank `content` string with at most 10,000 characters.

```json
{ "content": "Schedule dentist appointment" }
```

The raw note is stored first. The API immediately returns it with `metadata: null`, then attempts optional enrichment in a tracked in-process background task. Retrieve the note later with `GET /notes/:id` to see any successfully stored metadata:

```json
{
  "note": {
    "id": "UUID",
    "content": "Schedule dentist appointment",
    "created_at": "2026-09-14T12:00:00.000Z",
    "updated_at": "2026-09-14T12:00:00.000Z"
  },
  "metadata": null
}
```

When a future provider returns valid enrichment, `metadata` contains optional `type` and `summary`, plus `people`, `topics`, `dates`, and `actions` arrays. The original `note.content` is never changed.

### `GET /notes`

Returns all notes as a JSON array, ordered newest first. Pagination is intentionally deferred from Phase 1.

### `GET /notes/:id`

Returns the original note and any stored enrichment metadata. It returns HTTP 404 when the note does not exist.

### `GET /memories`

Returns notes joined with optional metadata for retrieval interfaces (for example iPhone Shortcuts).

Supported query params:

- `type`
- `person`
- `topic`
- `hasAction=true|false`
- `hasMetadata=true|false`
- `limit` (default `20`, max `100`)
- `offset` (default `0`)

### `GET /memories/search`

Searches raw content and enrichment fields using `q`.

Supported query params:

- `q` (required)
- `type` (optional)
- `limit` (default `20`, max `100`)
- `offset` (default `0`)

### `POST /api/memories/audio`

Accepts a multipart upload (`file`) from clients such as iPhone Shortcuts.

Flow:

1. Save incoming audio to persistent storage (`AUDIO_STORAGE_DIR`).
2. Return `202 Accepted` immediately so clients (for example iPhone Shortcuts) can complete without waiting for transcription.
3. Process transcription in the background with local Whisper (`WHISPER_BASE_URL`, `WHISPER_API_KEY`, optional `WHISPER_MODEL`).
4. Store transcript as a note.
5. Run enrichment in the background and persist metadata when available.

Response shape:

```json
{
  "success": true,
  "job": {
    "id": "UUID",
    "status": "accepted",
    "audio_path": "storage/audio/uuid-memo.wav",
    "transcript": null,
    "note_id": null,
    "error": null,
    "created_at": "2026-10-12T22:30:00.000Z",
    "updated_at": "2026-10-12T22:30:00.000Z"
  }
}
```

### `GET /api/memories/audio/jobs/:id`

Returns background job status:

- `accepted` → `processing` → `completed` (or `failed`)
- on completion, `transcript` and `note_id` are populated
- on failure, `error` is populated

This endpoint requires `@fastify/multipart` and enforces a 10 MB upload limit.

## Data model

`notes` stores the original captured memory: `id`, `content`, `created_at`, and `updated_at`.

`memory_metadata` has a one-to-one relationship with `notes` through `note_id`. It stores nullable `type` and `summary`, JSON arrays for `people`, `topics`, `dates`, and `actions`, optional `provider` and `model` audit fields, and timestamps. This keeps AI-derived data separate and allows the metadata model to evolve without altering the raw capture table.

## AI enrichment

The default provider is disabled, so a real LLM is not required to run the API or test suite. The first available provider is Ollama. Configure `MEMORY_ENRICHMENT_PROVIDER=ollama`, `MEMORY_ENRICHMENT_MODEL`, and `MEMORY_ENRICHMENT_BASE_URL` to use it. It calls Ollama's `/api/generate` endpoint with a JSON Schema response format and requires exactly these fields:

```json
{
  "type": "task",
  "summary": "Book Luca's dentist appointment",
  "people": ["Luca"],
  "topics": ["dentist"],
  "dates": ["next Tuesday"],
  "actions": ["Book Luca's dentist appointment"]
}
```

`type` and `summary` may be `null`; all four arrays may be empty. Providers must not invent information or replace the original content.

Quality guardrails:

- `task`, `reminder`, and `idea` require a non-empty `summary`.
- Enrichment must include evidence fields grounded in source text.
- Each extracted array item (`people`, `topics`, `dates`, `actions`) must include positional evidence from the original note.
- The API computes `quality_score` and `validation_flags` for reusable retrieval/ranking.

If Ollama cannot be reached, times out, returns invalid JSON, or returns invalid metadata, the raw note remains stored and `POST /notes` returns HTTP 201 with `metadata: null`.

## Testing and checks

- `npm test` runs API tests using Fastify's in-process request injection, mocked database boundary, and mocked enrichment provider.
- `npm run typecheck` validates TypeScript without emitting files.