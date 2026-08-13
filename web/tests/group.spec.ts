import { test, expect, type Page, type BrowserContext } from "@playwright/test";

/**
 * S6 グループと計測の E2E(仕様書 G-1 / G-2 / §6)。
 *
 * 検証の中心は D-11:**グループは1対1とは独立した合意の場**であること。
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

async function connectedPair(page: Page, context: BrowserContext) {
  await signup(page, handle("gh"), "ホスト");
  await page.goto("/qr");
  await expect(page.locator(".qrsvg svg")).toBeVisible();
  const url = (await page.locator(".qrsvg").getAttribute("data-url"))!;

  const ctx = await context.browser()!.newContext({ baseURL: origin(page) });
  const guest = await ctx.newPage();
  await signup(guest, handle("gg"), "ゲスト");
  await guest.goto(url);
  await guest.getByRole("button", { name: "つながる" }).click();
  await expect(guest).toHaveURL(/established=/);
  await guest.getByRole("link", { name: "メッセージを送る" }).click();
  await expect(guest).toHaveURL(/\/c\//);

  const id = new URL(guest.url()).pathname.split("/")[2];
  return { host: page, guest, ctx, connectionId: id };
}

/** ホストがゲストを招いてグループを作る */
async function makeGroup(host: Page, name: string) {
  await host.goto("/groups/new");
  await host.getByLabel("グループ名").fill(name);
  await host.getByRole("checkbox").first().check();
  await host.getByRole("button", { name: "作成する" }).click();
  await expect(host).toHaveURL(/\/g\//);
  return new URL(host.url()).pathname.split("/")[2];
}

test("つながっている相手だけを招いてグループを作れる(G-1)", async ({ page, context }) => {
  const { host, guest, ctx } = await connectedPair(page, context);

  const groupId = await makeGroup(host, "展示めぐりの会");
  await expect(host.getByText("「展示めぐりの会」が作成されました")).toBeVisible();

  // 招待された側はホームで「招待」として見える
  await guest.goto("/home");
  await expect(guest.getByText("👥 展示めぐりの会")).toBeVisible();
  await expect(guest.getByText("招待", { exact: true })).toBeVisible();

  void groupId;
  await ctx.close();
});

test("参加するまで会話は見えない(G-1)", async ({ page, context }) => {
  const { host, guest, ctx } = await connectedPair(page, context);
  const groupId = await makeGroup(host, "秘密の会");

  await host.getByPlaceholder("メッセージ").fill("参加前の会話");
  await host.getByRole("button", { name: "送信", exact: true }).click();
  await expect(host.getByText("参加前の会話")).toBeVisible();

  // 招待中は参加確認だけが出て、会話は読めない
  await guest.goto(`/g/${groupId}`);
  await expect(guest.getByRole("button", { name: "参加する" })).toBeVisible();
  await expect(guest.getByText("参加前の会話")).toHaveCount(0);
  await expect(guest.getByPlaceholder("メッセージ")).toHaveCount(0);

  // 参加すると、それまでの会話が読める
  await guest.getByRole("button", { name: "参加する" }).click();
  await expect(guest.getByText("参加前の会話")).toBeVisible();
  await expect(guest.getByPlaceholder("メッセージ")).toBeVisible();

  await host.reload();
  await expect(host.getByText("ゲスト が参加しました")).toBeVisible();
  await ctx.close();
});

test("参加を断っても他のメンバーには知らされない(G-1)", async ({ page, context }) => {
  const { host, guest, ctx } = await connectedPair(page, context);
  const groupId = await makeGroup(host, "断られる会");

  await host.goto(`/g/${groupId}`);
  const before = await host.locator(".chatlist").innerText();

  await guest.goto(`/g/${groupId}`);
  await guest.getByRole("button", { name: "参加しない" }).click();
  await expect(guest).toHaveURL(/\/home/);
  await expect(guest.getByText("👥 断られる会")).toHaveCount(0);

  // 作成者の画面は1文字も変わらない
  await host.reload();
  expect(await host.locator(".chatlist").innerText()).toBe(before);
  await ctx.close();
});

test("グループでは誰の発言かが分かる(G-2)", async ({ page, context }) => {
  const { host, guest, ctx } = await connectedPair(page, context);
  const groupId = await makeGroup(host, "会話の会");
  await guest.goto(`/g/${groupId}`);
  await guest.getByRole("button", { name: "参加する" }).click();

  await guest.getByPlaceholder("メッセージ").fill("ゲストからの発言");
  await guest.getByRole("button", { name: "送信", exact: true }).click();
  await expect(guest.getByText("ゲストからの発言")).toBeVisible();

  // 受け取った側には送信者名が付く
  await host.goto(`/g/${groupId}`);
  await expect(host.getByText("ゲストからの発言")).toBeVisible({ timeout: 10_000 });
  const bubble = host.locator(".msg", { hasText: "ゲストからの発言" });
  await expect(bubble.locator(".who")).toHaveText("ゲスト");

  // 自分の発言には名前が付かない
  await expect(guest.locator(".msg.me", { hasText: "ゲストからの発言" }).locator(".who")).toHaveCount(0);
  await ctx.close();
});

test("1対1が終了してもグループでは会話が続く(D-11)", async ({ page, context }) => {
  const { host, guest, ctx, connectionId } = await connectedPair(page, context);
  const groupId = await makeGroup(host, "続く会");
  await guest.goto(`/g/${groupId}`);
  await guest.getByRole("button", { name: "参加する" }).click();

  // 1対1を終了させる
  const res = await guest.request.post("/api/dev/clock", {
    data: { connectionId, expiresInHours: -49, graceInHours: -1 },
  });
  expect(res.ok()).toBeTruthy();
  await guest.request.get("/api/cron/connections");

  await guest.goto(`/c/${connectionId}`);
  await expect(guest.getByText("この接続は終了しています")).toBeVisible();

  // グループは無関係に動く
  await guest.goto(`/g/${groupId}`);
  await guest.getByPlaceholder("メッセージ").fill("1対1が切れても話せる");
  await guest.getByRole("button", { name: "送信", exact: true }).click();
  await expect(guest.getByText("1対1が切れても話せる")).toBeVisible();

  await host.goto(`/g/${groupId}`);
  await expect(host.getByText("1対1が切れても話せる")).toBeVisible({ timeout: 10_000 });
  await ctx.close();
});

test("グループで同席しても1対1のレベルは動かない(D-11)", async ({ page, context }) => {
  const { host, guest, ctx, connectionId } = await connectedPair(page, context);

  await guest.goto(`/c/${connectionId}/info`);
  const before = await guest.locator("main").innerText();

  const groupId = await makeGroup(host, "同席の会");
  await guest.goto(`/g/${groupId}`);
  await guest.getByRole("button", { name: "参加する" }).click();
  await guest.getByPlaceholder("メッセージ").fill("グループで話す");
  await guest.getByRole("button", { name: "送信", exact: true }).click();
  await expect(guest.getByText("グループで話す")).toBeVisible();

  // Connection詳細は1文字も変わらない
  await guest.goto(`/c/${connectionId}/info`);
  expect(await guest.locator("main").innerText()).toBe(before);
  await ctx.close();
});

test("作成者だけがメンバーを外せる / グループを消せる(G-2)", async ({ page, context }) => {
  const { host, guest, ctx } = await connectedPair(page, context);
  const groupId = await makeGroup(host, "管理の会");
  await guest.goto(`/g/${groupId}`);
  await guest.getByRole("button", { name: "参加する" }).click();

  // 作成者でない人には削除系のボタンが出ない
  await guest.goto(`/g/${groupId}/info`);
  await expect(guest.getByRole("button", { name: "外す" })).toHaveCount(0);
  await expect(guest.getByRole("button", { name: "グループを削除" })).toHaveCount(0);
  await expect(guest.getByRole("button", { name: "退出する" })).toBeVisible();

  // 作成者は削除できる
  await host.goto(`/g/${groupId}/info`);
  await expect(host.getByRole("button", { name: "外す" })).toBeVisible();
  await host.getByRole("button", { name: "グループを削除" }).click();
  await host.getByRole("button", { name: "削除する" }).click();
  await expect(host).toHaveURL(/\/home/);

  // 全員の一覧から消える
  await expect(host.getByText("👥 管理の会")).toHaveCount(0);
  await guest.goto("/home");
  await expect(guest.getByText("👥 管理の会")).toHaveCount(0);
  await ctx.close();
});

test("参加していないグループは開けない", async ({ page, context }) => {
  const { host, ctx } = await connectedPair(page, context);
  const groupId = await makeGroup(host, "部外者お断りの会");

  const outsider = await context.browser()!.newContext({ baseURL: origin(host) });
  const p3 = await outsider.newPage();
  await signup(p3, handle("out"), "部外者");
  expect((await p3.goto(`/g/${groupId}`))?.status()).toBe(404);

  await outsider.close();
  await ctx.close();
});

test("KPIダッシュボードが集計を出す(§6)", async ({ page, context }) => {
  const { host, guest, ctx, connectionId } = await connectedPair(page, context);

  const secret = "ダッシュボードに出てはいけない本文";
  await guest.goto(`/c/${connectionId}`);
  await guest.getByPlaceholder("メッセージ").fill(secret);
  await guest.getByRole("button", { name: "送信", exact: true }).click();
  await expect(guest.getByText(secret)).toBeVisible();

  await host.goto("/dashboard");
  await expect(host.getByText("KPIダッシュボード")).toBeVisible();

  // 5指標がそろっている(解説文にも同じ語が出るので、KPI一覧に絞る)
  const kpiRows = host.locator(".rows li .name");
  await expect(kpiRows).toHaveText([
    "QR接続率",
    "初回メッセージ率",
    "期限後継続率",
    "再利用率",
    "恒久化後30日の継続率(LINE移行率の代理)",
  ]);

  // 本文はどこにも出ない(D-10)
  expect(await host.locator("main").innerText()).not.toContain(secret);
  await ctx.close();
});
