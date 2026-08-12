/**
 * DB接続。
 *
 * `DATABASE_URL` があれば実 PostgreSQL(Neon 等)、無ければ **PGlite**(WASM の PostgreSQL)。
 *
 * PGlite を挟む理由: Neon アカウントが用意される前でも開発と CI が止まらないようにするため。
 * 本物の PostgreSQL 方言なので、部分UNIQUE や CHECK 制約もそのまま効く
 * = 「不変条件をDBに刻む」方針(T-3)をテストで検証できる。
 */
import { drizzle as drizzlePg } from "drizzle-orm/postgres-js";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

export type Database = PostgresJsDatabase<typeof schema>;

/**
 * 接続は **globalThis に載せて1プロセス1つ**にする。
 *
 * Next.js はルートごとに別バンドルを作るため、モジュールスコープの変数だと
 * ルートごとに別インスタンスができてしまう。インメモリ PGlite では
 * 「Server Action で書いた行が Route Handler から見えない」という形で表面化する。
 * また開発時の HMR による接続増殖も防げる。
 *
 * 解決済みの値ではなく **Promise を保持**する。そうしないと、初期化中に来た
 * 同時アクセスがそれぞれ別インスタンスを作ってしまう。
 */
const GLOBAL_KEY = Symbol.for("personallink.db");
type GlobalWithDb = typeof globalThis & { [GLOBAL_KEY]?: Promise<Database> };
const g = globalThis as GlobalWithDb;

async function connect(): Promise<Database> {
  const url = process.env.DATABASE_URL;
  if (url) {
    const postgres = (await import("postgres")).default;
    return drizzlePg(postgres(url, { max: 1 }), { schema });
  }

  const [{ PGlite }, { drizzle }] = await Promise.all([
    import("@electric-sql/pglite"),
    import("drizzle-orm/pglite"),
  ]);
  const client = new PGlite(process.env.PGLITE_PATH ?? "memory://personallink");
  const db = drizzle(client, { schema });
  await applyMigrations(db);
  // PGlite 版と postgres-js 版は Drizzle のクエリ API が同一のため、呼び出し側からは同じに見える
  return db as unknown as Database;
}

/**
 * マイグレーションを適用する。
 *
 * drizzle-kit が生成した SQL(`drizzle/`)をそのまま流す。手書きの DDL を持たないことで
 * 「マイグレーションファイルが唯一の正」を保つ。
 * 実 PostgreSQL では drizzle-kit / CI 側で流すため、ここは PGlite 用。
 */
async function applyMigrations(db: {
  execute: (q: ReturnType<typeof import("drizzle-orm").sql.raw>) => unknown;
}) {
  const { sql } = await import("drizzle-orm");
  const { readdir, readFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const dir = join(process.cwd(), "drizzle");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    const body = await readFile(join(dir, f), "utf8");
    // drizzle-kit は文を `--> statement-breakpoint` で区切る
    for (const stmt of body.split("--> statement-breakpoint")) {
      const trimmed = stmt.trim();
      if (trimmed) await db.execute(sql.raw(trimmed));
    }
  }
}

export function getDb(): Promise<Database> {
  g[GLOBAL_KEY] ??= connect();
  return g[GLOBAL_KEY];
}

/** テスト用: 次の getDb() で作り直させる。 */
export function resetDbForTests() {
  delete g[GLOBAL_KEY];
}

export { schema };
