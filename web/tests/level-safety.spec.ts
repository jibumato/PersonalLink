import { test, expect, type Page, type BrowserContext } from "@playwright/test";

/**
 * S5 レベルと安全機能の E2E(仕様書 C-2 / E-1 / F-1 / F-2)。
 *
 * 検証の中心は2つ:
 *   1. 解放は双方合意、停止は一方的(D-5)
 *   2. **ブロックしても相手の画面が1文字も変わらない**(F-1 silent block)
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
  await signup(page, handle("lh"), "ホスト");
  await page.goto("/qr");
  await expect(page.locator(".qrsvg svg")).toBeVisible();
  const url = (await page.locator(".qrsvg").getAttribute("data-url"))!;

  const ctx = await context.browser()!.newContext({ baseURL: origin(page) });
  const guest = await ctx.newPage();
  await signup(guest, handle("lg"), "ゲスト");
  await guest.goto(url);
  await guest.getByRole("button", { name: "つながる" }).click();
  await expect(guest).toHaveURL(/established=/);
  await guest.getByRole("link", { name: "メッセージを送る" }).click();
  await expect(guest).toHaveURL(/\/c\//);

  const id = new URL(guest.url()).pathname.split("/")[2];
  await page.goto(`/c/${id}`);
  return { host: page, guest, ctx, id };
}

async function say(page: Page, text: string) {
  await page.getByPlaceholder(/メッセージ|ミュートで送信/).fill(text);
  await page.getByRole("button", { name: "送信", exact: true }).click();
  await expect(page.getByText(text, { exact: true })).toBeVisible();
}

test("レベルは提案と承諾がそろって解放される(C-2 / D-5)", async ({ page, context }) => {
  const { host, guest, ctx, id } = await connectedPair(page, context);

  // 解放前は添付ボタンが出ない(不変条件2)
  await expect(guest.getByRole("button", { name: "写真・ファイルを送る" })).toHaveCount(0);

  await guest.goto(`/c/${id}/info`);
  await guest
    .locator("li", { hasText: "写真・ファイル" })
    .getByRole("button", { name: "提案する" })
    .click();
  await expect(guest.locator("li", { hasText: "写真・ファイル" }).getByText("提案中")).toBeVisible();

  // 提案しただけでは解放されない
  await guest.goto(`/c/${id}`);
  await expect(guest.getByRole("button", { name: "写真・ファイルを送る" })).toHaveCount(0);

  // 相手のチャットに承諾カードが出る
  await host.reload();
  await expect(host.getByText("写真・ファイル(Lv.2)の解放が提案されています")).toBeVisible();
  await host.getByRole("button", { name: "承諾する" }).click();

  // 双方で発効し、タイムラインに残る
  await expect(host.getByText("写真・ファイルが解放されました")).toBeVisible({ timeout: 10_000 });
  await expect(host.getByRole("button", { name: "写真・ファイルを送る" })).toBeVisible();

  await guest.reload();
  await expect(guest.getByRole("button", { name: "写真・ファイルを送る" })).toBeVisible();
  await ctx.close();
});

test("「今はしない」は相手に伝わらない(D-5)", async ({ page, context }) => {
  const { host, guest, ctx, id } = await connectedPair(page, context);

  await guest.goto(`/c/${id}/info`);
  await guest
    .locator("li", { hasText: "詳細プロフィール" })
    .getByRole("button", { name: "提案する" })
    .click();

  // 提案者から見た状態を控える
  await guest.goto(`/c/${id}/info`);
  const before = await guest.locator("main").innerText();

  await host.reload();
  await host.getByRole("button", { name: "今はしない" }).click();
  // 受け手のカードは消える
  await expect(host.getByText("の解放が提案されています")).toHaveCount(0);
  await host.reload();
  await expect(host.getByText("の解放が提案されています")).toHaveCount(0);

  // 提案者の画面は1文字も変わらない
  await guest.goto(`/c/${id}/info`);
  expect(await guest.locator("main").innerText()).toBe(before);

  // 閉じても提案は生きていて、E-1 からあとで承諾できる
  await host.goto(`/c/${id}/info`);
  const l4 = host.locator("li", { hasText: "詳細プロフィール" });
  await l4.getByRole("button", { name: "承諾する" }).click();
  await expect(l4.getByRole("button", { name: "共有を停止" })).toBeVisible();

  // 解放はタイムラインに残る(会話側で確認する)
  await host.goto(`/c/${id}`);
  await expect(host.getByText("詳細プロフィールが解放されました")).toBeVisible();
  await ctx.close();
});

test("共有の停止は一方的・即時(D-5)", async ({ page, context }) => {
  const { host, guest, ctx, id } = await connectedPair(page, context);

  await guest.goto(`/c/${id}/info`);
  await guest
    .locator("li", { hasText: "写真・ファイル" })
    .getByRole("button", { name: "提案する" })
    .click();
  await host.reload();
  await host.getByRole("button", { name: "承諾する" }).click();
  await expect(host.getByRole("button", { name: "写真・ファイルを送る" })).toBeVisible();

  // 承諾した側が、相手の同意なしに停止できる
  await host.goto(`/c/${id}/info`);
  await host
    .locator("li", { hasText: "写真・ファイル" })
    .getByRole("button", { name: "共有を停止" })
    .click();
  await expect(
    host.locator("li", { hasText: "写真・ファイル" }).getByRole("button", { name: "提案する" }),
  ).toBeVisible();

  // 提案した側でも即座に送れなくなる
  await guest.goto(`/c/${id}`);
  await expect(guest.getByRole("button", { name: "写真・ファイルを送る" })).toHaveCount(0);
  await expect(guest.getByText("写真・ファイルの共有が停止されました")).toBeVisible();
  await ctx.close();
});

test("Lv.3 は準備中で提案できない(D-6)", async ({ page, context }) => {
  const { guest, ctx, id } = await connectedPair(page, context);
  await guest.goto(`/c/${id}/info`);

  const row = guest.locator("li", { hasText: "音声・通話" });
  await expect(row.getByText("準備中")).toBeVisible();
  await expect(row.getByRole("button")).toHaveCount(0);
  await ctx.close();
});

test("ブロックしても相手の画面は変わらない(F-1 silent block)", async ({ page, context }) => {
  const { host, guest, ctx, id } = await connectedPair(page, context);
  await say(guest, "ブロック前のことば");
  await expect(host.getByText("ブロック前のことば")).toBeVisible({ timeout: 10_000 });

  // 相手(guest)から見た画面を控える
  await guest.goto(`/c/${id}`);
  const before = await guest.locator(".chatlist").innerText();

  await host.goto(`/c/${id}/info`);
  await host.getByRole("button", { name: "ブロック", exact: true }).click();
  await host.getByRole("button", { name: "ブロックする" }).click();
  await expect(host.getByText("相手には通知されません")).toBeVisible();

  // ブロックされた側は何も気づけない。送信も成功する
  await guest.reload();
  expect(await guest.locator(".chatlist").innerText()).toBe(before);
  await say(guest, "届かないメッセージ");
  await expect(guest.getByText("送信済み").last()).toBeVisible();

  // ブロックした側には届かない
  await host.goto(`/c/${id}`);
  await expect(host.getByText("ブロック前のことば")).toBeVisible();
  await expect(host.getByText("届かないメッセージ")).toHaveCount(0);

  // 設定から解除できるが、ブロック中のぶんは配信されない
  await host.goto("/settings");
  await host.getByRole("button", { name: "解除" }).click();
  await expect(host.getByText("ブロックしている相手はいません")).toBeVisible();

  await host.goto(`/c/${id}`);
  await expect(host.getByText("届かないメッセージ")).toHaveCount(0);
  await ctx.close();
});

test("通報は同意しない限り本文を送らない(F-1 / D-10)", async ({ page, context }) => {
  const { host, ctx, id } = await connectedPair(page, context);

  await host.goto(`/c/${id}/info`);
  await host.getByRole("button", { name: "通報", exact: true }).click();
  await expect(host.getByRole("dialog", { name: "通報" })).toBeVisible();

  // 同意チェックは既定でOFF
  const consent = host.getByRole("checkbox");
  await expect(consent).not.toBeChecked();
  await expect(host.getByText("チェックしない場合、本文は一切送信されません")).toBeVisible();

  await host.getByRole("button", { name: "通報する" }).click();
  await expect(host.getByText("通報を受け付けました")).toBeVisible();
  await ctx.close();
});

test("設定でプロフィールを編集し、データを持ち出せる(F-2)", async ({ page, context }) => {
  const { host, ctx } = await connectedPair(page, context);

  await host.goto("/settings");
  await host.getByLabel("ひとこと(50文字まで)").fill("イベントでよく会います");
  await host.getByRole("button", { name: "保存" }).first().click();
  await expect(host.getByText("保存しました").first()).toBeVisible();

  // L4 は Lv.4 を解放した相手にだけ見える
  await host.getByLabel("本名").fill("山田 太郎");
  await host.getByRole("button", { name: "保存" }).nth(1).click();
  await expect(host.getByText("保存しました").first()).toBeVisible();

  // エクスポートはその場でダウンロードできる
  const res = await host.request.get("/api/export");
  expect(res.ok()).toBeTruthy();
  const data = await res.json();
  expect(data.format).toBe("personallink-export/v1");
  expect(JSON.stringify(data.account)).toContain("山田 太郎");
  await ctx.close();
});

test("L4 は解放するまで相手に見えない", async ({ page, context }) => {
  const { host, guest, ctx, id } = await connectedPair(page, context);

  await host.goto("/settings");
  await host.getByLabel("本名").fill("秘密の本名");
  await host.getByRole("button", { name: "保存" }).nth(1).click();
  await expect(host.getByText("保存しました").first()).toBeVisible();

  // 解放前は影も形もない
  await guest.goto(`/c/${id}/info`);
  await expect(guest.getByText("秘密の本名")).toHaveCount(0);

  await guest
    .locator("li", { hasText: "詳細プロフィール" })
    .getByRole("button", { name: "提案する" })
    .click();
  await host.goto(`/c/${id}`);
  await host.getByRole("button", { name: "承諾する" }).click();
  await expect(host.getByText("詳細プロフィールが解放されました")).toBeVisible({
    timeout: 10_000,
  });

  // 解放後に見える
  await guest.goto(`/c/${id}/info`);
  await expect(guest.getByText("秘密の本名")).toBeVisible();
  await ctx.close();
});

test("アカウント削除は即時・完全(F-2 / 憲法第六条)", async ({ page, context }) => {
  const { host, ctx } = await connectedPair(page, context);
  await host.goto("/home");
  const myHandle = (await host.locator(".homehead .sub").first().innerText()).replace("@", "");

  await host.goto("/settings");
  await host.getByRole("button", { name: "アカウントを削除" }).click();
  await expect(host.getByRole("dialog", { name: "アカウント削除の確認" })).toBeVisible();
  await host.getByRole("button", { name: "削除する" }).click();

  await expect(host).toHaveURL(/\/welcome/);
  // ログアウトされていて、ホームにも入れない
  await host.goto("/home");
  await expect(host).toHaveURL(/\/welcome/);

  // @ID はなりすまし防止のため90日間は誰も取れない
  await host.goto("/signup/id");
  await host.getByPlaceholder("satoshi").fill(myHandle);
  await expect(host.getByText("✓ このIDは利用できます")).toHaveCount(0);
  await ctx.close();
});
