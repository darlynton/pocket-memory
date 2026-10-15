import type { FastifyInstance } from 'fastify';

import type { Database } from '../src/types.js';

export function registerHealthRoute(app: FastifyInstance, database: Database): void {
  app.get('/health', async () => {
    await database.query('SELECT 1');

    return { status: 'ok', database: 'ok' };
  });
}