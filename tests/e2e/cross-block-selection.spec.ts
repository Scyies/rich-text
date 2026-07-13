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
  const end = { x: toBox!.x + Math.min(40, toBox!.width - 2), y: toBox!.y + toBox!.height / 2 };
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

test("typing replaces a real drag selection without throwing", async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));
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

  await page.keyboard.type("X");

  await expect(editors.filter({ hasText: "First supporting fact" })).toHaveCount(0);
  await expect(page.locator(".wte-block")).toHaveCount(13);
  expect(pageErrors).toEqual([]);
});

test("replacement text consumes a real drag selection", async ({ page }) => {
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

  const defaultPrevented = await from.evaluate((element) => {
    const event = new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      data: "replacement",
      inputType: "insertReplacementText",
    });
    return element.dispatchEvent(event) === false;
  });

  expect(defaultPrevented).toBe(true);
  await expect(editors.filter({ hasText: "First supporting fact" })).toHaveCount(0);
  await expect(page.locator(".wte-block")).toHaveCount(13);
});

test("composition text consumes a real drag selection", async ({ page }) => {
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

  const defaultPrevented = await from.evaluate((element) => element.dispatchEvent(new InputEvent("beforeinput", {
    bubbles: true,
    cancelable: true,
    data: "入",
    inputType: "insertCompositionText",
    isComposing: true,
  })) === false);

  expect(defaultPrevented).toBe(true);
  await expect(editors.filter({ hasText: "First supporting fact" })).toHaveCount(0);
  await expect(page.locator(".wte-block")).toHaveCount(13);
});

test("an embedded input cut cannot mutate a stale document range", async ({ page }) => {
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

  const input = page.getByLabel("Callout text");
  await input.click();
  const defaultPrevented = await input.evaluate((element) => {
    const clipboardData = new DataTransfer();
    const event = new Event("cut", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: clipboardData });
    element.dispatchEvent(event);
    return event.defaultPrevented;
  });

  expect(defaultPrevented).toBe(false);
  await expect(editors.filter({ hasText: "First supporting fact" })).toHaveCount(1);
  await expect(page.locator(".wte-block")).toHaveCount(15);
});

test("embedded input events fall through instead of consuming a stale document range", async ({ page }) => {
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

  const input = page.getByLabel("Callout text");
  await input.click();
  const prevented = await input.evaluate((element) => {
    const clipboardData = new DataTransfer();
    const copy = new Event("copy", { bubbles: true, cancelable: true });
    Object.defineProperty(copy, "clipboardData", { value: clipboardData });
    element.dispatchEvent(copy);
    const beforeInput = new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      data: "X",
      inputType: "insertText",
    });
    element.dispatchEvent(beforeInput);
    const backspace = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Backspace",
    });
    element.dispatchEvent(backspace);
    return [copy.defaultPrevented, beforeInput.defaultPrevented, backspace.defaultPrevented];
  });

  expect(prevented).toEqual([false, false, false]);
  await expect(editors.filter({ hasText: "First supporting fact" })).toHaveCount(1);
  await expect(page.locator(".wte-block")).toHaveCount(15);
});

test("Enter consumes a real drag selection and is one undo step", async ({ page }) => {
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

  await page.keyboard.press("Enter");

  await expect(editors.filter({ hasText: "First supporting fact" })).toHaveCount(0);
  await expect(page.locator(".wte-block")).toHaveCount(14);
  await expect(page.locator(".wte-inline-editor:focus")).toHaveCount(1);

  await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
  await expect(editors.filter({ hasText: "First supporting fact" })).toHaveCount(1);
  await expect(page.locator(".wte-block")).toHaveCount(15);
});

test("a cross-block range visibly selects an intervening atomic block", async ({ page, browserName }) => {
  await page.setViewportSize({ width: 1280, height: 1600 });
  await page.goto("/");
  const editors = page.locator(".wte-inline-editor");
  const from = editors.filter({ hasText: "Dos Fatos" });
  const to = editors.filter({ hasText: "Do Direito" });
  const fromBox = await from.boundingBox();
  const toBox = await to.boundingBox();
  expect(fromBox).not.toBeNull();
  expect(toBox).not.toBeNull();
  const start = { x: fromBox!.x + 15, y: fromBox!.y + fromBox!.height / 2 };
  const end = { x: toBox!.x + Math.min(40, toBox!.width - 2), y: toBox!.y + toBox!.height / 2 };
  if (browserName === "webkit") {
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y);
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

  await expect(page.locator(".wte-block--text-range-selected")).toHaveCount(7);
  await expect(page.locator(".wte-block--custom.wte-block--text-range-selected")).toHaveCount(1);
  if (browserName === "webkit") await page.mouse.up();
});

test("a backward cross-block range visibly selects an intervening atomic block", async ({ page, browserName }) => {
  await page.setViewportSize({ width: 1280, height: 1600 });
  await page.goto("/");
  const editors = page.locator(".wte-inline-editor");
  const from = editors.filter({ hasText: "Do Direito" });
  const to = editors.filter({ hasText: "Dos Fatos" });
  const fromBox = await from.boundingBox();
  const toBox = await to.boundingBox();
  expect(fromBox).not.toBeNull();
  expect(toBox).not.toBeNull();
  const start = { x: fromBox!.x + Math.min(40, fromBox!.width - 2), y: fromBox!.y + fromBox!.height / 2 };
  const end = { x: toBox!.x + 15, y: toBox!.y + toBox!.height / 2 };
  if (browserName === "webkit") {
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 8 });
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

  await expect(page.locator(".wte-block--text-range-selected")).toHaveCount(7);
  await expect(page.locator(".wte-block--custom.wte-block--text-range-selected")).toHaveCount(1);
  if (browserName === "webkit") await page.mouse.up();
});
