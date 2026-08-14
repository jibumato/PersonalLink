/**
 * People OS / Personal LINK データベーススキーマ
 *
 * 設計方針([T-3](../../../docs/05-tech-stack.md)):
 * **不変条件はアプリのif文ではなくDBに刻む。** Drizzle を選んだのはそのため。
 *
 * ## 二層構造([位置づけ](../../../docs/07-positioning.md))
 *
 * - **People OS(基盤)**: users / sessions / profiles / handle_reservations
 *   — 機能が増えても共有する。@ID は Personal LINK のIDではない
 * - **Personal LINK(機能)**: それ以外すべて — 「人とどうつながるか」に固有
 *
 * S1: users / sessions / profiles / handle_reservations
 * S2: qr_tokens / connections / connection_members
 * S3: messages
 * S4: renewal_choices
 * S5: level_proposals / level_grants / attachments / blocks / reports
 * S6: groups / group_members
 */
import { sql } from "drizzle-orm";
import {
  pgTable,
  pgEnum,
  customType,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  primaryKey,
  check,
} from "drizzle-orm/pg-core";

/** 添付の実体(bytea)。理由は attachments のコメント参照。 */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

/** @ID(handle)の形式。API・DB・UIで同じ規則を使う。 */
export const HANDLE_PATTERN = /^[a-z0-9_]{3,20}$/;
/** handle を変更できる間隔(仕様書 A-2)。 */
export const HANDLE_CHANGE_INTERVAL_DAYS = 90;
/** 手放した handle を他人が再取得できるようになるまでの日数(なりすまし防止)。 */
export const HANDLE_RESERVATION_DAYS = 90;

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Universal ID。表示は `@handle`。 */
    handle: text("handle").notNull(),
    /** 直近の handle 変更時刻。次の変更可否の判定に使う。 */
    handleChangedAt: timestamp("handle_changed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** 削除処理の猶予管理用。原則は物理削除(憲法第六条)。 */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    // 生存ユーザーの中で handle は一意。削除済みは対象外にする。
    uniqueIndex("users_handle_unique")
      .on(t.handle)
      .where(sql`${t.deletedAt} is null`),
    // 形式チェックをDBにも置く。APIを経由しない経路(手作業のSQL等)でも壊れないようにする。
    check("users_handle_format", sql`${t.handle} ~ '^[a-z0-9_]{3,20}$'`),
  ],
);

/**
 * 手放した handle の予約。
 *
 * 仕様書 A-2「ID変更後、旧IDは90日間再取得不可(なりすまし防止)」を満たすには
 * 旧 handle を覚えておく必要がある。データモデル v0.1 に無かったため S1 で追加した。
 */
export const handleReservations = pgTable(
  "handle_reservations",
  {
    handle: text("handle").primaryKey(),
    /** 手放した本人。本人だけは即座に取り戻せるようにするため記録する。 */
    previousUserId: uuid("previous_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    releasedAt: timestamp("released_at", { withTimezone: true }).notNull().defaultNow(),
    /** この時刻を過ぎたら誰でも取得できる。 */
    reservedUntil: timestamp("reserved_until", { withTimezone: true }).notNull(),
  },
  (t) => [index("handle_reservations_until_idx").on(t.reservedUntil)],
);

/**
 * ログインセッション。
 *
 * **認証方式に依存しない**([T-4](../../../docs/05-tech-stack.md))。
 * 方式が何になっても「全端末ログアウト」はこのテーブルの一括 revoke で実現する。
 *
 * セキュリティ: Cookie に入れる不透明トークンは**そのまま保存せず、SHA-256 ハッシュだけ**を持つ。
 * DBが漏れてもセッションを乗っ取れないようにするため(データモデル v0.1 からの変更点)。
 */
export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** sha256(トークン) の hex。トークン本体は保存しない。 */
    tokenHash: text("token_hash").notNull().unique(),
    /** 「iPhone (Safari)」等。User-Agent から作る表示用ラベル。 */
    deviceLabel: text("device_label"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    /** 失効時刻。全端末ログアウトはここを一括で埋める。 */
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    index("sessions_user_idx").on(t.userId),
    index("sessions_expires_idx").on(t.expiresAt),
  ],
);

