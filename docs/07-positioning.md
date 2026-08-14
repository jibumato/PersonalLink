# People OS と Personal LINK の位置づけ

**Version 0.1 / 2026年8月**

構想書([00-vision.md](./00-vision.md))が描いた到達点「People OS」を**プラットフォーム**、
いま作っているものを**その上の最初の機能「Personal LINK」**として整理する。

この文書は名前の話ではなく、**境界線をどこに引くか**の話。
機能が増えるたびに「これは基盤か、機能か」を判断できるようにしておく。

---

## 1. 二層の構造

```
┌─────────────────────────────────────────────┐
│  People OS(プラットフォーム)                 │
│                                             │
│  ・Universal ID(@ID)= 端末から独立した自分   │
│  ・本人確認とセッション(どの端末でも自分)      │
│  ・People OS 憲法(全11条)= すべての機能が従う │
│  ・データ主権(エクスポート / 完全削除)         │
│  ・デザイン言語 GLASS-HUD(AR-ready)          │
│                                             │
│  ┌───────────────────┐  ┌──────────────┐   │
│  │ Personal LINK      │  │ (将来の機能)  │   │
│  │ = 人とのつながり     │  │               │   │
│  │                    │  │               │   │
│  │ ・Connection        │  │               │   │
│  │   (期限・レベル)     │  │               │   │
│  │ ・QR交換            │  │               │   │
│  │ ・チャット / グループ │  │               │   │
│  └───────────────────┘  └──────────────┘   │
└─────────────────────────────────────────────┘
```

**Personal LINK は People OS の最初の機能**であって、People OS そのものではない。
逆に、@ID や憲法は Personal LINK のものではなく、People OS のもの。

---

## 2. 位置づけの判断(P-1 〜 P-3)

### P-1: People OS が基盤、Personal LINK は最初の機能

構想書 §9 の進化の道筋 —「このサービスでつながる → 人間関係をここにまとめる →
どの端末からでも自分の環境を呼び出す → 端末を持たなくても通信できる → People OS」—
の最後の到達点が People OS。

**その到達点を先に名前として立て、いま作るものをその中の1機能と位置づける。**

なぜ先に立てるか: あとから「実はプラットフォームでした」と言い出すと、
すでに Personal LINK に結びついてしまった @ID やセッションを引き剥がす作業が発生する。
**境界を先に引いておけば、機能を足すときに悩まない。**

### P-2: 境界は「機能が増えても共有されるか」で引く

| 問い | 答え | 置き場所 |
|---|---|---|
| 2つ目の機能ができたとき、同じものを使うか? | 使う | **People OS** |
| Personal LINK を畳んでも残るか? | 残る | **People OS** |
| つながり方(期限・レベル)に固有か? | 固有 | **Personal LINK** |

@ID は Personal LINK を使わなくなっても自分のもの。だから People OS。
Connection Level は「人とどうつながるか」の話でしかない。だから Personal LINK。

### P-3: 機能をまたいで権限は自動で伝播しない

Personal LINK で Lv.4 を解放しても、**将来の別機能で自動的に何かが見えるようにはしない**。
機能ごとに、その機能の合意を取り直す。

これは新しい原則ではなく、[D-11](./01-screen-design.md)(グループでの同席は
1対1の信頼を動かさない)を**プラットフォームの高さまで引き上げたもの**。
「同じ場所にいた」「別のところで許可した」を「ここでも許可した」に読み替えない。

---

## 3. 実装はすでにこの形になっている

この整理は後付けの理屈ではない。コードはすでに二層に分かれている。

| 層 | 実装 | テーブル |
|---|---|---|
| **People OS** | [session.ts](../web/src/lib/session.ts) / [handle.ts](../web/src/lib/handle.ts) / [account.ts](../web/src/lib/account.ts) / [admin.ts](../web/src/lib/admin.ts) | `users` / `sessions` / `profiles` / `handle_reservations` |
| **Personal LINK** | [connection.ts](../web/src/lib/connection.ts) / [message.ts](../web/src/lib/message.ts) / [renewal.ts](../web/src/lib/renewal.ts) / [level.ts](../web/src/lib/level.ts) / [group.ts](../web/src/lib/group.ts) / [safety.ts](../web/src/lib/safety.ts) / [attachment.ts](../web/src/lib/attachment.ts) / [qr.ts](../web/src/lib/qr.ts) | `connections` / `messages` / `level_*` / `groups` / `blocks` / `reports` / `qr_tokens` |

**証拠**: 認証方式が未定([D-7](./01-screen-design.md))のまま S2〜S6 を作りきれた。
これは [T-4](./05-tech-stack.md)「セッションは認証方式に依存しない」を守った結果で、
つまり**基盤と機能の境界が最初から効いていた**ということ。
方式が決まったとき、差し替わるのは People OS 側だけで、Personal LINK は1行も変わらない。

### 憲法はどちらのものか

**People OS のもの。** 全11条はすべての機能に等しくかかる。
Personal LINK 固有の設計判断(D-1〜D-16)は、憲法を「つながり」の文脈に具体化したもの。

| 層 | 決定の種類 | 記号 |
|---|---|---|
| People OS | 憲法(11条)/ 位置づけ | 第n条 / P-n |
| Personal LINK | 設計判断 | D-n |
| 実装 | 技術選定 | T-n |

### デザイン言語はどちらのものか

**People OS のもの。** GLASS-HUD([03-design-language.md](./03-design-language.md))の
AR-ready 原則(UIを使っていても周りが見える)は、構想書 §9 の
「端末を持たなくても通信できる」に向けたもので、機能をまたいで共有する。

---

## 4. 表記

| 対象 | 表記 |
|---|---|
| プラットフォーム | **People OS**(半角スペースあり) |
| 機能 | **Personal LINK**(半角スペースあり、LINK は大文字) |
| リポジトリ / パッケージ名 | `PersonalLink` / `personallink-web` のまま |
| 環境変数の接頭辞 | `PL_` のまま |

技術的な識別子を変えない理由: URL・デプロイ設定・CI が壊れるわりに、得るものが無い。
`PL_` は People OS / Personal LINK のどちらとしても読めるので、そのまま使う。

---

## 5. これから機能を足すとき

1. **@ID とセッションは共有する。** 機能ごとに別のアカウントを作らない
2. **憲法11条に照らす。** とくに第二条(最小収集)と第六条(忘れられる権利)
3. **権限は持ち込まない**(P-3)。その機能での合意を、その機能で取る
4. **データ主権に組み込む。** エクスポート([account.ts](../web/src/lib/account.ts))と
   アカウント削除に、新しいデータを必ず含める。ここを忘れると
   「消したはずが残っていた」が起きる

4番目が一番忘れやすい。**新しいテーブルを作ったら、`users` への外部キーに
`ON DELETE CASCADE` を付ける**ところまでが1セット。

---

## 変更履歴

| 日付 | 内容 |
|---|---|
| 2026-08-13 | 作成。People OS をプラットフォーム、Personal LINK をその最初の機能として位置づけ(P-1〜P-3)。既存の実装がすでに二層に分かれていることを確認し、境界線を明文化した |
