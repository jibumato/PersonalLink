# PersonalLink

**LINEを教える前に、つながろう。**(長期: コミュニケーションを、端末から解放する。)

「LINEを教えるほどではない相手と、安全に継続して連絡する」ための中間領域を担う、次世代コミュニケーション基盤。連絡先を「個人情報」ではなく「権限」として扱い、期限付き・段階的な人間関係(Connection)を実現する。

## 現在地

**Phase 1(Web版MVP)— S0(技術選定・環境構築)実装完了。オーナーのドメイン確定と実機検証待ち。**

進行管理は **[ROADMAP.md(プロジェクト進行表)](ROADMAP.md)** で行う(マイルストーンM0〜M9・スプリントS0〜S6・KPIゲート・リスク登録簿)。

構想書の「次にやること」(コアループの画面設計)を完了し、MVP仕様書として確定済み。

```
QR表示 → QR読み取り → Connection成立 → チャット → 7日間 → 継続確認 → Connection Level上昇
```

## ドキュメント

| ファイル | 内容 |
|---|---|
| [ROADMAP.md](ROADMAP.md) | **プロジェクト進行表**(マイルストーン・スプリント・KPIゲート・リスク。進行管理の単一文書) |
| [docs/00-vision.md](docs/00-vision.md) | 構想書 v0.1(founding document・思想の原典) |
| [docs/01-screen-design.md](docs/01-screen-design.md) | **画面設計書 = MVP仕様書 v0.1**。全20画面の仕様、Connection状態遷移、設計判断(D-1〜D-11)、KPI計測設計 |
| [docs/02-data-model.md](docs/02-data-model.md) | データモデル v0.1。テーブル定義、不変条件、People OS憲法との対応表 |
| [docs/03-design-language.md](docs/03-design-language.md) | デザイン言語「GLASS-HUD」(白ベース)。データストリーム流体背景・半透明HUD・AR-ready透過原則 |
| [docs/05-tech-stack.md](docs/05-tech-stack.md) | 技術選定メモ(T-1〜T-11)。Next.js / Postgres+Drizzle / SimpleWebAuthn / DBセッションの根拠 |
| [docs/06-webauthn-spike.md](docs/06-webauthn-spike.md) | WebAuthn実機スパイク報告。**RP IDとドメインの依存**という重要な発見を含む |
| [web/](web/) | Phase 1 アプリケーション(Next.js 16)。[web/README.md](web/README.md) |
| [prototype/index.html](prototype/index.html) | クリック可能プロトタイプ。コアループ全体を実際に操作できる(ブラウザで直接開くだけで動作) |

## プロトタイプの試し方

`prototype/index.html` をブラウザで開く(ビルド不要・依存なし)。

1. オンボーディング(A-1〜A-4): ID取得 → Passkey → プロフィール
2. QR読み取り(デモボタン)→ 接続確認 → Connection成立
3. チャット: 📷ボタン(🔒)からレベル提案 → 相手が自動承諾 → Lv.2解放
4. メッセージの吹き出しをタップ → **送信取り消し**(24時間以内)/ 自分の画面から削除
5. 入力バーの🔔をタップ → 🌙**ミュート送信**(通知を鳴らさずに送る)
6. 右パネルで時間を進める → 期限24h前バナー → 継続確認 → 双方継続で ♾恒久化
7. 「継続しない」ルートも右パネルの「田中さんの選択」で再現可能
8. 右パネルの「**AR透過モード**」でUIパネルの不透明度を変更 → 背景(実世界の代役)がUI越しに見える度合いを検証

## 重要な設計判断(抜粋)

詳細は [docs/01-screen-design.md §1](docs/01-screen-design.md) を参照。

- **D-1**: 期限(いつまで)とレベル(どこまで共有)は独立した2軸。Level 5「恒久」は期限の撤廃として実装
- **D-3**: 「継続しない」は相手に通知しない。終了は常に「期限が終了しました」と表示(断る気まずさの排除)
- **D-7**: 電話番号・メールアドレスは一切収集しない(Passkey + リカバリーコード)
- **D-10**: メッセージ本文のスキャン・解析は行わない(KPIは代理指標で計測)

## 次のアクション

S0の実装分は完了。残りは**オーナーのアカウント作業と実機検証**([ROADMAP.md](ROADMAP.md) 参照)。

1. 👤 **本番ドメインの確定**(Passkeyは RP ID に紐づき、後から変更できない)
2. 👤 Vercel / Neon アカウント + ステージング固定ドメイン → 実機で Passkey 検証
3. 🤖 S1(認証基盤: Universal ID + Passkey + セッション管理)着手

長期ロードマップは構想書 §17、進行表は ROADMAP.md を参照。
