/**
 * PersonalLink データベーススキーマ
 *
 * 設計方針([T-3](../../../docs/05-tech-stack.md)):
 * **不変条件はアプリのif文ではなくDBに刻む。** Drizzle を選んだのはそのため。
 *
 * S1: users / sessions / profiles / handle_reservations
 * S2: qr_tokens / connections / connection_members
 */
import { sql } from "drizzle-orm";
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  primaryKey,
  check,
} from "drizzle-orm/pg-core";

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
