import { test, expect } from "@playwright/test";

test("health endpoint returns 200", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { status: string };
  expect(body.status).toBe("ok");
});

test("root redirects to tickets page", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/(en|es)\/(?:tickets|login)/);
});

test("login page renders sign-in form", async ({ page }) => {
  await page.goto("/en/login");
  await expect(page.locator('input[type="email"]')).toBeVisible();
  await expect(page.locator('input[type="password"]')).toBeVisible();
});