/**
 * プロフィール。
 *
 * **L0(公開)と L4(詳細)をカラムレベルで分離する**(憲法第五条 / データモデル §profiles)。
 * どちらを返すかはサーバー側で level_grants を見て決める。クライアントに判断させない。
 */
export const profiles = pgTable("profiles", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  /** L0: QRを読み取った相手に見える */
  displayName: text("display_name").notNull(),
  avatarKey: text("avatar_key"),
  bio: text("bio"),
  /** L4: 相互にレベル4を解放した相手にだけ見える(本名/SNS/誕生日など、すべて任意) */
  detail: jsonb("detail").$type<Record<string, string>>().notNull().default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type Profile = typeof profiles.$inferSelect;

// ============================================================
// S2: QR接続
// ============================================================

/** QRで成立するConnectionの期限。仕様書 B-2 の期限チップ。 */
export const QR_EXPIRY_DAYS = [1, 7, 30] as const;
export type QrExpiryDays = (typeof QR_EXPIRY_DAYS)[number];
/** QRトークンの有効時間(分)。短命にして、スクリーンショットの使い回しを防ぐ(D-2)。 */
export const QR_TOKEN_TTL_MINUTES = 5;
/** 期限到達後、閲覧と継続選択ができる猶予(D-4)。 */
export const GRACE_HOURS = 48;

/**
 * QRのワンタイムトークン。
 *
 * ペイロードは `token_id + 署名`。**使い切り**で、5分で失効する(D-2)。
 */
export const qrTokens = pgTable(
  "qr_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** このQRで成立するConnectionの期限(日)。表示側が決める。 */
    expiryDays: integer("expiry_days").notNull(),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    /** 使用済み管理。埋まっていたら二度目は弾く。 */
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    consumedBy: uuid("consumed_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [
    index("qr_tokens_user_idx").on(t.userId),
    check("qr_tokens_expiry_days", sql`${t.expiryDays} in (1, 7, 30)`),
  ],
);

export const connectionStatus = pgEnum("connection_status", [
  "active",
  "grace",
  "permanent",
  "expired",
]);

/**
 * Connection。このサービスの心臓部(仕様書 §3 の状態機械)。
 *
 * 期限とレベルは独立した2軸(D-1)。`expires_at = NULL` が「恒久」を意味する。
 */
export const connections = pgTable(
  "connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    status: connectionStatus("status").notNull().default("active"),
    /**
     * 2人のIDを昇順に連結したキー。
     * 「同一ペアの生きたConnectionは最大1つ」(不変条件7)を**DB制約で**守るために持つ。
     * connection_members と重複するが、制約を効かせるにはこの形が要る。
     */
    pairKey: text("pair_key").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    graceUntil: timestamp("grace_until", { withTimezone: true }),
    establishedAt: timestamp("established_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    /**
     * 恒久になった時刻(S6で追加)。
     *
     * `status` だけでは「いつ恒久になったか」が分からず、
     * KPI「恒久化後30日のメッセージ継続率」が測れないため持つ。
     */
    permanentAt: timestamp("permanent_at", { withTimezone: true }),
  },
  (t) => [
    // 不変条件7: 生きているConnectionは1ペアにつき1つ
    uniqueIndex("connections_alive_pair_unique")
      .on(t.pairKey)
      .where(sql`${t.status} <> 'expired'`),
    index("connections_expires_idx").on(t.expiresAt),
    // 不変条件3: expires_at が NULL であることと permanent であることは同値
    check(
      "connections_permanent_has_no_expiry",
      sql`(${t.status} = 'permanent') = (${t.expiresAt} is null)`,
    ),
  ],
);

/** Connection の参加者。1つのConnectionに必ず2行。 */
export const connectionMembers = pgTable(
  "connection_members",
  {
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => connections.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** 自分side の履歴削除。相手側には影響しない(憲法第六条)。 */
    hiddenAt: timestamp("hidden_at", { withTimezone: true }),
    /**
     * 自分が最後に開いた時刻。B-1 の未読バッジに使う。
     *
     * ⚠️ **相手には絶対に返さない。** これは既読情報そのもので、
     * 漏らすと D-8「既読表示はしない」が壊れる。
     */
    lastReadAt: timestamp("last_read_at", { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.connectionId, t.userId] }),
    index("connection_members_user_idx").on(t.userId),
  ],
);

