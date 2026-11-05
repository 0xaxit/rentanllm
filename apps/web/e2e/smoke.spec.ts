import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { MODEL } from "./fixtures";

const PHONE = { height: 844, width: 390 } as const;

/** Browser-side API calls (ConnectKit's session check, etc.) never leave the test. */
const stubBrowserApi = async (page: Page) => {
  await page.route("**/api/**", async (route) => {
    await route.fulfill({
      json: { _tag: "Unauthorized", message: "Signed out in e2e." },
      status: 401,
    });
  });
};

const settle = async (page: Page) => {
  await page.waitForLoadState("networkidle");
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
};

test.beforeEach(async ({ page }) => {
  await stubBrowserApi(page);
});

test("landing renders the hero", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "PAID PER CALL."
  );
});

test("market lists the offer and the latest paid request", async ({ page }) => {
  await page.goto("/market");
  await expect(page.getByText(MODEL).first()).toBeVisible();
  await expect(page.getByText("1 of 1 seller online")).toBeVisible();
  await expect(page.getByText("LATEST PAID REQUESTS")).toBeVisible();
});

test("signed-out console shows the sign-in panel", async ({ page }) => {
  await page.goto("/console");
  await expect(
    page.getByRole("heading", { name: "Sign in to your seller console" })
  ).toBeVisible();
});

test.describe("phone (390 × 844)", () => {
  test.use({ viewport: PHONE });

  for (const path of ["/", "/market", "/agents", "/console"]) {
    test(`${path} has no horizontal scroll`, async ({ page }) => {
      await page.goto(path);
      await settle(page);
      const size = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }));
      expect(size.scrollWidth).toBeLessThanOrEqual(size.clientWidth);
    });
  }
});
