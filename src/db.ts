import { Pool } from 'pg';

import type { Database } from './types.js';

export function createDatabase(
  connectionString: string,
  poolMax = 5,
): Database & { close(): Promise<void> } {
  const pool = new Pool({
    connectionString,
    max: poolMax,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    allowExitOnIdle: true,
  });

  return {
    query: (text, values) => pool.query(text, values),
    close: () => pool.end(),
  };
}