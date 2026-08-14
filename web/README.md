# Personal LINK Web

> People OS の機能「Personal LINK」の Phase 1 アプリケーション([位置づけ](../docs/07-positioning.md))。

Phase 1(Web版MVP)のアプリケーション。技術判断の根拠は [docs/05-tech-stack.md](../docs/05-tech-stack.md)。

## 開発

```bash
cd web
npm ci
npm run dev        # http://localhost:3000
```

**DBのセットアップは不要。** `DATABASE_URL` が無ければ **PGlite**(WASM の PostgreSQL)で起動し、
マイグレーションを自動適用する。実 PostgreSQL(Neon 等)を使うときだけ `DATABASE_URL` を設定する。

| コマンド | 内容 |
|---|---|
| `npm run dev` | 開発サーバー |
| `npm run build` / `npm start` | 本番ビルド / 起動 |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run test:unit` | Vitest(DB制約・ID検証・仮ログインのガード) |
| `npm run test:e2e` | Playwright(初回は `npm run test:install`) |
| `npm run db:generate` | スキーマ変更からマイグレーションSQLを生成 |

E2E は `npm run build` 済みであることを前提にサーバーを起動する。

## 実装済み(S1前半)

| パス | 画面 | 仕様 |
|---|---|---|
| `/welcome` | ウェルカム | A-1 |
| `/signup/id` | Universal ID取得(IME対応) | A-2 |
| `/signup/profile` | プロフィール設定(L0) | A-4 |
| `/home` | ホーム(Connection一覧は S2) | B-1 |
| `/settings/devices` | 端末・セッション管理 / 全端末ログアウト | F-3 |
| `/dev/login` | **開発用の仮ログイン**(本番では404) | — |
| `/api/handle/check` | @ID の可用性チェック | A-2 |

**A-3(本人確認)は未実装。** 認証方式が未定のため([D-7](../docs/01-screen-design.md))。
現在は「@ID の確定 = アカウント作成」としている。

## 構成

```
src/
  db/schema.ts     スキーマ。不変条件を CHECK / 部分UNIQUE で刻む
  db/index.ts      接続。DATABASE_URL があれば Postgres、無ければ PGlite
  lib/session.ts   セッション(認証方式に依存しない)
  lib/handle.ts    @ID の可用性チェック(サーバー専用)
  lib/handle-format.ts  @ID の形式検証(クライアントとも共有)
  lib/dev-auth.ts  仮ログインの有効判定
  app/actions/     Server Actions
```

### 押さえておくべき2点

**1. DB接続は `globalThis` に載せる。**
Next.js はルートごとに別バンドルを作るため、モジュールスコープの変数だとルートごとに
別インスタンスができる。インメモリ PGlite では「Server Action で書いた行が
Route Handler から見えない」という形で表面化する。

**2. セッションは認証方式に依存しない。**
「どうやって本人と確かめたか」を `lib/session.ts` に持ち込まないこと。
確かめ終わったあとに `createSession()` を呼ぶだけにする。方式が決まっても
このファイルは変更不要([T-4](../docs/05-tech-stack.md))。

## 環境変数

| 変数 | 用途 | 必須 |
|---|---|---|
| `DATABASE_URL` | PostgreSQL 接続先。未設定なら PGlite | 任意 |
| `PGLITE_PATH` | PGlite の保存先。未設定ならインメモリ | 任意 |
| `PL_DEV_LOGIN` | `enabled` で仮ログインを有効化。**本番(`VERCEL_ENV=production`)では無視される** | 任意 |

## デプロイ(未実施 — オーナー作業)

| 項目 | 値 |
|---|---|
| Root Directory | `web` |
| Framework Preset | Next.js(自動検出) |
| Node.js Version | 22 |

本番では `DATABASE_URL` を設定し、`PL_DEV_LOGIN` は**設定しない**こと。
