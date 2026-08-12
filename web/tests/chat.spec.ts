import { test, expect, type Page, type BrowserContext } from "@playwright/test";

/**
 * S3 チャットの E2E。
 *
 * 2つのブラウザコンテキストを2台に見立てて、往復・取り消し・ミュートを検証する。
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

/** 2人つないで、両者のチャット画面を開いた状態にする */
async function connectedPair(page: Page, context: BrowserContext) {
  await signup(page, handle("ha"), "ホスト");
  await page.goto("/qr");
  await expect(page.locator(".qrsvg svg")).toBeVisible();
  const url = (await page.locator(".qrsvg").getAttribute("data-url"))!;

  const ctx = await context.browser()!.newContext({ baseURL: origin(page) });
  const guest = await ctx.newPage();
  await signup(guest, handle("gu"), "ゲスト");
  await guest.goto(url);
  await guest.getByRole("button", { name: "つながる" }).click();
  await expect(guest).toHaveURL(/established=/);
  await guest.getByRole("link", { name: "メッセージを送る" }).click();
  await expect(guest).toHaveURL(/\/c\//);

  // ホスト側もチャットを開く
  await page.goto("/home");
  await page.getByText("ゲスト", { exact: true }).click();
  await expect(page).toHaveURL(/\/c\//);

  return { host: page, guest, ctx };
}

async function say(page: Page, text: string) {
  const input = page.getByPlaceholder(/メッセージ|ミュートで送信/);
  await input.fill(text);
  await page.getByRole("button", { name: "送信", exact: true }).click();
  await expect(page.getByText(text, { exact: true })).toBeVisible();
}

test("2台間でメッセージが往復する", async ({ page, context }) => {
  const { host, guest, ctx } = await connectedPair(page, context);

  // 成立のシステムメッセージがタイムラインに刻まれている
  await expect(guest.getByText("つながりました", { exact: false })).toBeVisible();

  await say(guest, "今日はありがとうございました");
  // ポーリングで相手に届く
  await expect(host.getByText("今日はありがとうございました")).toBeVisible({ timeout: 10_000 });

  await say(host, "こちらこそ!");
  await expect(guest.getByText("こちらこそ!")).toBeVisible({ timeout: 10_000 });

  await ctx.close();
});

test("既読は表示されない(D-8)", async ({ page, context }) => {
  const { host, guest, ctx } = await connectedPair(page, context);

  await say(guest, "読まれても表示は変わらない");
  await expect(host.getByText("読まれても表示は変わらない")).toBeVisible({ timeout: 10_000 });

  // ホストが開いていても、ゲスト側の表示は「送信済み」のまま
  await expect(guest.getByText("送信済み").last()).toBeVisible();
  await expect(guest.getByText(/既読/)).toHaveCount(0);
  await ctx.close();
});

test("ミュート送信の印は自分にだけ付く(D-13)", async ({ page, context }) => {
  const { host, guest, ctx } = await connectedPair(page, context);

  await guest.getByRole("button", { name: "ミュート送信: オフ" }).click();
  await expect(guest.getByRole("button", { name: "ミュート送信: オン" })).toBeVisible();
  await say(guest, "夜遅いので静かに送ります");

  // 送信者には印が見える
  await expect(guest.getByText("🌙 ミュートで送信済み")).toBeVisible();

  // 受信者には本文が届くが、ミュートだったことは分からない
  await expect(host.getByText("夜遅いので静かに送ります")).toBeVisible({ timeout: 10_000 });
  await expect(host.getByText(/ミュート/)).toHaveCount(0);
  await ctx.close();
});

test("送信取り消しは相手の画面からも消える(D-12)", async ({ page, context }) => {
  const { host, guest, ctx } = await connectedPair(page, context);

  await say(guest, "これは取り消します");
  await expect(host.getByText("これは取り消します")).toBeVisible({ timeout: 10_000 });

  // 自分の吹き出しをタップ → 操作メニュー
  await guest.getByText("これは取り消します").click();
  await expect(guest.getByRole("dialog", { name: "メッセージの操作" })).toBeVisible();
  await guest.getByRole("button", { name: "送信を取り消す" }).click();

  await expect(guest.getByText("送信を取り消しました")).toBeVisible();
  await expect(guest.getByText("これは取り消します")).toHaveCount(0);

  // 相手の画面でもポーリングで反映される
  await expect(host.getByText("送信を取り消しました")).toBeVisible({ timeout: 10_000 });
  await expect(host.getByText("これは取り消します")).toHaveCount(0);
  await ctx.close();
});

test("自分の画面から削除しても、相手には残る(D-12)", async ({ page, context }) => {
  const { host, guest, ctx } = await connectedPair(page, context);

  await say(guest, "自分の画面からだけ消す");
  await expect(host.getByText("自分の画面からだけ消す")).toBeVisible({ timeout: 10_000 });

  await guest.getByText("自分の画面からだけ消す").click();
  await guest.getByRole("button", { name: "自分の画面から削除" }).click();
  await expect(guest.getByText("自分の画面からだけ消す")).toHaveCount(0);

  // 相手の画面には残り続ける
  await host.reload();
  await expect(host.getByText("自分の画面からだけ消す")).toBeVisible();
  await ctx.close();
});

test("相手のメッセージには操作メニューが出ない", async ({ page, context }) => {
  const { host, guest, ctx } = await connectedPair(page, context);

  await say(guest, "相手は消せない");
  await expect(host.getByText("相手は消せない")).toBeVisible({ timeout: 10_000 });

  await host.getByText("相手は消せない").click();
  await expect(host.getByRole("dialog", { name: "メッセージの操作" })).toHaveCount(0);
  await ctx.close();
});

test("変換確定のEnterで誤送信しない(IME)", async ({ page, context }) => {
  const { guest, ctx } = await connectedPair(page, context);
  const input = guest.getByPlaceholder("メッセージ");
  await input.click();

  await guest.evaluate(() => {
    const el = document.querySelector<HTMLInputElement>(".chatinput")!;
    el.value = "へんかんちゅう";
    el.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    // 変換確定のEnter
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, isComposing: true }));
  });
  // 送信されず、入力欄に残っている
  await expect(input).toHaveValue("へんかんちゅう");

  await guest.evaluate(() => {
    const el = document.querySelector<HTMLInputElement>(".chatinput")!;
    el.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "変換中" }));
  });
  await input.fill("確定してから送る");
  await input.press("Enter");
  await expect(guest.getByText("確定してから送る")).toBeVisible();
  await ctx.close();
});

test("未読バッジが出て、開くと消える", async ({ page, context }) => {
  const { host, guest, ctx } = await connectedPair(page, context);

  await say(guest, "未読になるはず");
  await host.goto("/home");
  await expect(host.locator(".badge.unread")).toHaveText("1");

  await host.getByText("ゲスト", { exact: true }).click();
  await expect(host).toHaveURL(/\/c\//);
  await host.goto("/home");
  await expect(host.locator(".badge.unread")).toHaveCount(0);
  await ctx.close();
});

test("参加していない会話は開けない", async ({ page, context }) => {
  const { guest, ctx } = await connectedPair(page, context);
  const connectionUrl = guest.url();

  const outsider = await context.browser()!.newContext({ baseURL: origin(page) });
  const p3 = await outsider.newPage();
  await signup(p3, handle("out"), "部外者");
  const res = await p3.goto(connectionUrl);
  expect(res?.status()).toBe(404);

  await outsider.close();
  await ctx.close();
});
