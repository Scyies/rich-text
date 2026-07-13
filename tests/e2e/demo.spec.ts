import { expect, test } from "@playwright/test";

test("presents the feature guide and inserts a placeholder at the point-based caret", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Select across the document" })).toBeVisible();
  await expect(page.getByTestId("selection-status")).toHaveText(/No active selection/);
  await expect(page.getByText("Typed plugin block", { exact: true })).toBeVisible();

  const insertPlaceholder = page.getByRole("button", { name: "Insert placeholder" });
  await expect(insertPlaceholder).toBeDisabled();
  await page.locator(".wte-inline-editor").filter({ hasText: "Dos Fatos" }).click({ position: { x: 30, y: 12 } });
  await expect(insertPlaceholder).toBeEnabled();
  await insertPlaceholder.click();

  await expect(page.getByTestId("json")).toContainText("novo_campo");
  await expect(page.getByTestId("selection-status")).toContainText("Caret in block");
});

test("keeps the workbench usable at a narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Select across the document" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reset document" })).toBeVisible();
  await expect(page.locator(".demo__editor .wte-editor")).toBeVisible();
});

test("Enter focuses the new block and typing preserves character order", async ({ page }) => {
  await page.goto("/");
  const source = page.locator(".wte-inline-editor").filter({ hasText: "First supporting fact" });

  await source.click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");

  const focused = page.locator(".wte-inline-editor:focus");
  await expect(focused).toHaveCount(1);
  await expect(focused).not.toHaveText("First supporting fact");
  await page.keyboard.type("abc");
  await expect(focused).toHaveText("abc");
});

test("typing at the end of a block keeps the caret after each character", async ({ page }) => {
  await page.goto("/");
  const source = page.locator(".wte-inline-editor").filter({ hasText: "Second supporting fact" });

  await source.click();
  await page.keyboard.press("End");
  await page.keyboard.type("abc");

  await expect(source).toHaveText("Second supporting factabc");
});

test("a stale document caret does not steal focus from a plugin input", async ({ page }) => {
  await page.goto("/");
  const source = page.locator(".wte-inline-editor").filter({ hasText: "Dos Fatos" });
  await source.click();
  await page.keyboard.press("End");

  const input = page.getByLabel("Callout text");
  const initialValue = await input.inputValue();
  await input.click();
  await page.keyboard.press("End");
  await page.keyboard.type("abc");

  await expect(input).toBeFocused();
  await expect(input).toHaveValue(`${initialValue}abc`);
});

test("a stale document caret does not steal focus from a table cell", async ({ page }) => {
  await page.goto("/");
  const source = page.locator(".wte-inline-editor").filter({ hasText: "Dos Fatos" });
  await source.click();
  await page.keyboard.press("End");

  const cell = page.locator(".wte-table .wte-inline-editor").first();
  await cell.evaluate((element) => element.setAttribute("contenteditable", "plaintext-only"));
  await cell.click();
  await page.keyboard.type("abc");

  await expect(cell).toBeFocused();
  await expect(cell).toHaveText("abc");
});

test("a stale document caret does not steal focus from an embedded control", async ({ page }) => {
  await page.goto("/");
  const source = page.locator(".wte-inline-editor").filter({ hasText: "Dos Fatos" });
  await source.click();
  await page.keyboard.press("End");

  const addRow = page.getByRole("button", { name: "Add row" });
  await addRow.focus();
  await addRow.press("Enter");

  await expect(addRow).toBeFocused();
  await expect(page.locator(".wte-table tbody tr")).toHaveCount(2);
});
