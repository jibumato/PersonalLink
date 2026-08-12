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
| `/api/health` | 疎通確認。**RP ID になるホスト**を返す |
| `/spike/webauthn` | **WebAuthn 実機検証ページ**([報告](../docs/06-webauthn-spike.md))。S1で削除 |

## Passkey を実機で検証する

WebAuthn は「安全なコンテキスト」を要求する。`localhost` は例外として許可されるため、
**PCのブラウザでは `http://localhost:3000` でそのまま検証できる**。

スマートフォンの実機で検証するには **HTTPS が必要**。ステージングへデプロイして開く。

> ⚠️ **Passkey は RP ID(ドメイン)に紐づく。**
> Vercel のプレビューURLはデプロイごとに変わるため、そこで作った Passkey は次のデプロイで使えない。
> 実機検証は**固定ドメインのステージング**で行うこと(詳細: [T-2](../docs/05-tech-stack.md))。

## デプロイ(未実施 — オーナー作業)

Vercel を想定している。必要な設定:

| 項目 | 値 |
|---|---|
| Root Directory | `web` |
| Framework Preset | Next.js(自動検出) |
| Node.js Version | 22 |

### 環境変数

| 変数 | 用途 | 必須 |
|---|---|---|
| `SPIKE_SECRET` | スパイクの Cookie 署名鍵。**本番相当の環境では必ず設定する**(未設定時は開発用の固定値にフォールバックする) | スパイク公開時 |

S1 で `DATABASE_URL`(Neon)と RP ID 固定用の変数を追加する。
