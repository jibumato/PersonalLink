import { test, expect, type Page } from "@playwright/test";

/** 別ブラウザコンテキストを作るとき用に、今開いているURLからオリジンを得る */
const origin = (page: Page) => new URL(page.url()).origin;

/** テストごとに衝突しない @ID を作る */
const handle = (prefix: string) => `${prefix}_${Math.random().toString(36).slice(2, 8)}`;

async function signup(page: Page, id: string, name: string) {
  await page.goto("/signup/id");
  await page.getByPlaceholder("satoshi").fill(id);
  await expect(page.getByText("✓ このIDは利用できます")).toBeVisible();
  await page.getByRole("button", { name: "次へ" }).click();
  await expect(page).toHaveURL(/\/signup\/profile/);
  await page.getByLabel("表示名(本名でなくてOK)").fill(name);
  await page.getByRole("button", { name: "はじめる" }).click();
  await expect(page).toHaveURL(/\/home/);
}

test("ヘルスチェックが応答する", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.ok()).toBeTruthy();
  expect((await res.json()).ok).toBe(true);
});

test("未ログインならウェルカムへ振り分けられる", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/welcome/);
  await expect(page.getByRole("heading", { name: /LINEを教える前に/ })).toBeVisible();
});

test("登録してホームに到達し、再訪でもログインが保たれる", async ({ page }) => {
  const id = handle("e2e");
  await signup(page, id, "さとし");

  await expect(page.getByText("さとし")).toBeVisible();
  await expect(page.getByText(`@${id}`)).toBeVisible();

  // セッションCookieで再訪してもログイン状態
  await page.goto("/");
  await expect(page).toHaveURL(/\/home/);
});

test("使用済みのIDは取得できない", async ({ page, context }) => {
  const id = handle("dup");
  await signup(page, id, "先に取った人");

  // 別コンテキストは baseURL を引き継がないため明示する
  const other = await context.browser()!.newContext({ baseURL: origin(page) });
  const p2 = await other.newPage();
  await p2.goto("/signup/id");
  await p2.getByPlaceholder("satoshi").fill(id);
  await expect(p2.getByText("このIDは使われています")).toBeVisible();
  await expect(p2.getByRole("button", { name: "次へ" })).toBeDisabled();
  await other.close();
});

test("予約語は取得できない", async ({ page }) => {
  await page.goto("/signup/id");
  await page.getByPlaceholder("satoshi").fill("admin");
  await expect(page.getByText("このIDは使えません")).toBeVisible();
  await expect(page.getByRole("button", { name: "次へ" })).toBeDisabled();
});

test("日本語入力(IME)で入力欄が壊れず、案内が出る", async ({ page }) => {
  await page.goto("/signup/id");
  const input = page.getByPlaceholder("satoshi");
  await input.click();

  // 変換中に要素が作り直されないことを、マーカーの生存で確かめる
  await page.evaluate(() => {
    const el = document.querySelector<HTMLInputElement>('input[name="handle"]')!;
    el.dataset.mark = "keep";
    el.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    el.value = "さ";
    el.dispatchEvent(new InputEvent("input", { bubbles: true, isComposing: true }));
  });
  expect(
    await page.evaluate(
      () => document.querySelector<HTMLInputElement>('input[name="handle"]')?.dataset.mark,
    ),
  ).toBe("keep");

  await page.evaluate(() => {
    const el = document.querySelector<HTMLInputElement>('input[name="handle"]')!;
    el.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "さ" }));
  });

  await expect(page.getByText(/日本語入力をオフ/)).toBeVisible();
  await expect(input).toHaveValue("さ"); // 残留文字が出ていない
  await expect(page.getByRole("button", { name: "次へ" })).toBeDisabled();
});

test("大文字は小文字に直され、カーソル位置も保たれる", async ({ page }) => {
  await page.goto("/signup/id");
  const input = page.getByPlaceholder("satoshi");
  await input.pressSequentially("Satoshi", { delay: 20 });
  await expect(input).toHaveValue("satoshi");
});

test("全端末ログアウトで、他の端末のセッションが即座に無効になる", async ({ page, context }) => {
  const id = handle("revoke");
  await signup(page, id, "端末A");

  // 同じアカウントで2台目にログイン(開発用の仮ログイン)
  const second = await context.browser()!.newContext({ baseURL: origin(page) });
  const p2 = await second.newPage();
  await p2.goto("/dev/login");
  await p2.getByPlaceholder("satoshi").fill(id);
  await p2.getByRole("button", { name: "ログイン" }).click();
  await expect(p2).toHaveURL(/\/home/);

  // 1台目から見て2台になっている
  await page.goto("/settings/devices");
  await expect(page.getByText(/ログイン中の端末は 2 台です/)).toBeVisible();

  // この端末以外からログアウト
  await page.getByRole("button", { name: "この端末以外からログアウト" }).click();
  await expect(page.getByText(/ログイン中の端末は 1 台です/)).toBeVisible();

  // 2台目は即座に弾かれる(DBセッションなので即時revokeが効く)
  await p2.goto("/home");
  await expect(p2).toHaveURL(/\/welcome/);
  await second.close();
});

test("ログアウトするとホームに入れない", async ({ page }) => {
  await signup(page, handle("logout"), "ログアウト太郎");
  await page.getByRole("button", { name: "ログアウト" }).click();
  await expect(page).toHaveURL(/\/welcome/);
  await page.goto("/home");
  await expect(page).toHaveURL(/\/welcome/);
});

test("未ログインでは端末管理を開けない", async ({ page }) => {
  await page.goto("/settings/devices");
  await expect(page).toHaveURL(/\/welcome/);
});
