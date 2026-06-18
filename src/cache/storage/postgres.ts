import { CacheStorage } from '../types';

// A ready-made Postgres CacheStorage. A jiti consumer (indexer, nbd) imports this, hands it a
// connection URI, and injects the result back into the token-transfers template via
// `_ctx.cacheStorage`. The `jiti_cache` table is created on first use.
//
// `pg` is an OPTIONAL peer dependency: it's lazy-required here so it never loads (or bundles)
// for consumers that don't use this adapter — e.g. oscar's pacemaker, which only does sync
// decode. Engines that use the cache (indexer, nbd) already depend on `pg`.

type PgPool = {
  query: (text: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
};

export type PostgresCacheStorageOptions = {
  connectionUri: string;
  table?: string;
  /** Provide your own pool/client (must have `.query(text, values)`) instead of a URI. */
  pool?: PgPool;
};

export function createPostgresCacheStorage(opts: PostgresCacheStorageOptions): CacheStorage {
  const table = (opts.table ?? 'jiti_cache').replace(/[^a-zA-Z0-9_]/g, '');

  let pool = opts.pool;
  function getPool(): PgPool {
    if (!pool) {
      // Obscure the require so jiti's bundler leaves `pg` external (loaded from the consumer).
      const requirePg = eval('require') as (m: string) => {
        Pool: new (cfg: { connectionString: string }) => PgPool;
      };
      const pg = requirePg('pg');
      pool = new pg.Pool({ connectionString: opts.connectionUri });
    }
    return pool;
  }

  let ready: Promise<void> | undefined;
  function ensureTable(): Promise<void> {
    if (!ready) {
      ready = (async () => {
        const p = getPool();
        await p.query(
          `CREATE TABLE IF NOT EXISTS ${table} (
             namespace   text        NOT NULL,
             key         text        NOT NULL,
             value       jsonb,
             found       boolean     NOT NULL DEFAULT true,
             resolved_at timestamptz NOT NULL DEFAULT now(),
             expires_at  timestamptz,
             PRIMARY KEY (namespace, key)
           );`
        );
        await p.query(
          `CREATE INDEX IF NOT EXISTS ${table}_expires_idx ON ${table} (expires_at) WHERE expires_at IS NOT NULL;`
        );
      })();
    }
    return ready;
  }

  return {
    async get(namespace, key) {
      await ensureTable();
      const { rows } = await getPool().query(
        `SELECT value, found, expires_at FROM ${table} WHERE namespace = $1 AND key = $2`,
        [namespace, key]
      );
      if (!rows.length) {
        return null;
      }
      const row = rows[0];
      return {
        value: row.value ?? null, // node-postgres parses jsonb → object
        found: row.found as boolean,
        expiresAt: row.expires_at ? new Date(row.expires_at as string).getTime() : null,
      };
    },
    async set(namespace, key, row) {
      await ensureTable();
      await getPool().query(
        `INSERT INTO ${table} (namespace, key, value, found, resolved_at, expires_at)
         VALUES ($1, $2, $3::jsonb, $4, now(), $5)
         ON CONFLICT (namespace, key) DO UPDATE
           SET value = EXCLUDED.value, found = EXCLUDED.found, resolved_at = now(), expires_at = EXCLUDED.expires_at`,
        [
          namespace,
          key,
          row.value === null || row.value === undefined ? null : JSON.stringify(row.value),
          row.found,
          row.expiresAt ? new Date(row.expiresAt).toISOString() : null,
        ]
      );
    },
  };
}
