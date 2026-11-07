const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1144, height: 1000 },
    reducedMotion: "reduce",
  });
  const errors = [],
    results = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const url = pathToFileURL(
    require("node:path").join(__dirname, "enderlink.html"),
  ).href;
  const act = (a, extra = "") =>
    page.locator(`[data-action="${a}"]${extra}`).first();
  const ready = () => page.waitForFunction(() => !busy, {}, { timeout: 8000 });
  const fresh = () => page.goto(url);
  async function check(label, fn) {
    await fresh();
    await fn();
    results.push(label);
    console.log("PASS", label);
  }
  try {
    await check("Navigation and sample-only status", async () => {
      assert.match(await page.locator("h1").textContent(), /Mossy/);
      await act("nav", '[data-route="library"]').click();
      assert.equal(await page.locator(".world-card").count(), 3);
      await act("nav", '[data-route="join"]').click();
      assert.match(await page.locator("h1").textContent(), /adventure/);
      await act("nav", '[data-route="settings"]').click();
      assert.equal(await page.locator("h1").textContent(), "Settings");
    });
    await check(
      "Invalid address preserves input and button geometry",
      async () => {
        await act("nav", '[data-route="join"]').click();
        const before = await act("check-server").boundingBox();
        await page.locator("#join-address").fill("https://evil.invalid/path");
        await act("check-server").click();
        assert.match(
          await page.locator("#join-feedback").textContent(),
          /Enter a hostname/,
        );
        assert.deepEqual(await act("check-server").boundingBox(), before);
        await page
          .locator("#join-address")
          .fill("mossy-hollow.example.net:25565");
        await act("check-server").click();
        assert.match(
          await page.locator("#join-result").textContent(),
          /Sample online/,
        );
        await act("save-server").click();
        assert.equal(await page.evaluate(() => state.saved.length), 1);
      },
    );
    await check("Running worlds cannot be deleted", async () => {
      await act("world-menu").click();
      await act("delete-review").click();
      assert.equal(await page.locator("#delete-submit").isDisabled(), true);
      assert.equal(await page.locator("#delete-phrase").count(), 0);
      await act("delete-stop").click();
      await act("stop-confirm").click();
      await ready();
      assert.equal(await page.locator("#delete-phrase").count(), 1);
      assert.equal(await page.evaluate(() => world().running), false);
    });
    await check("Exact deletion phrase and backup retention", async () => {
      await page.evaluate(() => {
        world().running = false;
        deletionReview();
      });
      await page.locator("#delete-phrase").fill("DELETE Quiet Hours");
      assert.equal(await page.locator("#delete-submit").isDisabled(), true);
      await page.locator("#delete-phrase").fill("delete Mossy Hollow");
      assert.equal(await page.locator("#delete-submit").isDisabled(), true);
      await page.locator("#delete-phrase").fill("DELETE Mossy Hollow");
      assert.equal(await page.locator("#delete-submit").isDisabled(), false);
      await page.locator("#delete-submit").click();
      await ready();
      assert.equal(
        await page.evaluate(() => state.worlds.some((w) => w.id === "mossy")),
        false,
      );
      assert.equal(await page.evaluate(() => state.backups.length), 1);
      assert.match(
        await page.locator("#main").textContent(),
        /Backups from deleted worlds/,
      );
    });
    await check("Stale deletion review cannot commit", async () => {
      await page.evaluate(() => {
        world().running = false;
        deletionReview();
      });
      await page.locator("#delete-phrase").fill("DELETE Mossy Hollow");
      await page.evaluate(() => world().revision++);
      await page.locator("#delete-submit").click();
      assert.equal(await page.evaluate(() => state.worlds.length), 3);
      assert.match(
        await page.locator("#toast").textContent(),
        /review changed/,
      );
    });
    await check("Engine download leaves existing worlds pinned", async () => {
      await act("nav", '[data-route="settings"]').click();
      await act("install", '[data-engine="paper"]').click();
      await ready();
      assert.deepEqual(await page.evaluate(() => state.installed.paper), [
        "132",
        "133",
      ]);
      assert.equal(await page.evaluate(() => state.worlds[0].version), "132");
    });
    await check(
      "Uninstall blocks running consumers; stopped worlds survive",
      async () => {
        await act("nav", '[data-route="settings"]').click();
        await act("uninstall-review", '[data-engine="paper"]').click();
        assert.equal(await act("uninstall-confirm").isDisabled(), true);
        await act("close").click();
        await page.evaluate(() => (state.worlds[0].running = false));
        await act("uninstall-review", '[data-engine="paper"]').click();
        await act("uninstall-confirm").click();
        await ready();
        assert.equal(
          await page.evaluate(() => state.installed.paper.length),
          0,
        );
        assert.equal(await page.evaluate(() => state.worlds.length), 3);
        assert.equal(
          await page.evaluate(() => hasSoftware(state.worlds[0])),
          false,
        );
      },
    );
    await check(
      "World update snapshots old binding and preserves other worlds",
      async () => {
        await page.evaluate(() => {
          world().running = false;
          reviewUpdate();
        });
        await act("update-confirm").click();
        await ready();
        assert.equal(await page.evaluate(() => world().version), "133");
        assert.equal(
          await page.evaluate(
            () => state.worlds.find((w) => w.id === "quiet").version,
          ),
          "132",
        );
        assert.equal(
          await page.evaluate(() => state.backups.at(-1).version),
          "132",
        );
        assert.equal(await page.evaluate(() => world().running), false);
      },
    );
    await check("Backup restores as a distinct stopped world", async () => {
      await act("backups").click();
      await act("restore-review").click();
      await act("restore-confirm").click();
      await ready();
      assert.equal(await page.evaluate(() => state.worlds.length), 4);
      assert.equal(await page.evaluate(() => world().running), false);
      assert.match(await page.locator("h1").textContent(), /restored/);
    });
    await check("Player access add and revoke flow", async () => {
      await act("access").click();
      await page.locator("#player-name").fill("Friend_123");
      await act("add-player").click();
      assert.equal(
        await page.evaluate(() => state.allowed.mossy.includes("Friend_123")),
        true,
      );
      await act("revoke-review", '[data-player="Friend_123"]').click();
      await act("revoke-confirm").click();
      assert.equal(
        await page.evaluate(() => state.allowed.mossy.includes("Friend_123")),
        false,
      );
    });
    await check(
      "Create wizard and remembered resource preference",
      async () => {
        await act("nav", '[data-route="settings"]').click();
        await page.locator('[data-change="memory"]').selectOption("8");
        await act("nav", '[data-route="library"]').click();
        await act("create").click();
        await page.locator("#new-name").fill("Birch & Stone");
        await act("create-next").click();
        await page.locator("#new-engine").selectOption("fabric");
        await act("create-next").click();
        assert.equal(await page.locator("#new-memory").inputValue(), "8");
        await act("create-next").click();
        await act("create-confirm").click();
        assert.match(
          await page.locator("#create-feedback").textContent(),
          /acknowledge/,
        );
        await page.locator("#eula-demo").check();
        await act("create-confirm").click();
        await ready();
        assert.equal(await page.locator("h1").textContent(), "Birch & Stone");
        assert.equal(await page.evaluate(() => world().engine), "fabric");
        assert.equal(await page.evaluate(() => world().memory), 8);
      },
    );
    await check(
      "Chart controls retain geometry and keyboard focus",
      async () => {
        const before = await page.locator(".chart-card").boundingBox();
        await act("chart", '[data-mode="cpu"]').click();
        assert.deepEqual(
          await page.locator(".chart-card").boundingBox(),
          before,
        );
        assert.equal(
          await page.evaluate(() => document.activeElement.dataset.mode),
          "cpu",
        );
      },
    );
    await check(
      "Responsive layouts and modal fit at 1144, 728, 390 pixels",
      async () => {
        for (const width of [1144, 728, 390]) {
          await page.setViewportSize({ width, height: 1000 });
          for (const r of ["dashboard", "library", "join", "settings"]) {
            await page.evaluate((r) => {
              route = r;
              render();
            }, r);
            assert.equal(
              await page.evaluate(
                () => document.documentElement.scrollWidth <= window.innerWidth,
              ),
              true,
              `${r} overflows at ${width}`,
            );
          }
          await page.evaluate(() => {
            route = "dashboard";
            render();
            world().running = false;
            deletionReview();
          });
          const box = await page.locator("#dialog").boundingBox();
          assert.ok(box.width <= width);
          await act("close").click();
        }
      },
    );
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify(
        { passed: results.length, pageErrors: errors, checks: results },
        null,
        2,
      ),
    );
  } finally {
    await page.close();
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
