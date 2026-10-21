import assert from "node:assert/strict";

const url = new URL(process.argv[2]);
assert.equal(url.hostname, "127.0.0.1");
assert.equal(url.pathname, "/__table-chat-scroll.html");
const { chromium } = await import(process.env.OMB_VERIFY_PLAYWRIGHT || "playwright");
const browser = await chromium.launch({ executablePath: process.env.OMB_VERIFY_BROWSER_CHROME || undefined, headless: true });
const results = [];
try {
  for (const height of [600, 900]) for (const up of [0, 120]) for (const dismissal of ["Escape", "button"]) {
    const page = await browser.newPage({ viewport: { width: 1000, height } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(url.href);
    const expand = page.getByRole("button", { name: "Expand table", exact: true });
    await expand.waitFor();
    await expand.scrollIntoViewIfNeeded();
    await page.waitForTimeout(100);
    await page.mouse.move(700, 180);
    await page.mouse.wheel(0, -up);
    await page.waitForTimeout(150);
    const snapshot = () => page.locator('[aria-label="Expand table"]').evaluate((element) => {
      const ancestors = [];
      for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        const rect = parent.getBoundingClientRect();
        ancestors.push({ scrollTop: parent.scrollTop, scrollHeight: parent.scrollHeight, y: rect.y, height: rect.height });
      }
      return { y: element.getBoundingClientRect().y, ancestors };
    });
    const before = await snapshot();
    assert.ok(before.y >= 0 && before.y < height - 30, "Trigger is visible before clicking");
    await expand.click();
    const dialog = page.getByRole("dialog");
    await dialog.waitFor();
    await page.waitForTimeout(100);
    assert.deepEqual(await snapshot(), before, "Opening preserves transcript geometry and scroll position");
    if (dismissal === "Escape") await page.keyboard.press("Escape");
    else await dialog.getByRole("button", { name: "Close table", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    await page.waitForTimeout(200);
    assert.deepEqual(await snapshot(), before, "Closing preserves transcript geometry and scroll position");
    assert.equal(await expand.evaluate((element) => element === document.activeElement), true, "Focus returns to expand");
    assert.deepEqual(errors, []);
    results.push({ height, up, dismissal, passed: true });
    await page.close();
  }
  console.log(JSON.stringify({ passed: true, results }));
} finally {
  await browser.close();
}