/** 2人のIDから、順序に依存しないペアキーを作る。 */
export function pairKeyOf(a: string, b: string): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

export type QrToken = typeof qrTokens.$inferSelect;
export type Connection = typeof connections.$inferSelect;

// ============================================================
// S3: チャット
// ============================================================

/** 送信取り消しができる時間(D-12)。 */
export const RETRACT_WINDOW_HOURS = 24;

export const messageKind = pgEnum("message_kind", ["text", "image", "file", "system"]);

/**
 * メッセージ。
 *
 * **既読情報を持たない**(D-8)。相手が読んだかどうかを保存する場所そのものを作らない。
 *
 * 取り消し(D-12)はフラグではなく**本文の物理削除**。行はトゥームストーンとして残す。
 * 「消したつもりで残っていた」を防ぐため、`retracted_at` が入っていれば
 * `body` が NULL であることを **CHECK制約**で強制する。
 */
export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /**
     * 1対1のメッセージ。グループのときは NULL。
     *
     * グループ用に別テーブルを作らないのは、**取り消し(D-12)とミュート(D-13)の
     * 実装を1つに保つ**ため。2つに分けると、片方だけ直して片方が取り残される。
     */
    connectionId: uuid("connection_id").references(() => connections.id, {
      onDelete: "cascade",
    }),
    /** グループのメッセージ。1対1のときは NULL(S5→S6で追加)。 */
    groupId: uuid("group_id").references(() => groups.id, { onDelete: "cascade" }),
    /** システムメッセージは送信者を持たない。 */
    senderId: uuid("sender_id").references(() => users.id, { onDelete: "cascade" }),
    kind: messageKind("kind").notNull().default("text"),
    /** E2EE移行時は暗号文カラムに置換予定(D-9)。 */
    body: text("body"),
    /**
     * ミュート送信(D-13)。**送信者にしか返さない**。
     * 通知の抑止はサーバー側で行い、受信クライアントにこの値は配信しない。
     */
    muted: boolean("muted").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** 取り消し時刻。埋まっていれば本文・添付は削除済み。 */
    retractedAt: timestamp("retracted_at", { withTimezone: true }),
    /** 「自分の画面から削除」した人。相手の画面には残る。 */
    deletedBy: uuid("deleted_by").array().notNull().default([]),
  },
  (t) => [
    index("messages_connection_idx").on(t.connectionId, t.createdAt),
    index("messages_group_idx").on(t.groupId, t.createdAt),
    // メッセージは1対1かグループのどちらか。両方でも、どちらでもなくてもいけない
    check(
      "messages_belongs_to_one_thread",
      sql`(${t.connectionId} is null) <> (${t.groupId} is null)`,
    ),
    // 取り消し済みなら本文は残っていない(D-12: フラグ削除ではなく物理削除)
    check("messages_retracted_has_no_body", sql`${t.retractedAt} is null or ${t.body} is null`),
    // システムメッセージに送信者はいない / 通常メッセージには必ず送信者がいる
    check(
      "messages_system_has_no_sender",
      sql`(${t.kind} = 'system') = (${t.senderId} is null)`,
    ),
    // システムメッセージはミュートの概念を持たない
    check("messages_system_not_muted", sql`${t.kind} <> 'system' or ${t.muted} = false`),
  ],
);

export type Message = typeof messages.$inferSelect;

// ============================================================
// S4: 期限エンジン
// ============================================================

export const renewalChoice = pgEnum("renewal_choice", ["continue", "end"]);

/**
 * 継続確認の選択(D-2 / 仕様書 §3 の評価マトリクス)。
 *
 * ⚠️ **`end` は相手に一切露出させない**(不変条件4 / D-3)。
 * 通知しないだけでなく、**終了タイミングも選択によらず常に同じ**にする(D-16)。
 * 早く終わると「継続しないを選ばれた」と推測できてしまうため。
 *
 * 選択はあとから変えられる(気が変わることはある)。変更も相手には通知しない。
 */
