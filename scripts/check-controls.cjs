// Shared control checks run against the built app with the caller's IPC fixture.
const assert = require("node:assert/strict");
const path = require("node:path");
const os = require("node:os");

async function focusedOption(page, value) {
  // Radix schedules keyboard focus after the key event, so wait for the actual
  // user-visible result before sending the next key (especially in WebKit).
  await page.waitForFunction(
    (expected) =>
      document.activeElement?.getAttribute("role") === "option" &&
      document.activeElement?.getAttribute("data-value") === expected,
    value,
  );
}

async function checkMenu(page) {
  const menu = page.getByRole("listbox");
  await menu.waitFor();
  const box = await menu.boundingBox();
  const viewport = page.viewportSize();
  assert(
    box.x >= 0 && box.x + box.width <= viewport.width + 1,
    "menu fits window width",
  );
  assert(
    box.y >= 0 && box.y + box.height <= viewport.height + 1,
    "menu fits window height",
  );
  const contrast = await menu.evaluate((element) => {
    const rgb = (color) => color.match(/[\d.]+/g).map(Number);
    const luminance = (color) => {
      const channels = color.slice(0, 3).map((channel) => {
        const s = channel / 255;
        return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      });
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    };
    const menuBackground = rgb(getComputedStyle(element).backgroundColor);
    const ratios = [
      ...element.querySelectorAll('[role="option"]:not([data-disabled])'),
    ].map((option) => {
      const style = getComputedStyle(option);
      let background = rgb(style.backgroundColor);
      if (background.length === 4 && background[3] === 0)
        background = menuBackground;
      const foreground = luminance(rgb(style.color));
      const back = luminance(background);
      return (
        (Math.max(foreground, back) + 0.05) /
        (Math.min(foreground, back) + 0.05)
      );
    });
    return {
      opaque: menuBackground.length === 3 || menuBackground[3] === 1,
      minimum: Math.min(...ratios),
    };
  });
  assert(
    contrast.opaque,
    "dropdown background stays opaque, including in clear-glass mode",
  );
  assert(
    contrast.minimum >= 4.5,
    `menu text contrast ${contrast.minimum.toFixed(2)}:1 must be at least 4.5:1`,
  );
}

async function checkSettingsControls(page, engine) {
  const trigger = page.getByRole("combobox", {
    name: "Star density",
    exact: true,
  });
  for (const colorScheme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme });
    await trigger.scrollIntoViewIfNeeded();
    const navBefore = await page.locator(".tabs").boundingBox();
    await trigger.click();
    await checkMenu(page);
    assert.deepEqual(
      await page.locator(".tabs").boundingBox(),
      navBefore,
      "opening a menu must not move navigation",
    );
    await page.screenshot({
      path: path.join(
        os.tmpdir(),
        `enderlink-select-${engine}-${colorScheme}.png`,
      ),
    });
    await page.keyboard.press("Escape");
    await page.waitForFunction(
      () =>
        document.activeElement?.getAttribute("aria-label") === "Star density",
    );
  }

  // A long live catalog: key navigation must scroll the focused option into view.
  const builds = page.getByRole("combobox", {
    name: "Stable build",
    exact: true,
  });
  await builds.click();
  await focusedOption(page, "134");
  assert.equal(await page.getByRole("option").count(), 70);
  await checkMenu(page);
  await page.keyboard.press("End");
  await focusedOption(page, "65");
  const last = await page.getByRole("option").last().boundingBox();
  const list = await page.getByRole("listbox").boundingBox();
  assert(
    last.y >= list.y && last.y + last.height <= list.y + list.height,
    "End reveals the final catalog entry",
  );
  await page.keyboard.press("Enter");
  assert.equal(await builds.getAttribute("data-value"), "65");
  await builds.focus();
  await page.keyboard.press("Space");
  await focusedOption(page, "65");
  await page.keyboard.press("Home");
  await focusedOption(page, "134");
  await page.keyboard.press("Enter");
  assert.equal(await builds.getAttribute("data-value"), "134");

  const memory = page.getByRole("combobox", {
    name: "Default memory for new worlds",
  });
  await memory.focus();
  await page.keyboard.press("ArrowDown");
  await focusedOption(page, "4096");
  await page.keyboard.press("End");
  await focusedOption(page, "32768");
  await page.keyboard.press("ArrowUp");
  await focusedOption(page, "24576");
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    () =>
      document.querySelector('[aria-label="Default memory for new worlds"]')
        .dataset.value === "24576",
  );
  await memory.click();
  await focusedOption(page, "24576");
  await page.keyboard.type("4");
  await focusedOption(page, "4096");
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    () =>
      document.querySelector('[aria-label="Default memory for new worlds"]')
        .dataset.value === "4096",
  );

  // Contrast themes are a Chromium/Windows path; WebKit does not emulate them.
  if (engine === "chromium") {
    for (const colorScheme of ["dark", "light"]) {
      await page.emulateMedia({ forcedColors: "active", colorScheme });
      assert(
        await page.evaluate(
          () => matchMedia("(forced-colors: active)").matches,
        ),
      );
      await trigger.click();
      await checkMenu(page);
      const label = await page
        .locator('.tab[aria-current="page"] .nav-label')
        .evaluate((el) => {
          const style = getComputedStyle(el);
          return { fill: style.webkitTextFillColor, color: style.color };
        });
      assert(
        ![label.fill, label.color].includes("rgba(0, 0, 0, 0)"),
        "selected navigation label survives contrast mode",
      );
      await page.screenshot({
        path: path.join(os.tmpdir(), `enderlink-contrast-${colorScheme}.png`),
      });
      await page.keyboard.press("Escape");
    }
    await page.emulateMedia({ forcedColors: "none", colorScheme: "dark" });
  }

  // The smallest supported window, plus enlarged text for system font scaling.
  await page.setViewportSize({ width: 720, height: 560 });
  const enlargedText = await page.addStyleTag({
    content:
      "body { font-size: 125%; } .select-trigger, .select-menu { font-size: 16px; }",
  });
  await trigger.evaluate((el) => el.scrollIntoView({ block: "end" }));
  await trigger.click();
  await checkMenu(page);
  await page.keyboard.press("Escape");
  await enlargedText.evaluate((el) => el.remove());
  await page.setViewportSize({ width: 1180, height: 830 });
}

async function checkDialogSelect(page, engine) {
  const trigger = page.getByRole("combobox", { name: "Player accounts" });
  await trigger.click();
  await checkMenu(page);
  await page.screenshot({
    path: path.join(os.tmpdir(), `enderlink-select-dialog-${engine}.png`),
  });
  await page.keyboard.press("Escape");
  assert(
    await page.getByRole("dialog").isVisible(),
    "Escape closes only the menu, keeping the dialog open",
  );
  await page.waitForFunction(
    () =>
      document.activeElement?.getAttribute("aria-label") === "Player accounts",
  );
}

module.exports = { checkSettingsControls, checkDialogSelect };
