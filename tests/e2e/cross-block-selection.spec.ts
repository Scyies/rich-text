import { expect, test } from "@playwright/test";

test("drag-selects, deletes, and restores text across independent blocks", async ({ page, browserName }) => {
  await page.goto("/");
  const editors = page.locator(".wte-inline-editor");
  const from = editors.filter({ hasText: "Dos Fatos" });
  const to = editors.filter({ hasText: "First supporting fact" });
  await expect(from).toHaveCount(1);
  await expect(to).toHaveCount(1);
  const fromBox = await from.boundingBox();
  const toBox = await to.boundingBox();
  expect(fromBox).not.toBeNull();
  expect(toBox).not.toBeNull();

  const start = { x: fromBox!.x + 15, y: fromBox!.y + fromBox!.height / 2 };
  const end = { x: toBox!.x + 80, y: toBox!.y + toBox!.height / 2 };
  if (browserName === "webkit") {
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 5 });
  } else {
    await from.dispatchEvent("mousedown", {
      button: 0, buttons: 1, bubbles: true, cancelable: true,
      clientX: start.x, clientY: start.y,
    });
    await to.dispatchEvent("mousemove", {
      button: 0, buttons: 1, bubbles: true, cancelable: true,
      clientX: end.x, clientY: end.y,
    });
  }
  await expect(page.locator(".wte-block--text-range-selected")).toHaveCount(3);
  await expect(page.locator(".wte-floating-toolbar")).toBeVisible();
  await expect(page.getByTestId("selection-status")).toContainText("3 text blocks");

  if (browserName === "webkit") {
    await page.mouse.up();
  } else {
    await to.dispatchEvent("mouseup", {
      button: 0, buttons: 0, bubbles: true, cancelable: true,
      clientX: end.x, clientY: end.y,
    });
  }

  await page.locator(".wte-editor").dispatchEvent("keydown", { key: "Backspace", code: "Backspace", bubbles: true });
  await expect(editors.filter({ hasText: "First supporting fact" })).toHaveCount(0);
  await expect(page.locator(".wte-block")).toHaveCount(13);

  await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
  await expect(editors.filter({ hasText: "Dos Fatos" })).toHaveCount(1);
  await expect(editors.filter({ hasText: "First supporting fact" })).toHaveCount(1);
  await expect(page.locator(".wte-block")).toHaveCount(15);
});

test("pastes over a real drag selection while focus remains on its anchor", async ({ page }) => {
  await page.goto("/");
  const editors = page.locator(".wte-inline-editor");
  const from = editors.filter({ hasText: "Dos Fatos" });
  const to = editors.filter({ hasText: "First supporting fact" });
  const fromBox = await from.boundingBox();
  const toBox = await to.boundingBox();
  expect(fromBox).not.toBeNull();
  expect(toBox).not.toBeNull();

  await page.mouse.move(fromBox!.x + 15, fromBox!.y + fromBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(toBox!.x + 80, toBox!.y + toBox!.height / 2, { steps: 5 });
  await expect(page.locator(".wte-block--text-range-selected")).toHaveCount(3);
  await page.mouse.up();

  await expect(from).toBeFocused();
  const defaultPrevented = await from.evaluate((element) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", "replacement");
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: clipboardData });
    element.dispatchEvent(event);
    return event.defaultPrevented;
  });

  expect(defaultPrevented).toBe(true);
  await expect(editors.filter({ hasText: "First supporting fact" })).toHaveCount(0);
  await expect(page.locator(".wte-block")).toHaveCount(13);
});
