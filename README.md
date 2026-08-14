# People OS

**コミュニケーションを、端末から解放する。**

People OS は、人とのつながりを「企業のもの」ではなく「人のもの」として扱うプラットフォーム。
@ID(Universal ID)・本人確認・データ主権・[People OS 憲法(全11条)](docs/00-vision.md#11-people-os-憲法)を土台として持ち、
その上に機能が載る。

## Personal LINK(最初の機能)

**LINEを教える前に、つながろう。**

People OS 上の最初の機能。「LINEを教えるほどではない相手と、安全に継続して連絡する」
中間領域を担う。連絡先を「個人情報」ではなく **権限** として扱い、
期限付き・段階的な人間関係(Connection)を実現する。

```
QR表示 → QR読み取り → Connection成立 → チャット → 7日間 → 継続確認 → 継続 or 終了
```

> 二層の関係と境界線の引き方は **[docs/07-positioning.md](docs/07-positioning.md)** にまとめてある。
> @ID や憲法は People OS のもの、Connection やレベルは Personal LINK のもの。

## 現在地

**Phase 1(Web版MVP)— S6 完了。MVP必須機能がすべて動く。次は M8(クローズドβ)。**

進行管理は **[ROADMAP.md(プロジェクト進行表)](ROADMAP.md)** で行う
(マイルストーンM0〜M9・スプリントS0〜S6・KPIゲート・リスク登録簿)。

| スプリント | 内容 | 状態 |
|---|---|---|
| S0 | 技術選定・アプリ基盤・CI | ✅ |
| S1前半 | @ID / DBセッション / 端末管理 / プロフィール | ✅ |
| S1後半 | 本人確認 | ⏸ **認証方式の決定待ち**(D-7)|
| S2 | QR接続(キラー体験) | ✅ |
| S3 | チャット(取り消し・ミュート) | ✅ |
| S4 | 期限エンジン(継続確認・恒久化・終了) | ✅ |
| S5 | レベル・安全機能・データ主権 | ✅ |
| S6 | グループ・KPI計測 | ✅ |

テスト: unit 202件 / E2E 50件(CI green)

## ドキュメント

| ファイル | 内容 |
|---|---|
| [ROADMAP.md](ROADMAP.md) | **プロジェクト進行表**(マイルストーン・スプリント・KPIゲート・リスク。進行管理の単一文書) |
| [docs/00-vision.md](docs/00-vision.md) | 構想書 v0.1(founding document・思想の原典。**編集しない**) |
| [docs/07-positioning.md](docs/07-positioning.md) | **People OS と Personal LINK の位置づけ**(P-1〜P-3)。境界線の引き方 |
| [docs/01-screen-design.md](docs/01-screen-design.md) | **画面設計書 = MVP仕様書 v0.1.5**。全20画面、Connection状態遷移、設計判断 D-1〜D-16、KPI計測設計 |
| [docs/02-data-model.md](docs/02-data-model.md) | データモデル v0.5。テーブル定義、不変条件1〜10、憲法との対応表 |
| [docs/03-design-language.md](docs/03-design-language.md) | デザイン言語「GLASS-HUD」(白ベース)。**People OS 共通**。データストリーム流体背景・AR-ready透過原則 |
| [docs/05-tech-stack.md](docs/05-tech-stack.md) | 技術選定メモ(T-1〜T-12)。Next.js / Postgres+Drizzle / DBセッションの根拠 |
| [docs/06-webauthn-spike.md](docs/06-webauthn-spike.md) | WebAuthnスパイク報告(**保留・参考資料**。Passkeyを再検討する場合に読む) |
| [docs/analytics-events.md](docs/analytics-events.md) | 計測設計。KPI5指標の定義と「計測のためにデータを溜めない」方針 |
| [web/](web/) | **Phase 1 アプリケーション**(Next.js 16 + Postgres/Drizzle)。[web/README.md](web/README.md) |
| [prototype/index.html](prototype/index.html) | クリック可能プロトタイプ(ブラウザで直接開くだけで動作。実装前の検証用) |

## 動かし方

```bash
cd web
npm install
npm run dev          # http://localhost:3000
```

`DATABASE_URL` を設定しなければ **PGlite(WASM版PostgreSQL)** で動くので、
外部DBの用意は要らない。ローカルもCIもこれで完結する。

```bash
npm run test:unit    # Vitest(実DB相当のPGliteに対して実行)
npx playwright test  # E2E(本番ビルドを起動して2台間を検証)
```

## 重要な設計判断(抜粋)

詳細は [docs/01-screen-design.md §1](docs/01-screen-design.md) を参照。

- **D-1**: 期限(いつまで)とレベル(どこまで共有)は独立した2軸。「恒久」は期限の撤廃として実装
- **D-3 / D-16**: 「継続しない」は相手に通知しない。**かつ終了タイミングも変えない** —
  早く終わると猶予の有無から拒否が推測できてしまうため
- **D-5**: 解放は双方合意、停止は一方的・即時。拒否は記録するカラムを作らない
- **D-7**: 認証方式は**未定**(Passkeyは見送り)。方式次第で「電話番号もメールも不要」を維持できるかが決まる
- **D-10**: メッセージ本文のスキャン・解析は行わない。計測用のテーブルも作らない
- **D-12**: 送信取り消しは物理削除。CHECK制約で「消し忘れ」を書き込めなくしてある
- **D-14**: QRは `https://<host>/i#<token>`。標準カメラで読めて、トークンはサーバーに送信されない
- **P-3**: 機能をまたいで権限は自動伝播しない([docs/07-positioning.md](docs/07-positioning.md))

## 次のアクション

1. 👤 **デプロイ**(Vercel / Neon)。環境変数は `CRON_SECRET` / `PL_ADMIN_HANDLES` を設定し、
   `PL_DEV_LOGIN` は**本番で設定しない**
2. 👤 **認証方式の決定**([D-7](docs/01-screen-design.md))— S1後半のブロッカー
3. 👤 **βイベントの選定**(M8)。20〜30名規模の趣味系

長期ロードマップは構想書 §17、進行表は [ROADMAP.md](ROADMAP.md) を参照。
