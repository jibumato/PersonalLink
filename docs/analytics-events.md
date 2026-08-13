# PersonalLink 計測設計

**Version 0.1 / 2026年8月**(S6で作成)

[画面設計書 §6](./01-screen-design.md) の KPI 計測設計を、実装に合わせて確定した文書。
実装は [web/src/lib/kpi.ts](../web/src/lib/kpi.ts) と [web/src/lib/analytics.ts](../web/src/lib/analytics.ts)。

---

## 1. 方針: 計測のために新しくデータを溜めない

**KPI用のイベントテーブルを作っていない。** 5指標はすべて運用テーブル
(`connections` / `messages` / `qr_tokens` / `connection_members`)からの集計で出せるため。

これは実装の都合ではなく、思想の一部として選んだ:

| 理由 | 中身 |
|---|---|
| 溜めない情報は漏れない | 憲法第二条。行動ログという資産を作らなければ、流出も転用も起きない |
| **本文が混ざりようがない** | 集計クエリは `body` を一度も SELECT しない。D-10 を「気をつける」で守らない |
| 使いたくなる誘惑を断つ | 「誰が何をしたか」の履歴があれば、いつか必ず使いたくなる。最初から持たない |

**トレードオフ**: ファネル分析(どの画面で離脱したか)はできない。
それが要るとわかった時点で、必要な粒度だけを足す — 先回りして溜めない。

---

## 2. 集計に使うテーブル

| テーブル | 使う列 | 使わない列 |
|---|---|---|
| `connections` | status / established_at / permanent_at | — |
| `messages` | connection_id / sender_id / kind / created_at | **body(読まない)** / muted |
| `qr_tokens` | user_id / issued_at / consumed_by / consumed_at | — |
| `connection_members` | user_id / connection_id | **last_read_at(既読は集計もしない)** |
| `groups` | deleted_at | — |

`renewal_choices.choice` は**集計にも使わない**。
「継続しない」を選んだ人数を出すこと自体はできるが、D-3 の秘匿を計測側から緩める入口になるため、
期限後継続率は**恒久化した数**(ポジティブ側)だけで計算する。

---

## 3. KPI 5指標の定義

### 3.1 QR接続率

```
成立した Connection 数 ÷ QR表示セッション数
```

**近似**: QRは5分ごとに自動更新されるため、トークンを数えると表示回数を大きく上回る。
同じユーザーの連続発行を **10分の間隔**で束ね、1回の「表示」とみなす
(`QR_SESSION_GAP_MINUTES`)。

⚠️ **100%を超えうる。** 1回の表示で複数人とつながれるため。
イベント会場ではむしろ良い兆候なので、上限を設けずそのまま出す。

### 3.2 初回メッセージ率

```
成立後24時間以内に「双方向」のやり取りがあった Connection ÷ 全 Connection
```

双方向 = システムメッセージを除いた `sender_id` が**2人ぶん**存在すること。
片方が送っただけでは分子に入らない。

### 3.3 期限後継続率

```
恒久になった Connection ÷ 継続確認に至った Connection
```

分母 = `status ∈ {grace, expired}` **または** 継続確認で誰かが選んだもの。
期限に到達していない Connection は分母に入れない。

⚠️ **高いほど良い指標ではない。** 100%なら期限機能が無意味、0%なら関係が育っていない。
「残したい関係だけ残る」中間帯が健全、という仮説を M8 で検証する。

### 3.4 再利用率

```
初回接続から7日以内に、もう一度QRを使ったユーザー ÷ 接続したことのあるユーザー
```

「もう一度使った」= QRを表示した(`qr_tokens.issued_at`)
または読み取った(`qr_tokens.consumed_by`)。

### 3.5 LINE移行率(代理指標)

```
恒久化から30日たった Connection のうち、直近30日にやり取りがあった割合
```

構想書の「①恒久化後30日メッセージ継続率」に対応する。会話がここに残っているかを見る。
**②終了時アンケートは未実装**(M8 のクローズドβで実施する)。

本文のスキャンは行わない(D-10)。見るのは「メッセージ行が存在するか」だけ。

---

## 4. 運用ログ(`track()`)

[analytics.ts](../web/src/lib/analytics.ts) の `track()` は、集計ではなく**運用の観察**用。
現時点では構造化ログに出すだけで、どこにも保存していない。

型で守っていること:

- **載せてよい値は `number | boolean | null` と、宣言済みの文字列リテラルだけ**。
  自由な文字列を入れる口が無いので、本文が紛れ込めない
- **`userId` も `connectionId` も型に存在しない**。
  「継続しない」を選んだのが誰かを突き合わせられると D-3 が計測経路から破れる

イベント一覧:

| イベント | メタデータ | 対応画面 |
|---|---|---|
| `qr_displayed` | expiryDays | B-2 |
| `qr_expiry_changed` | expiryDays | B-2 |
| `qr_scanned` | result | B-3 |
| `scan_requires_signup` | viaQr | B-3 |
| `connect_confirm_viewed` | expiryDays | B-4 |
| `connection_established` | expiryDays / viaSignup | B-5 |
| `renewal_viewed` | inGrace / daysSinceConnect | D-2 |
| `renewal_choice` | choice | D-2 |
| `connection_permanent` | daysSinceConnect | D-2 |
| `permanent_proposed` | — | E-1 |
| `connection_expired` | daysSinceConnect | D-3 |
| `expired_history_deleted` | daysSinceConnect | D-3 |
| `connection_info_viewed` | — | E-1 |
| `level_proposed` | level | C-2 |
| `level_accepted` | level / hoursToAccept | C-2 |
| `level_revoked` | level | E-1 |
| `attachment_sent` | kind / kb | C-1 |
| `block_created` / `block_released` | — | F-1 / F-2 |
| `report_submitted` | category / withMessages | F-1 |
| `data_exported` | — | F-2 |
| `account_deleted` | daysSinceSignup | F-2 |
| `group_created` | members | G-1 |
| `group_joined` / `group_left` / `group_deleted` | — | G-1 / G-2 |

---

## 5. ダッシュボード

`/dashboard`(実装: [web/src/app/dashboard/page.tsx](../web/src/app/dashboard/page.tsx))。

**閲覧権限**:

1. `PL_ADMIN_HANDLES`(カンマ区切りの @ID)が設定されていれば、**そこに載っている人だけ**(環境を問わず)
2. 設定が無いときは、**本番では誰も見られない**。ローカル・プレビューでは開く

未設定の本番では誰も見られない。設定漏れが全開放にならない向きにしてある。

率だけを見て誤解しないよう、**分子と分母の実数**も併記する。
母数が0のときは 0% ではなく「—」と出す — 「測れていない」と「0だった」は違う。

---

## 変更履歴

| 日付 | 内容 |
|---|---|
| 2026-08-13 | S6で作成。計測用テーブルを作らず運用テーブルから集計する方針を確定。`connections.permanent_at` を追加(LINE移行率の代理指標に必要だったため)|