export const renewalChoices = pgTable(
  "renewal_choices",
  {
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => connections.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    choice: renewalChoice("choice").notNull(),
    chosenAt: timestamp("chosen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.connectionId, t.userId] })],
);

export type RenewalChoice = typeof renewalChoices.$inferSelect;

// ============================================================
// S5: レベルと安全機能
// ============================================================

/**
 * 解放できるレベル(仕様書 E-1)。
 *
 * Lv.1(メッセージ)は成立時に暗黙で付くのでレコードを持たない。
 * **Lv.3(音声・通話)はMVPでは提案不可**(D-6)。値として存在させると
 * 「準備中」のはずのものが解放されうるので、CHECK制約で入れられなくしてある。
 * 実装するときにマイグレーションで開ける。
 */
export const GRANTABLE_LEVELS = [2, 4] as const;
export type GrantableLevel = (typeof GRANTABLE_LEVELS)[number];

/** 同じレベルを再提案できるようになるまでの間隔(仕様書 C-2。催促スパム防止)。 */
export const REPROPOSE_INTERVAL_HOURS = 72;

/**
 * レベルの提案(C-2)。
 *
 * ⚠️ **拒否を記録するカラムを持たない**(D-5)。
 * 「今はしない」は提案を消さず、受け取った側がカードを閉じるだけ。
 * `dismissed_at` は**閉じた本人にしか使わない**表示状態で、提案者には返さない。
 * 提案は保留のまま残り、あとから E-1 で承諾できる。
 */
export const levelProposals = pgTable(
  "level_proposals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => connections.id, { onDelete: "cascade" }),
    level: integer("level").notNull(),
    proposedBy: uuid("proposed_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    proposedAt: timestamp("proposed_at", { withTimezone: true }).notNull().defaultNow(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    /** 受け取った側がカードを閉じた時刻。**提案者には絶対に返さない**(D-5)。 */
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
  },
  (t) => [
    index("level_proposals_connection_idx").on(t.connectionId, t.level),
    check("level_proposals_level", sql`${t.level} in (2, 4)`),
  ],
);

/**
 * 解放済みレベル(E-1)。
 *
 * 解放は双方合意、**停止は一方的・即時**(D-5)。
 * 停止しても行は消さず `revoked_at` を刻む — 再提案の履歴として要るため。
 */
export const levelGrants = pgTable(
  "level_grants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => connections.id, { onDelete: "cascade" }),
    level: integer("level").notNull(),
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedBy: uuid("revoked_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [
    // 生きている解放は (接続, レベル) につき1つ。二重解放を作れない
    uniqueIndex("level_grants_alive_unique")
      .on(t.connectionId, t.level)
      .where(sql`${t.revokedAt} is null`),
    check("level_grants_level", sql`${t.level} in (2, 4)`),
    // 停止したなら誰が停めたかが必ず残る
    check(
      "level_grants_revoked_has_actor",
      sql`(${t.revokedAt} is null) = (${t.revokedBy} is null)`,
    ),
  ],
);

/** 添付できる最大サイズ。DBに直接入れるので控えめにする。 */
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

/**
 * 添付ファイルの実体([T-12](../../../docs/05-tech-stack.md))。
 *
 * **本文を外部ストレージではなく Postgres に置いている。** 理由は容量ではなく削除の確実性:
 *
 * - D-12 の取り消しは**物理削除**。同じトランザクションで消えないと「消したつもり」が残る
 * - 憲法第六条(アカウント削除)も同じ。`ON DELETE CASCADE` で必ず道連れにできる
 * - オブジェクトストレージだと孤児が出るし、削除の完了を保証しづらい
 *
 * 規模が問題になったら storage 層だけ差し替える(`lib/attachment.ts` に閉じている)。
 */
export const attachments = pgTable(
  "attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    messageId: uuid("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    mime: text("mime").notNull(),
    /** 表示用のファイル名。画像は出さないこともある */
    filename: text("filename").notNull(),
    bytes: integer("bytes").notNull(),
    data: bytea("data").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("attachments_message_idx").on(t.messageId),
    // 数値は sql.raw で埋め込む。テンプレート補間だとバインド変数になり、CHECK に使えない
    check(
      "attachments_size",
      sql`${t.bytes} > 0 and ${t.bytes} <= ${sql.raw(String(MAX_ATTACHMENT_BYTES))}`,
    ),
  ],
);

/**
 * ブロック(F-1)。**silent** — 相手には一切通知されず、相手のUIは何も変わらない。
 *
 * 解除しても**ブロック中に届かなかったメッセージは配信しない**。
 * そのためには「いつからいつまでブロックしていたか」が要るので、
 * 解除しても行を消さず `released_at` を刻んで期間として残す。
 */
export const blocks = pgTable(
  "blocks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    blockerId: uuid("blocker_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    blockedId: uuid("blocked_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    releasedAt: timestamp("released_at", { withTimezone: true }),
  },
  (t) => [
    index("blocks_blocker_idx").on(t.blockerId),
    // 生きているブロックは1組につき1つ
    uniqueIndex("blocks_alive_unique")
      .on(t.blockerId, t.blockedId)
      .where(sql`${t.releasedAt} is null`),
    check("blocks_not_self", sql`${t.blockerId} <> ${t.blockedId}`),
  ],
);

export const reportCategory = pgEnum("report_category", [
  "impersonation",
  "harassment",
  "inappropriate",
  "other",
]);

/**
 * 通報(F-1)。
 *
 * 本文の提供は**明示同意があるときだけ**(D-10 / 憲法第二条)。
 * 同意がなければ `evidence` は NULL のまま — 「同意していないのに本文が入っている」
 * 状態を作れないよう、CHECK制約で結びつけてある。
 *
 * 取り消し済みメッセージの本文は物理削除されているので、証跡にも**含みようがない**(D-12)。
 */
export const reports = pgTable(
  "reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reporterId: uuid("reporter_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    targetUserId: uuid("target_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    connectionId: uuid("connection_id").references(() => connections.id, {
      onDelete: "set null",
    }),
    category: reportCategory("category").notNull(),
    detail: text("detail"),
    /** 「直近20件を運営に提供する」への同意。既定OFF */
    withMessages: boolean("with_messages").notNull().default(false),
    /** 同意があるときだけ入る。無いときは NULL */
    evidence: jsonb("evidence").$type<{ at: string; mine: boolean; body: string | null }[]>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("reports_target_idx").on(t.targetUserId),
    // 同意していないのに証跡が付いている、を作れなくする
    check(
      "reports_evidence_needs_consent",
      sql`${t.withMessages} or ${t.evidence} is null`,
    ),
    check("reports_not_self", sql`${t.reporterId} <> ${t.targetUserId}`),
  ],
);

