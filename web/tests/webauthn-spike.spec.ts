import { test, expect, type Page } from "@playwright/test";

/**
 * WebAuthn を CI で自動テストする(T-7)。
 *
 * CDP の Virtual Authenticator を使うと、実機の生体認証なしで
 * Passkey の登録・認証を再現できる。実機確認は「本当に Face ID / 指紋で通るか」の
 * 最終確認に絞り、回帰はここで守る。
 */
async function attachVirtualAuthenticator(page: Page) {
  const client = await page.context().newCDPSession(page);
  await client.send("WebAuthn.enable");
  const { authenticatorId } = await client.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true, // discoverable credential(ID入力なしログイン)
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  return { client, authenticatorId };
}

test.describe("WebAuthn スパイク", () => {
  test("対応状況が検出される", async ({ page }) => {
    await attachVirtualAuthenticator(page);
    await page.goto("/spike/webauthn");

    await expect(page.getByText("WebAuthn に対応")).toBeVisible();
    await expect(page.getByText("安全なコンテキスト", { exact: false })).toBeVisible();
  });

  test("Passkeyを作成し、ID入力なしで再認証できる", async ({ page }) => {
    await attachVirtualAuthenticator(page);
    await page.goto("/spike/webauthn");

    await page.getByRole("button", { name: "Passkey を作成" }).click();
    await expect(page.getByText(/登録成功/)).toBeVisible({ timeout: 15_000 });

    await page.getByRole("button", { name: "Passkey でログイン" }).click();
    await expect(page.getByText(/認証成功/)).toBeVisible({ timeout: 15_000 });
  });

  test("未登録の端末ではログインできない", async ({ page }) => {
    await attachVirtualAuthenticator(page);
    await page.goto("/spike/webauthn");

    // 登録せずにいきなり認証すると、資格情報がないため認証器側で失敗する
    await page.getByRole("button", { name: "Passkey でログイン" }).click();
    await expect(page.getByText(/認証失敗|認証中断/)).toBeVisible({ timeout: 15_000 });
  });
});

test("ヘルスチェックがRP IDを返す", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  expect(body.ok).toBe(true);
  expect(body.rpIdWouldBe).toBe("localhost");
});
