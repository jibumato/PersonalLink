/**
 * PersonalLink データベーススキーマ(S1前半)
 *
 * 設計方針([T-3](../../../docs/05-tech-stack.md)):
 * **不変条件はアプリのif文ではなくDBに刻む。** Drizzle を選んだのはそのため。
 *
 * S1前半のスコープは users / sessions / profiles / handle_reservations。
 * connections 以降は S2 で追加する。
 */
import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
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
