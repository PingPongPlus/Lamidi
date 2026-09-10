// Run against a local static server; Playwright is a development-only prerequisite.
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const assert = require("node:assert/strict");
(async () => {
  const browser = await chromium.launch({
    channel: process.env.BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 1000 },
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    let connection,
      connections = 0;
    const sent = [];
    await page.routeWebSocket("wss://piano.laby.net/piano", (ws) => {
      connections++;
      connection = ws;
      ws.onMessage((message) => sent.push(JSON.parse(message)));
    });
    await page.goto(process.env.TEST_URL || "http://127.0.0.1:4173");
    await page.waitForFunction(() => typeof Midi === "function");
    assert.equal(await page.locator("#send").isDisabled(), true);
    await page.keyboard.press("Tab");
    assert.equal(
      await page
        .locator(".brand")
        .evaluate((el) => el === document.activeElement),
      true,
    );
    await page.keyboard.press("Tab");
    assert.equal(
      await page
        .locator("#midiFile")
        .evaluate((el) => el === document.activeElement),
      true,
    );
    const bytes = await page.evaluate(() => {
      const midi = new Midi();
      midi
        .addTrack()
        .addNote({ midi: 60, time: 0, duration: 0.12, velocity: 0.8 })
        .addNote({ midi: 64, time: 0.2, duration: 0.12, velocity: 1 });
      midi
        .addTrack()
        .addNote({ midi: 67, time: 0.2, duration: 0.12, velocity: 0.5 });
      return Array.from(midi.toArray());
    });
    await page
      .locator("#midiFile")
      .setInputFiles({
        name: "test.mid",
        mimeType: "audio/midi",
        buffer: Buffer.from(bytes),
      });
    await page.waitForFunction(
      () => document.querySelector("#fileState").textContent === "Ready",
    );
    assert.equal(await page.locator("#noteCount").innerText(), "3");
    assert.equal(await page.locator("#trackCount").innerText(), "2");
    await page.locator("#connect").click();
    await page.waitForFunction(
      () =>
        document.querySelector("#connectionLabel").textContent === "Connected",
    );
    await page.locator("#connect").evaluate((el) => el.click());
    assert.equal(connections, 1);
    await page.locator("#send").click();
    await page.waitForFunction(() =>
      document.querySelector("#status").textContent.startsWith("Completed"),
    );
    assert.deepEqual(
      sent.map((n) => n.note),
      [60, 64, 67],
    );
    assert.deepEqual(Object.keys(sent[0]).sort(), [
      "duration",
      "note",
      "type",
      "velocity",
    ]);
    assert.equal(sent[0].velocity, 101);
    assert.equal(await page.locator("#progress").getAttribute("value"), "1");
    await page.locator("#send").click();
    await page.locator("#stop").click();
    const count = sent.length;
    await page.waitForTimeout(450);
    assert.equal(sent.length, count);
    await page
      .locator("#midiFile")
      .setInputFiles({
        name: "bad.mid",
        mimeType: "audio/midi",
        buffer: Buffer.from("not midi"),
      });
    await page.waitForFunction(() =>
      document
        .querySelector("#status")
        .textContent.includes("could not be read"),
    );
    assert.equal(await page.locator("#fileName").innerText(), "test.mid");
    await page
      .locator("#midiFile")
      .setInputFiles({
        name: "bad.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("bad"),
      });
    assert.match(await page.locator("#status").innerText(), /Choose a .mid/);
    await page.evaluate((bytes) => {
      const dt = new DataTransfer();
      dt.items.add(
        new File([new Uint8Array(bytes)], "dropped.midi", {
          type: "audio/midi",
        }),
      );
      document
        .querySelector("#dropzone")
        .dispatchEvent(
          new DragEvent("drop", { bubbles: true, dataTransfer: dt }),
        );
    }, bytes);
    await page.waitForFunction(
      () => document.querySelector("#fileName").textContent === "dropped.midi",
    );
    connection.close();
    await page.waitForFunction(
      () =>
        document.querySelector("#connectionLabel").textContent ===
        "Disconnected",
    );
    assert.equal(await page.locator("#send").isDisabled(), true);
    await page.locator("#connect").click();
    await page.waitForFunction(
      () =>
        document.querySelector("#connectionLabel").textContent === "Connected",
    );
    assert.equal(connections, 2);
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
        "overflow at " + width,
      );
    }
    await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
    assert.equal(
      await page
        .locator("#send")
        .evaluate((el) => getComputedStyle(el).transitionDuration),
      "0s",
    );
    await page.route("https://bitmidi.com/api/**", (route) =>
      route.fulfill({
        json: { result: { results: [], total: 0, pageTotal: 0 } },
      }),
    );
    await page.locator("#searchQuery").fill("no results");
    await page.locator("#searchButton").click();
    await page.waitForFunction(() =>
      document
        .querySelector("#libraryStatus")
        .textContent.startsWith("No MIDIs"),
    );
    await page.unroute("https://bitmidi.com/api/**");
    await page.route("https://bitmidi.com/api/**", (route) => route.abort());
    await page.locator("#searchButton").click();
    await page.waitForFunction(() =>
      document
        .querySelector("#libraryStatus")
        .textContent.includes("could not be reached"),
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS: parsing, upload, drag/drop, invalid file retention, keyboard, socket lifecycle, playback, cancellation, responsive, dark/reduced motion, library empty/error states; no page errors.",
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