export type LevelGrant = typeof levelGrants.$inferSelect;
export type LevelProposal = typeof levelProposals.$inferSelect;
export type Attachment = typeof attachments.$inferSelect;
export type Block = typeof blocks.$inferSelect;
export type Report = typeof reports.$inferSelect;

// ============================================================
// S6: グループ
// ============================================================

/**
 * グループ(仕様書 G-1 / G-2)。
 *
 * **期限もレベルも持たない**(D-11)。1対1の Connection とは独立した合意の場で、
 * グループでの同席は1対1の信頼を1ミリも動かさない。
 * 逆に、1対1が期限終了してもグループ内の会話は続く。
 */
export const groups = pgTable("groups", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  ownerId: uuid("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (t) => [
  index("groups_owner_idx").on(t.ownerId),
  check("groups_name_not_empty", sql`length(btrim(${t.name})) > 0`),
]);

/**
 * グループの参加者。
 *
 * **勝手に入れない**(G-1)。招待された時点では `joined_at` が NULL で、
 * 本人が参加を選んで初めてメンバーになる。ここを省くと
 * 「知らないうちに知らない人と同席していた」が起きる。
 */
export const groupMembers = pgTable(
  "group_members",
  {
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    invitedBy: uuid("invited_by").references(() => users.id, { onDelete: "set null" }),
    invitedAt: timestamp("invited_at", { withTimezone: true }).notNull().defaultNow(),
    /** NULL = 招待されたが、まだ参加していない */
    joinedAt: timestamp("joined_at", { withTimezone: true }),
    /** 退出・削除された時刻。履歴の見え方を決めるので行は消さない */
    leftAt: timestamp("left_at", { withTimezone: true }),
    /** 自分の未読バッジ用。⚠️ 他のメンバーには返さない(D-8) */
    lastReadAt: timestamp("last_read_at", { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.groupId, t.userId] }),
    index("group_members_user_idx").on(t.userId),
  ],
);

export type Group = typeof groups.$inferSelect;
export type GroupMember = typeof groupMembers.$inferSelect;
