import { test, expect, type Page, type BrowserContext } from "@playwright/test";

/**
 * S2 コアループの E2E。
 *
 * 「QR表示 → 読み取り → 接続確認 → 成立」を、**2つのブラウザコンテキスト**で
 * 実際の2台に見立てて検証する。
 */
const origin = (page: Page) => new URL(page.url()).origin;
const handle = (p: string) => `${p}_${Math.random().toString(36).slice(2, 8)}`;

async function signup(page: Page, id: string, name: string) {
  await page.goto("/signup/id");
  await page.getByPlaceholder("satoshi").fill(id);
  // 300msのデバウンス + DB往復。並列実行下では既定の5秒に収まらないことがある
  await expect(page.getByText("✓ このIDは利用できます")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "次へ" }).click();
  await page.getByLabel("表示名(本名でなくてOK)").fill(name);
  await page.getByRole("button", { name: "はじめる" }).click();
  await expect(page).toHaveURL(/\/home/);
}

/** QR画面を開き、埋め込まれた招待URLを取り出す(カメラの代わり) */
async function readQrUrl(page: Page): Promise<string> {
  await page.goto("/qr");
  await expect(page.locator(".qrsvg svg")).toBeVisible();
  // 表示中のQRと同じトークンを、描画に使った値から取得する
  return page.evaluate(() => {
    const img = document.querySelector(".qrsvg");
    return img?.getAttribute("data-url") ?? "";
  });
}

async function newDevice(ctx: BrowserContext, page: Page) {
  const c = await ctx.browser()!.newContext({ baseURL: origin(page) });
  return { ctx: c, page: await c.newPage() };
}

test("QR表示 → 読み取り → 接続確認 → 成立 まで通る", async ({ page, context }) => {
  const hostId = handle("host");
  await signup(page, hostId, "ホストさん");
  const url = await readQrUrl(page);
  expect(url).toContain("/i#");

  const guest = await newDevice(context, page);
  const guestId = handle("guest");
  await signup(guest.page, guestId, "ゲストさん");

  // 招待URLを開く = 相手のQRを読み取ったのと同じ
  await guest.page.goto(url);
  await expect(guest.page).toHaveURL(/\/connect\/confirm/);

  // B-4: 何が共有され、何が共有されないかが明示されている
  await expect(guest.page.getByText("ホストさん")).toBeVisible();
  await expect(guest.page.getByText("期限: 7日間")).toBeVisible();
  await expect(guest.page.getByText("電話番号・メールアドレス・LINE ID")).toBeVisible();

  await guest.page.getByRole("button", { name: "つながる" }).click();

  // B-5: 成立の演出
  await expect(guest.page).toHaveURL(/established=/);
  await expect(guest.page.getByText("ホストさん とつながりました")).toBeVisible();
  // S3 でボタンが「メッセージを送る / あとで」に変わった
  await guest.page.getByRole("button", { name: "あとで" }).click();
  await expect(guest.page.getByRole("dialog")).toBeHidden();

  // B-1: 一覧に出て、期限バッジが付く
  await expect(guest.page.getByText("ホストさん", { exact: true })).toBeVisible();
  await expect(guest.page.getByText("⏳ 残り7日")).toBeVisible();

  // 表示側の一覧にも出る
  await page.goto("/home");
  await expect(page.getByText("ゲストさん", { exact: true })).toBeVisible();
  await guest.ctx.close();
});

test("使用済みのQRは二度使えない", async ({ page, context }) => {
  await signup(page, handle("once"), "1回だけさん");
  const url = await readQrUrl(page);

  const g1 = await newDevice(context, page);
  await signup(g1.page, handle("g1"), "先着");
  await g1.page.goto(url);
  await g1.page.getByRole("button", { name: "つながる" }).click();
  await expect(g1.page).toHaveURL(/established=/);

  // 同じURLを別の人が開く
  const g2 = await newDevice(context, page);
  await signup(g2.page, handle("g2"), "後から");
  await g2.page.goto(url);
  await expect(g2.page.getByText(/使用済み/)).toBeVisible();

  await g1.ctx.close();
  await g2.ctx.close();
});

test("自分のQRは読み取れない", async ({ page }) => {
  await signup(page, handle("self"), "自分");
  const url = await readQrUrl(page);
  await page.goto(url);
  await expect(page.getByText("自分のQRです")).toBeVisible();
});

test("すでにつながっている相手のQRは、確認画面を飛ばす", async ({ page, context }) => {
  await signup(page, handle("dupc"), "重複ホスト");
  const first = await readQrUrl(page);

  const guest = await newDevice(context, page);
  await signup(guest.page, handle("dupg"), "重複ゲスト");
  await guest.page.goto(first);
  await guest.page.getByRole("button", { name: "つながる" }).click();
  await expect(guest.page).toHaveURL(/established=/);

  // ホストが新しいQRを出しても、既に接続済みなので確認画面には行かない
  const second = await readQrUrl(page);
  await guest.page.goto(second);
  await expect(guest.page).toHaveURL(/already=1/);
  await expect(guest.page.getByText("すでにつながっています")).toBeVisible();
  await guest.ctx.close();
});

test("未登録でQRを読むと、登録後にそのまま接続される(キラー体験)", async ({ page, context }) => {
  await signup(page, handle("evt"), "イベント主催");
  const url = await readQrUrl(page);

  // アカウントを持っていない人が招待URLを開く
  const newbie = await newDevice(context, page);
  await newbie.page.goto(url);
  await expect(newbie.page.getByText("イベント主催 とつながる")).toBeVisible();

  await newbie.page.getByRole("link", { name: "アカウントを作る" }).click();
  const id = handle("newbie");
  await newbie.page.getByPlaceholder("satoshi").fill(id);
  await expect(newbie.page.getByText("✓ このIDは利用できます")).toBeVisible();
  await newbie.page.getByRole("button", { name: "次へ" }).click();
  await newbie.page.getByLabel("表示名(本名でなくてOK)").fill("新規さん");
  await newbie.page.getByRole("button", { name: "はじめる" }).click();

  // 登録が終わった瞬間に接続が成立している
  await expect(newbie.page).toHaveURL(/established=/);
  await expect(newbie.page.getByText("イベント主催 とつながりました")).toBeVisible();
  await newbie.ctx.close();
});

test("期限チップを変えると、その期限で成立する", async ({ page, context }) => {
  await signup(page, handle("exp"), "期限テスト");
  await page.goto("/qr");
  await page.getByRole("button", { name: "30日" }).click();
  // 反映中はチップが無効になる。有効に戻る = サーバー側にも反映済み
  await expect(page.getByRole("button", { name: "30日" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "30日" })).toHaveAttribute("aria-pressed", "true");
  const url = await readQrUrl(page);

  const guest = await newDevice(context, page);
  await signup(guest.page, handle("expg"), "期限ゲスト");
  await guest.page.goto(url);
  await expect(guest.page.getByText("期限: 30日間")).toBeVisible();
  await guest.page.getByRole("button", { name: "つながる" }).click();
  await expect(guest.page.getByText("⏳ 30日間")).toBeVisible();
  await guest.ctx.close();
});

test("壊れたトークンは弾かれる", async ({ page }) => {
  await signup(page, handle("bad"), "不正");
  await page.goto("/i#not-a-real-token");
  await expect(page.getByText("PersonalLinkのQRではありません")).toBeVisible();
});
