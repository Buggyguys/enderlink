// Tests the production assets using an explicit test-only IPC fixture. No web server.
const { chromium, webkit } = require("playwright");
const engine = process.env.ENDERLINK_TEST_BROWSER || "chromium";
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const assert = require("node:assert/strict");
const {
  checkSettingsControls,
  checkDialogSelect,
} = require("./check-controls.cjs");
const root = path.resolve(__dirname, "..");
const dist = path.join(root, "apps/desktop/dist");
(async () => {
  const browser = await { chromium, webkit }[engine].launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1180, height: 830 },
    reducedMotion: "no-preference",
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== "enderlink.test") return route.abort();
    const pathname = decodeURIComponent(
      url.pathname === "/" ? "/index.html" : url.pathname,
    );
    const filename = path.resolve(dist, "." + pathname);
    if (!filename.startsWith(dist + path.sep)) return route.abort();
    const ext = path.extname(filename);
    await route.fulfill({
      path: filename,
      contentType:
        {
          ".html": "text/html",
          ".js": "text/javascript",
          ".css": "text/css",
          ".svg": "image/svg+xml",
          ".png": "image/png",
        }[ext] || "application/octet-stream",
    });
  });
  await page.addInitScript(() => {
    const component = {
      id: "component-1",
      engine: "paper",
      minecraft: "1.21.1",
      version: "133",
      javaMajor: 21,
      sha256: "fixture",
      bytes: 40000000,
      installedAt: 1,
    };
    window.testSnapshot = {
      worlds: [
        {
          id: "world-1",
          name: "Mossy Hollow",
          revision: 1,
          component,
          memoryMb: 4096,
          maxPlayers: 8,
          port: 25565,
          lan: false,
          seed: "",
          difficulty: "normal",
          gamemode: "survival",
          coverBlock: "amethyst",
          eulaAcceptedAt: 1,
          players: [{ name: "Birch", uuid: "fixture-player" }],
          createdAt: Math.floor(Date.now() / 1000) - 18 * 86400,
          lastPlayed: null,
          packNotes: "",
        },
      ],
      components: [component],
      backups: [],
      settings: {
        defaultEngine: "paper",
        memoryMb: 4096,
        reducedMotion: false,
        preventSleep: false,
        glass: true,
        stars: true,
        starDensity: "medium",
        motionSpeed: "gentle",
      },
      session: {
        worldId: "world-1",
        state: "running",
        startedAt: Math.floor(Date.now() / 1000) - 1800,
        pid: 42,
        memoryBytes: 1000000000,
        cpuPercent: 4,
        players: ["Birch"],
        playersKnown: true,
        error: null,
      },
      provider: {
        linked: true,
        persisted: false,
        agentRegistered: true,
        state: "agentRunning",
        endpoints: ["example.invalid:25565"],
        error: null,
        claimUrl: null,
      },
      operations: [],
      logs: [],
      warnings: [],
      dataDir: "/test/enderlink",
      totalMemory: 17179869184,
      providerSetup: { tunnelConfigured: true, checkedAt: 1793980000 },
      softwareUpdates: [
        {
          componentId: "component-1",
          latest: "133",
          status: "upToDate",
          checkedAt: 1793980000,
        },
      ],
      memory: {
        total: 17179869184,
        used: 8589934592,
        available: 8589934592,
        app: 160000000,
        server: 1800000000,
        minecraftClients: 2400000000,
        clientCount: 1,
        other: 4229934592,
        observedAt: 1793980000,
        partialProcessVisibility: false,
      },
    };
    window.testSnapshot.backups = Array.from({ length: 12 }, (_, index) => ({
      id: `backup-${index}`,
      world: structuredClone(window.testSnapshot.worlds[0]),
      createdAt: Math.floor(Date.now() / 1000) - (12 - index) * 86400,
      bytes: 32000000 + index * 500000,
      sha256: "fixture",
    }));
    window.isTauri = true;
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
    window.__TAURI_INTERNALS__ = {
      transformCallback: () => 1,
      invoke: async (cmd, payload) => {
        if (cmd.startsWith("plugin:event|")) return 1;
        if (cmd === "uninstall_info")
          return {
            supported: true,
            method: "macos_bundle",
            applicationPath: "/test/Enderlink.app",
            description:
              "Enderlink will close before the app and local data are removed.",
          };
        if (cmd === "plugin:dialog|open") return "/test/exports";
        if (cmd === "plugin:path|join") return payload.paths.join("/");
        if (cmd === "uninstall_app")
          throw new Error(
            "Native uninstall is never executed in UI verification.",
          );
        const { action } = payload || {};
        if (action === "snapshot") return structuredClone(window.testSnapshot);
        if (action === "maintenancePlan")
          return {
            token: "review-fixture",
            worlds: window.testSnapshot.worlds.length,
            backups: window.testSnapshot.backups.length,
            components: window.testSnapshot.components.length,
            bytes: 900000000,
            hasLibrary: !!(
              window.testSnapshot.worlds.length ||
              window.testSnapshot.backups.length
            ),
          };
        if (action === "resetAllData")
          return new Promise((_resolve, reject) => {
            window.rejectResetFixture = () =>
              reject("Fixture: no real data was cleared");
          });
        if (action === "patchSettings") {
          Object.assign(window.testSnapshot.settings, payload.args);
          return null;
        }
        if (action === "minecraftVersions") return ["1.21.1"];
        if (action === "versions")
          return Array.from({ length: 70 }, (_, i) => ({
            ...component,
            version: String(134 - i),
          }));
        if (action === "playtime") {
          const bounds = payload.args.boundaries;
          return {
            worldId: "world-1",
            recordedFrom: bounds[0],
            observedAt: Date.now() / 1000,
            players: [
              { id: "offline:fixture", name: "Birch", verified: false },
            ],
            days: bounds.slice(0, -1).map((start, i) => ({
              start,
              end: bounds[i + 1],
              worldSeconds: (i % 5) * 900,
              players: [
                {
                  id: "offline:fixture",
                  name: "Birch",
                  seconds: (i % 5) * 900,
                },
              ],
            })),
          };
        }
        if (action === "storage")
          return {
            worlds: 123456,
            backups: 0,
            components: 40000000,
            java: 180000000,
          };
        return null;
      },
    };
  });
  async function choose(name, value) {
    await page.getByRole("combobox", { name, exact: true }).click();
    await page
      .locator(`.select-option[data-value=${JSON.stringify(value)}]`)
      .click();
    await page.getByRole("listbox").waitFor({ state: "hidden" });
  }
  try {
    await page.goto("http://enderlink.test/");
    assert.equal(await page.getByText("Made for your people").count(), 0);
    const nav = await page.getByRole("navigation").boundingBox();
    assert(
      Math.abs(nav.x + nav.width / 2 - 590) < 1,
      "navigation centered in window",
    );
    assert.equal(await page.locator(".end-star").count(), 56);
    assert.equal(
      await page.locator(".world-art .world-block-face").count(),
      6,
      "world cover displays the chosen block",
    );
    const skyPositions = () =>
      page.locator(".end-star").evaluateAll((stars) =>
        stars.map((star) => {
          const box = star.getBoundingClientRect();
          return {
            x: box.x,
            y: box.y,
            size: star.style.getPropertyValue("--size"),
          };
        }),
      );
    const starsBefore = await skyPositions();
    assert(
      new Set(starsBefore.map((s) => s.size)).size > 35,
      "varied independent star sizes",
    );
    await page.waitForTimeout(1400);
    const starsAfter = await skyPositions();
    const movement = starsAfter
      .map((s, i) => Math.hypot(s.x - starsBefore[i].x, s.y - starsBefore[i].y))
      .sort((a, b) => a - b);
    assert(
      movement[28] > 3,
      `visible default star movement, median ${movement[28].toFixed(2)} px in 1.4 seconds`,
    );
    console.log(
      `${engine}: median star displacement ${movement[28].toFixed(2)} px / 1.4 s`,
    );
    assert(
      await page
        .locator(".topbar")
        .evaluate(
          (el) => getComputedStyle(el).backgroundColor === "rgba(0, 0, 0, 0)",
        ),
      "header does not mask the sky",
    );
    // Exercise a non-overlay scrollbar, including webviews configured to always show it.
    const classic = await page.addStyleTag({
      content:
        ".page-scroll { scrollbar-color: auto !important; } .page-scroll::-webkit-scrollbar { width: 18px; } .page-scroll::-webkit-scrollbar-thumb { background: #665577; border-radius: 9px; }",
    });
    const fixedNav = await page.getByRole("navigation").boundingBox();
    const scrollBox = await page.locator(".page-scroll").boundingBox();
    assert(
      scrollBox.y >= fixedNav.y + fixedNav.height,
      "scrollbar starts below the header",
    );
    assert(
      await page
        .locator(".page-scroll")
        .evaluate((el) => el.offsetWidth - el.clientWidth >= 18),
      "classic scrollbar gutter is exercised",
    );
    for (const route of ["Settings", "Host", "Settings", "Host"]) {
      await page.getByRole("button", { name: route, exact: true }).click();
      await page.waitForTimeout(80);
      const current = await page.getByRole("navigation").boundingBox();
      assert.equal(
        current.x,
        fixedNav.x,
        "navigation cannot shift with scrollbar visibility",
      );
      assert.equal(
        current.width,
        fixedNav.width,
        "navigation width stays fixed between routes",
      );
      assert.equal(
        (await page.locator(".page-scroll").boundingBox()).width,
        scrollBox.width,
        "page viewport remains stable",
      );
    }
    await classic.evaluate((el) => el.remove());
    await page.evaluate(() => {
      window.testSnapshot.operations = ["First", "Second"].map(
        (label, index) => ({
          id: `test-op-${index}`,
          label: `${label} task`,
          status: "running",
          message: "Working…",
          progress: 0.5,
          startedAt: Math.floor(Date.now() / 1000),
          finishedAt: null,
        }),
      );
    });
    await page.waitForFunction(
      () => document.querySelectorAll(".notification-card").length === 2,
    );
    const messages = await page
      .locator(".notification-card")
      .evaluateAll((nodes) =>
        nodes.map((node) => {
          const { top, bottom } = node.getBoundingClientRect();
          return { top, bottom };
        }),
      );
    assert(
      messages[0].bottom <= messages[1].top,
      "messages stack without overlapping",
    );
    await page.mouse.move(0, 0);
    await page.evaluate(() => {
      window.testSnapshot.operations.forEach((operation, index) => {
        operation.status = "completed";
        operation.finishedAt = Math.floor(Date.now() / 1000);
        operation.message = `Finished task ${index}`;
      });
    });
    await page.getByText("Finished task 0", { exact: true }).waitFor();
    await page.waitForFunction(
      () => document.querySelectorAll(".notification-card").length === 0,
      {},
      { timeout: 6000 },
    );
    await page.getByRole("button", { name: "Open world →" }).click();
    await page.getByRole("heading", { name: "Resource activity" }).waitFor();
    await page.getByRole("heading", { name: "Time together" }).waitFor();
    const dashboardBox = await page.locator(".dashboard").boundingBox();
    const historyBox = await page
      .locator(".world-history")
      .first()
      .boundingBox();
    assert(
      historyBox.width > dashboardBox.width * 0.95,
      "history cards use the full dashboard width",
    );
    assert.equal(
      await page.getByRole("heading", { name: "Players · 1" }).count(),
      1,
      "known player count is displayed",
    );
    assert.equal(await page.locator("footer").count(), 0, "no bottom footer");
    assert(
      await page.getByRole("img", { name: /Memory use:/ }).isVisible(),
      "live memory appears in the running world's dashboard",
    );
    const timeline = page.locator(".backup-time-viewport");
    await timeline.scrollIntoViewIfNeeded();
    assert.equal(
      await page.locator(".backup-time-line").count(),
      1,
      "continuous timeline line",
    );
    assert.equal(
      await page.locator(".backup-time-dot").count(),
      12,
      "every backup has a time-positioned dot",
    );
    const timelineSpan = () =>
      timeline.evaluate(
        (el) => Number(el.dataset.rangeEnd) - Number(el.dataset.rangeStart),
      );
    const fullSpan = await timelineSpan();
    await page.getByRole("button", { name: "Zoom in timeline" }).click();
    assert(
      (await timelineSpan()) < fullSpan * 0.6,
      "zoom narrows the visible time range",
    );
    const startBeforePan = await timeline.getAttribute("data-range-start");
    await timeline.focus();
    await page.keyboard.press("ArrowLeft");
    assert.notEqual(
      await timeline.getAttribute("data-range-start"),
      startBeforePan,
      "keyboard pans the time range",
    );
    await page.getByRole("button", { name: "Show entire timeline" }).click();
    const firstDot = page.locator(".backup-time-hit").first();
    await firstDot.click();
    assert.equal(
      await page
        .getByRole("combobox", { name: "Selected backup" })
        .getAttribute("data-value"),
      "backup-0",
      "dot selects its snapshot",
    );
    await page.locator(".backup-history").screenshot({
      path: path.join(os.tmpdir(), `enderlink-timeline-${engine}.png`),
    });
    await page.getByRole("button", { name: "Review restore" }).click();
    await page
      .getByRole("button", { name: "Restore as a new world" })
      .waitFor();
    await page.keyboard.press("Escape");
    await page.locator(".page-scroll").evaluate((el) => (el.scrollTop = 0));
    await page.screenshot({
      path: path.join(os.tmpdir(), `enderlink-dashboard-${engine}.png`),
      fullPage: true,
    });
    const before = await page.locator(".stats").boundingBox();
    await page.evaluate(() => {
      window.testSnapshot.session.error =
        "Startup detail: " + "Useful error information. ".repeat(40);
    });
    await page.getByRole("alert").waitFor();
    const after = await page.locator(".stats").boundingBox();
    assert.equal(
      after.y,
      before.y,
      "runtime error must not shift dashboard cards",
    );
    for (const [width, height] of [
      [1180, 830],
      [900, 700],
      [720, 560],
    ]) {
      await page.setViewportSize({ width, height });
      assert(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth <= innerWidth &&
            document.querySelector(".page-scroll").scrollWidth <=
              document.querySelector(".page-scroll").clientWidth,
        ),
        `horizontal overflow at ${width}`,
      );
      await page.getByRole("button", { name: "World settings" }).click();
      const dialog = page.getByRole("dialog");
      await dialog.waitFor();
      assert.equal(
        await page.getByRole("button", { name: "Previous blocks" }).count(),
        0,
      );
      assert.equal(
        await page.getByRole("button", { name: "Next blocks" }).count(),
        0,
      );
      assert.equal(
        await page.getByRole("radio").count(),
        21,
        "twenty blocks and None",
      );
      const box = await dialog.boundingBox();
      assert(
        box.x >= 0 && box.x + box.width <= width + 1,
        "dialog must fit window width",
      );
      assert(
        box.y >= 0 && box.y + box.height <= height + 1,
        "dialog must fit window height",
      );
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "World settings" }).waitFor();
    }
    await page.setViewportSize({ width: 1180, height: 830 });
    const from = await page.locator(".nav-selection").boundingBox();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.waitForTimeout(100);
    const midway = await page.locator(".nav-selection").boundingBox();
    assert(
      midway.x > from.x && midway.x < from.x + from.width,
      "selection slides between tabs",
    );
    await page.waitForTimeout(500);
    assert.equal(
      await page.getByRole("navigation").getByRole("button").count(),
      2,
      "Host and Settings only",
    );
    await page
      .getByRole("heading", { name: "All good. Your next adventure is ready." })
      .waitFor();
    const settings = await page.locator(".settings").boundingBox();
    assert(
      Math.abs(settings.x + settings.width / 2 - 590) < 1,
      "settings centered",
    );
    assert.equal(
      await page.getByRole("img", { name: /Memory use:/ }).count(),
      0,
      "Settings has no live memory panel",
    );
    assert(
      await page
        .getByRole("combobox", { name: "Default memory for new worlds" })
        .isVisible(),
    );
    assert.equal(
      await page.getByRole("button", { name: /^Use \d+ GB$/ }).count(),
      0,
      "no automatic RAM recommendation",
    );
    await page.locator(".memory-settings-guide summary").click();
    assert.equal(
      await page.locator(".memory-settings-guide tbody tr").count(),
      3,
      "compact allocation table",
    );
    await page.locator(".memory-settings-guide summary").click();
    for (const width of [1180, 900, 720]) {
      await page.setViewportSize({ width, height: 830 });
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        `settings fits ${width}`,
      );
    }
    await page.setViewportSize({ width: 1180, height: 830 });
    assert(
      (await page.locator(".memory-settings").boundingBox()).height < 320,
      "memory panel remains compact",
    );
    await page.waitForTimeout(550);
    await page.screenshot({
      path: path.join(os.tmpdir(), `enderlink-settings-${engine}.png`),
    });
    await checkSettingsControls(page, engine);
    await page.getByRole("button", { name: "Manage", exact: true }).click();
    await page.getByRole("button", { name: "Remove managed data…" }).click();
    assert(
      await page
        .getByRole("button", { name: "Remove selected data" })
        .isDisabled(),
      "active server must block cleanup",
    );
    assert(
      await page.getByRole("checkbox", { name: "Keep my worlds" }).isChecked(),
    );
    assert(
      await page.getByRole("checkbox", { name: "Keep my backups" }).isChecked(),
    );
    await page.keyboard.press("Escape");
    await page.evaluate(() => {
      window.testSnapshot.session = null;
      window.testSnapshot.provider.endpoints = [];
    });
    await page.waitForTimeout(2200);
    assert(
      await page
        .getByRole("heading", {
          name: "All good. Your next adventure is ready.",
        })
        .isVisible(),
      "stopping a world does not reset setup",
    );
    await page.evaluate(() => {
      window.testSnapshot.softwareUpdates[0] = {
        componentId: "component-1",
        latest: "134",
        status: "updateAvailable",
        checkedAt: 1793980100,
      };
    });
    await page
      .getByRole("heading", { name: "A little attention, then you’re ready." })
      .waitFor();
    await choose("Star movement", "still");
    assert(
      await page
        .getByRole("combobox", { name: "Star speed", exact: true })
        .isDisabled(),
    );
    assert(
      await page
        .locator(".end-star")
        .first()
        .evaluate((el) => getComputedStyle(el).animationName === "none"),
      "Still stops travel independently of shimmer",
    );
    await page
      .getByRole("switch", { name: "Color shimmer", exact: true })
      .uncheck();
    assert(
      await page
        .locator(".star-light")
        .first()
        .evaluate((el) => getComputedStyle(el).animationName === "none"),
      "shimmer can be disabled independently",
    );
    await choose("Star movement", "wander");
    await choose("Star speed", "slow");
    const slow = await page
      .locator(".end-star")
      .first()
      .evaluate((el) => parseFloat(getComputedStyle(el).animationDuration));
    await choose("Star speed", "lively");
    const lively = await page
      .locator(".end-star")
      .first()
      .evaluate((el) => parseFloat(getComputedStyle(el).animationDuration));
    assert(
      slow / lively > 3.5,
      "star speed visibly changes travel speed independently of navigation",
    );
    await choose("Glass finish", "dense");
    const dense = await page
      .locator(".card")
      .first()
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    await choose("Glass finish", "clear");
    const clear = await page
      .locator(".card")
      .first()
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    assert(
      dense.endsWith("0.84)") && clear.endsWith("0.14)"),
      "glass opacity selection applies to cards",
    );
    await page.getByRole("button", { name: "Use lightweight mode" }).click();
    await page.getByRole("button", { name: "Lightweight enabled" }).waitFor();
    assert.equal(await page.locator(".end-star").count(), 0);
    assert(
      await page.evaluate(
        () =>
          getComputedStyle(document.querySelector(".card")).backdropFilter ===
          "none",
      ),
    );
    assert(
      await page.evaluate(
        () =>
          document.getAnimations().filter((a) => a.playState === "running")
            .length === 0,
      ),
      "zero active animation in lightweight mode",
    );
    await page.getByRole("switch", { name: "Starfield", exact: true }).check();
    await page.locator(".end-star").first().waitFor();
    assert(
      await page.evaluate(
        () =>
          getComputedStyle(document.querySelector(".end-star"))
            .animationName === "none",
      ),
      "stars remain static with animation disabled",
    );
    await page
      .getByRole("switch", { name: "Frosted glass", exact: true })
      .check();
    await page.getByRole("switch", { name: "Animations", exact: true }).check();
    await page.emulateMedia({ reducedMotion: "reduce" });
    assert(
      await page.evaluate(
        () =>
          getComputedStyle(document.querySelector(".end-star"))
            .animationName === "none",
      ),
      "OS reduced motion overrides enabled animation",
    );
    await page.getByRole("button", { name: "Host", exact: true }).click();
    await page.screenshot({
      path: path.join(os.tmpdir(), `enderlink-host-${engine}.png`),
    });
    // Exercise the new account selector in the smallest supported window.
    // This only updates the explicit IPC fixture, never a real hosted world.
    await page.evaluate(() => {
      window.testSnapshot.session = null;
    });
    await page.setViewportSize({ width: 720, height: 560 });
    await page.getByRole("button", { name: "Open world →" }).click();
    await page.getByRole("button", { name: "World settings" }).click();
    await page
      .getByRole("button", { name: "Change player account mode" })
      .click();
    const mode = page.getByRole("combobox", { name: "Player accounts" });
    await page.waitForFunction(() => {
      const select = document.querySelector(
        '[role="dialog"] [role="combobox"]',
      );
      return select && !select.disabled;
    });
    const modeBoxBefore = await page.getByRole("dialog").boundingBox();
    const helpBefore = await page.locator(".account-mode-help").boundingBox();
    await checkDialogSelect(page, engine);
    await choose("Player accounts", "offline");
    const modeBoxAfter = await page.getByRole("dialog").boundingBox();
    const helpAfter = await page.locator(".account-mode-help").boundingBox();
    assert(
      modeBoxAfter.y >= 0 && modeBoxAfter.y + modeBoxAfter.height <= 561,
      "account-mode dialog fits the window",
    );
    assert.equal(
      modeBoxAfter.height,
      modeBoxBefore.height,
      "account-mode selection does not resize the dialog",
    );
    assert.equal(
      helpAfter.height,
      helpBefore.height,
      "account-mode warning reserves its space",
    );
    await page
      .getByRole("button", { name: "Back up & use offline accounts" })
      .waitFor();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page
      .getByRole("button", { name: "Clear all data…", exact: true })
      .click();
    await page
      .getByRole("textbox", { name: "Confirmation phrase" })
      .fill("CLEAR ENDERLINK DATA");
    await page
      .getByRole("button", { name: "Clear all data", exact: true })
      .click();
    await page.getByRole("button", { name: "Clearing data…" }).waitFor();
    await page.keyboard.press("Escape");
    assert.equal(
      await page.getByRole("dialog").count(),
      1,
      "destructive work cannot be dismissed mid-operation",
    );
    assert(
      await page
        .getByRole("button", { name: "Cancel", exact: true })
        .isDisabled(),
    );
    await page.evaluate(() => window.rejectResetFixture());
    await page.getByText("Fixture: no real data was cleared").waitFor();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page
      .getByRole("button", { name: "Uninstall Enderlink…", exact: true })
      .click();
    await page.getByRole("radio", { name: /Save to a folder/ }).waitFor();
    assert(
      await page.getByRole("radio", { name: /Save to a folder/ }).isChecked(),
    );
    await page
      .getByRole("button", { name: "Choose folder", exact: true })
      .click();
    await page
      .getByRole("textbox", { name: "Confirmation phrase" })
      .fill("UNINSTALL ENDERLINK");
    assert(
      await page
        .getByRole("button", { name: "Save & uninstall", exact: true })
        .isEnabled(),
    );
    const uninstallBox = await page.getByRole("dialog").boundingBox();
    assert(
      uninstallBox.y >= 0 && uninstallBox.y + uninstallBox.height <= 561,
      "uninstall dialog fits minimum window",
    );
    await page.screenshot({
      path: path.join(os.tmpdir(), `enderlink-uninstall-${engine}.png`),
    });
    await page.getByRole("radio", { name: /Delete everything/ }).check();
    assert.equal(
      await page
        .getByRole("textbox", { name: "Confirmation phrase" })
        .inputValue(),
      "",
      "changing preservation choice requires confirming again",
    );
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.evaluate(() => {
      window.testSnapshot.worlds = [];
      window.testSnapshot.backups = [];
    });
    await page.waitForTimeout(2200);
    await page
      .getByRole("button", { name: "Uninstall Enderlink…", exact: true })
      .click();
    await page.getByRole("textbox", { name: "Confirmation phrase" }).waitFor();
    assert.equal(
      await page.getByRole("radio").count(),
      0,
      "empty library skips preservation question",
    );
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    assert.deepEqual(errors, [], "no runtime JavaScript errors");
    console.log(
      `PASS (${engine}): shared dropdowns with keyboard/typeahead, long catalogs, dialog focus, contrast and viewport checks; visible randomized star motion and independent controls; transparent header; no navigation shift with classic scrollbars; responsive layouts; stable errors; safe cleanup; setup and updates; full-width daily history, zoomable backup time axis and restore review; timed stacked notifications; dashboard memory; selected world block; lightweight/OS reduced motion; guarded clear/uninstall dialogs with optional saved library. Test-only IPC fixture, not a network acceptance test.`,
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
