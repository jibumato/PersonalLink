import { test, expect, type Page, type BrowserContext } from "@playwright/test";

/**
 * S4 期限エンジンの E2E(仕様書 §3 / D-1〜D-4 / D-16)。
 *
 * 7日を実時間で待つわけにはいかないので、開発専用の時計送り
 * (`/api/dev/clock`)で Connection の期限を過去へずらす。
 */
const origin = (page: Page) => new URL(page.url()).origin;
const handle = (p: string) => `${p}_${Math.random().toString(36).slice(2, 8)}`;

async function signup(page: Page, id: string, name: string) {
  await page.goto("/signup/id");
  await page.getByPlaceholder("satoshi").fill(id);
  await expect(page.getByText("✓ このIDは利用できます")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "次へ" }).click();
  await page.getByLabel("表示名(本名でなくてOK)").fill(name);
  await page.getByRole("button", { name: "はじめる" }).click();
  await expect(page).toHaveURL(/\/home/);
}

/** 2人つないで、両者のチャット画面を開いた状態にする */
async function connectedPair(page: Page, context: BrowserContext) {
  await signup(page, handle("rh"), "ホスト");
  await page.goto("/qr");
  await expect(page.locator(".qrsvg svg")).toBeVisible();
  const url = (await page.locator(".qrsvg").getAttribute("data-url"))!;

  const ctx = await context.browser()!.newContext({ baseURL: origin(page) });
  const guest = await ctx.newPage();
  await signup(guest, handle("rg"), "ゲスト");
  await guest.goto(url);
  await guest.getByRole("button", { name: "つながる" }).click();
  await expect(guest).toHaveURL(/established=/);
  await guest.getByRole("link", { name: "メッセージを送る" }).click();
  await expect(guest).toHaveURL(/\/c\//);

  await page.goto("/home");
  await page.getByText("ゲスト", { exact: true }).click();
  await expect(page).toHaveURL(/\/c\//);

  const id = new URL(guest.url()).pathname.split("/")[2];
  return { host: page, guest, ctx, id };
}

/** 時計を進める代わりに期限をずらす(開発専用エンドポイント) */
async function shift(page: Page, id: string, expiresInHours: number, graceInHours: number) {
  const res = await page.request.post("/api/dev/clock", {
    data: { connectionId: id, expiresInHours, graceInHours },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
}

/** Cron(猶予終了の後始末)を1回まわす */
async function runCron(page: Page) {
  const res = await page.request.get("/api/cron/connections");
  expect(res.ok()).toBeTruthy();
}

test("期限が近づくとバナーが出て、継続確認へ行ける(D-1)", async ({ page, context }) => {
  const { host, guest, ctx, id } = await connectedPair(page, context);

  // 期限まで残り1時間 / 猶予は49時間後
  await shift(guest, id, 1, 49);
  await guest.reload();

  await expect(guest.getByText("⏳ まもなく期限です")).toBeVisible();
  await expect(guest.locator(".badge").filter({ hasText: "残り1時間" })).toBeVisible();

  await guest.getByRole("link", { name: "継続確認へ" }).click();
  await expect(guest).toHaveURL(/\/renewal/);
  await expect(guest.getByRole("heading", { name: "この接続を継続しますか?" })).toBeVisible();
  // ふりかえりが出る(D-2)
  await expect(guest.getByText("つながった")).toBeVisible();

  // 相手側にも同じ導線がある
  await host.reload();
  await expect(host.getByRole("link", { name: "継続確認へ" })).toBeVisible();
  await ctx.close();
});

test("双方が「継続」を選ぶと恒久になる(D-2)", async ({ page, context }) => {
  const { host, guest, ctx, id } = await connectedPair(page, context);
  await shift(guest, id, 1, 49);

  // 先に選んだ側は、相手を待つだけ。恒久にはならない
  await guest.goto(`/c/${id}/renewal`);
  await guest.getByRole("button", { name: "♾ 継続する" }).click();
  await expect(guest.getByText("継続を選択済み")).toBeVisible();
  await expect(guest).toHaveURL(/\/renewal/);

  // 後から相手が選ぶと、その瞬間に恒久化して会話へ戻る
  await host.goto(`/c/${id}/renewal`);
  await host.getByRole("button", { name: "♾ 継続する" }).click();
  await expect(host).toHaveURL(new RegExp(`/c/${id}$`));
  await expect(host.getByText("恒久になりました")).toBeVisible();
  await expect(host.locator(".badge").filter({ hasText: "♾ 恒久" })).toBeVisible();

  // 祝いのシステムメッセージは両者に届く
  await guest.goto(`/c/${id}`);
  await expect(guest.getByText("恒久になりました")).toBeVisible();
  await expect(guest.getByText("まもなく期限です")).toHaveCount(0);

  // 恒久化後は期限の状態遷移の対象外
  await runCron(guest);
  await guest.reload();
  await expect(guest.locator(".badge").filter({ hasText: "♾ 恒久" })).toBeVisible();
  await ctx.close();
});

test("「継続しない」を選んでも相手には何も見えない(D-3 / D-16)", async ({ page, context }) => {
  const { host, guest, ctx, id } = await connectedPair(page, context);
  await shift(guest, id, 1, 49);

  // 相手が選ぶ**前**の見え方を控えておく
  await host.goto(`/c/${id}/renewal`);
  const before = await host.locator("main").innerText();

  await guest.goto(`/c/${id}/renewal`);
  await guest.getByRole("button", { name: "継続しない" }).click();
  await expect(guest.getByText("継続しないを選択済み")).toBeVisible();

  // 相手の画面は**1文字も変わらない**。ここが崩れると拒否が漏れる
  await host.reload();
  expect(await host.locator("main").innerText()).toBe(before);
  await expect(host.getByRole("button", { name: "♾ 継続する" })).toBeVisible();
  await expect(host.getByText(/選択済み/)).toHaveCount(0);

  // 会話も終了していない。D-16 のとおり、期限までは何も変わらない
  await host.goto(`/c/${id}`);
  await expect(host.getByPlaceholder("メッセージ")).toBeVisible();
  await expect(host.locator(".badge").filter({ hasText: "残り1時間" })).toBeVisible();

  // 選択は変えられる
  await guest.goto(`/c/${id}/renewal`);
  await guest.getByRole("button", { name: "♾ 継続する" }).click();
  await expect(guest.getByText("継続を選択済み")).toBeVisible();
  await ctx.close();
});

test("猶予中は送れないが読める。猶予も過ぎると終了する(D-4)", async ({ page, context }) => {
  const { host, guest, ctx, id } = await connectedPair(page, context);

  await guest.getByPlaceholder("メッセージ").fill("期限前に送っておく");
  await guest.getByRole("button", { name: "送信", exact: true }).click();
  await expect(guest.getByText("期限前に送っておく")).toBeVisible();

  // 期限は過ぎたが猶予中(Cronは動かさない → 遅延評価で正しく見えるはず: T-8)
  await shift(guest, id, -1, 47);
  await guest.reload();

  await expect(guest.getByText("⌛ 期限が終了しました。猶予のあいだなら継続できます")).toBeVisible();
  await expect(
    guest.getByText("期限が終了したため、メッセージは送れません(閲覧はできます)"),
  ).toBeVisible();
  await expect(guest.getByPlaceholder("メッセージ")).toHaveCount(0);
  // 閲覧はできる
  await expect(guest.getByText("期限前に送っておく")).toBeVisible();
  // 猶予中でも継続は選べる
  await expect(guest.getByRole("link", { name: "継続確認へ" })).toBeVisible();

  // 猶予も過ぎた → 終了
  await shift(guest, id, -49, -1);
  await runCron(guest);
  await guest.reload();
  await expect(guest.getByText("この接続は終了しています")).toBeVisible();
  await expect(guest.getByText("この接続は期限を迎えました")).toBeVisible();
  // 終了後は継続確認を受け付けない(ボタン自体を出さない)
  await guest.goto(`/c/${id}/renewal`);
  await expect(guest.getByText("この接続はすでに終了しています")).toBeVisible();
  await expect(guest.getByRole("button", { name: "♾ 継続する" })).toHaveCount(0);

  // 相手の画面でも同じ文言で終わっている(選択によらず同じ: D-16)
  await host.goto(`/c/${id}`);
  await expect(host.getByText("この接続は期限を迎えました")).toBeVisible();
  await ctx.close();
});

test("終了したConnectionは「終了済み」タブに移る(B-1)", async ({ page, context }) => {
  const { host, guest, ctx, id } = await connectedPair(page, context);

  await guest.goto("/home");
  await expect(guest.getByRole("link", { name: /終了済み/ })).toHaveCount(0);

  await shift(guest, id, -49, -1);
  await runCron(guest);

  // 「つながり中」からは消える
  await guest.goto("/home");
  await expect(guest.getByText("ホスト", { exact: true })).toHaveCount(0);
  await expect(guest.getByText("つながり中のConnectionはありません")).toBeVisible();

  // 「終了済み」タブには居て、開ける
  await guest.getByRole("link", { name: "終了済み(1)" }).click();
  await expect(guest.getByText("ホスト", { exact: true })).toBeVisible();
  await guest.getByText("ホスト", { exact: true }).click();
  await expect(guest.getByText("この接続は終了しています")).toBeVisible();

  await host.goto("/home");
  await expect(host.getByRole("link", { name: "終了済み(1)" })).toBeVisible();
  await ctx.close();
});

test("終了後に履歴を削除すると自分側だけ消える(D-3 / 憲法第六条)", async ({ page, context }) => {
  const { host, guest, ctx, id } = await connectedPair(page, context);

  await guest.getByPlaceholder("メッセージ").fill("この会話は片方だけ消す");
  await guest.getByRole("button", { name: "送信", exact: true }).click();
  await expect(guest.getByText("この会話は片方だけ消す")).toBeVisible();
  await expect(host.getByText("この会話は片方だけ消す")).toBeVisible({ timeout: 10_000 });

  await shift(guest, id, -49, -1);
  await runCron(guest);
  await guest.goto(`/c/${id}`);

  await guest.getByRole("button", { name: "履歴を削除" }).click();
  await expect(guest.getByRole("dialog", { name: "履歴の削除" })).toBeVisible();
  await guest.getByRole("button", { name: "履歴を削除する" }).click();

  // 一覧からも会話からも消える
  await expect(guest).toHaveURL(/\/home/);
  await expect(guest.getByRole("link", { name: /終了済み/ })).toHaveCount(0);
  expect((await guest.goto(`/c/${id}`))?.status()).toBe(404);

  // 相手側は無傷
  await host.goto(`/c/${id}`);
  await expect(host.getByText("この会話は片方だけ消す")).toBeVisible();
  await ctx.close();
});
