# PersonalLink Web

Phase 1(Web版MVP)のアプリケーション。技術判断の根拠は [docs/05-tech-stack.md](../docs/05-tech-stack.md)。

## 開発

```bash
cd web
npm ci
npm run dev        # http://localhost:3000
```

| コマンド | 内容 |
|---|---|
| `npm run dev` | 開発サーバー |
| `npm run build` / `npm start` | 本番ビルド / 起動 |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Playwright E2E(初回は `npm run test:install`) |

E2E は `npm run build` 済みであることを前提にサーバーを起動する。

## 現在の中身(S0)

| パス | 内容 |
|---|---|
| `/` | 疎通確認ページ。S1でウェルカム画面(A-1)に差し替える |
| `/api/health` | 疎通確認 |

> **認証は未実装。** Passkey は見送りとなり、方式は未定([T-4](../docs/05-tech-stack.md))。
> S1(認証基盤)は方式の決定待ち。

## デプロイ(未実施 — オーナー作業)

Vercel を想定している。必要な設定:

| 項目 | 値 |
|---|---|
| Root Directory | `web` |
| Framework Preset | Next.js(自動検出) |
| Node.js Version | 22 |

### 環境変数

現時点で必須のものはない。S1 で `DATABASE_URL`(Neon)と認証方式に応じた変数を追加する。
