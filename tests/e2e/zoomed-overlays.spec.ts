import { expect, test, type Locator, type Page } from "@playwright/test";

// The demo's `?zoom=` wraps the editor in `transform: scale(z)`, the way a host
// zooms its page. Overlays must still land next to what they point at.
const ZOOMED = "/?zoom=1.25";

async function box(locator: Locator) {
  const rect = await locator.boundingBox();
  expect(rect).not.toBeNull();
  return rect!;
}

function liveRangeRect(page: Page) {
  return page.evaluate(() => {
    const rect = window.getSelection()!.getRangeAt(0).getBoundingClientRect();
    return { left: rect.left, top: rect.top, bottom: rect.bottom };
  });
}

test("chip popover opens directly below its chip under a zoomed page", async ({ page }) => {
  await page.goto(ZOOMED);
  const chip = page.locator(".wte-inline-object").filter({ hasText: "Cliente" });
  await chip.click();

  const popover = page.locator(".wte-chip-popover");
  await expect(popover).toBeVisible();
  const chipBox = await box(chip);
  const popoverBox = await box(popover);
  expect(Math.abs(popoverBox.y - (chipBox.y + chipBox.height + 6))).toBeLessThanOrEqual(2);
  expect(Math.abs(popoverBox.x - chipBox.x)).toBeLessThanOrEqual(2);
});

test("floating toolbar sits above the selection under a zoomed page", async ({ page }) => {
  await page.goto(ZOOMED);
  await page.locator(".wte-inline-editor").filter({ hasText: "Second supporting fact" }).dblclick({ position: { x: 20, y: 8 } });

  const toolbar = page.locator(".wte-floating-toolbar");
  await expect(toolbar).toBeVisible();
  const selection = await liveRangeRect(page);
  const toolbarBox = await box(toolbar);
  expect(Math.abs(toolbarBox.y - (selection.top - 40))).toBeLessThanOrEqual(2);
  expect(Math.abs(toolbarBox.x - selection.left)).toBeLessThanOrEqual(2);
});

test("slash menu opens below the caret under a zoomed page", async ({ page }) => {
  await page.goto(ZOOMED);
  const source = page.locator(".wte-inline-editor").filter({ hasText: "Second supporting fact" });
  await source.click();
  await page.keyboard.press("End");
  await page.keyboard.type("/");

  const menu = page.locator(".wte-slash-menu");
  await expect(menu).toBeVisible();
  const caret = await liveRangeRect(page);
  const menuBox = await box(menu);
  expect(Math.abs(menuBox.y - (caret.bottom + 6))).toBeLessThanOrEqual(2);
  expect(Math.abs(menuBox.x - caret.left)).toBeLessThanOrEqual(2);
});

test("the chip popover input stays open on focus, takes typing, saves on Enter, and cancels on Escape", async ({ page }) => {
  await page.goto(ZOOMED);
  const chip = page.locator(".wte-inline-object").filter({ hasText: "Cliente" });
  await chip.click();
  const input = page.locator(".wte-chip-popover input");
  await expect(input).toBeFocused();

  await page.keyboard.type("Ana");
  await expect(input).toHaveValue("Ana");
  await page.keyboard.press("Enter");
  await expect(page.locator(".wte-chip-popover")).toHaveCount(0);
  const filled = page.locator(".wte-inline-object").filter({ hasText: "Ana" });
  await expect(filled).toHaveCount(1);

  await filled.click();
  await expect(input).toBeFocused();
  await page.keyboard.type("Bia");
  await page.keyboard.press("Escape");
  await expect(page.locator(".wte-chip-popover")).toHaveCount(0);
  await expect(filled).toHaveCount(1);
  await expect(filled).toBeFocused();
});
