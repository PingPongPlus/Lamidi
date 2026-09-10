const { test } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
function workerHarness() {
  let now = 0,
    nextId = 0;
  const timers = new Map(),
    messages = [];
  const context = vm.createContext({
    self: { postMessage: (m) => messages.push({ ...m, at: now }) },
    performance: { now: () => now },
    setTimeout: (fn, delay) => {
      timers.set(++nextId, { fn, time: now + delay });
      return nextId;
    },
    clearTimeout: (id) => timers.delete(id),
  });
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, "../midi-worker.js"), "utf8"),
    context,
  );
  return {
    messages,
    send: (data) => context.self.onmessage({ data }),
    advance: (to) => {
      while (true) {
        const next = [...timers].sort((a, b) => a[1].time - b[1].time)[0];
        if (!next || next[1].time > to) break;
        now = next[1].time;
        timers.delete(next[0]);
        next[1].fn();
      }
      now = to;
    },
  };
}
const note = (time, midi, duration = 0.2) => ({
  time,
  midi,
  duration,
  velocity: 0.8,
});
test("preserves simultaneous ordering, onset, duration and velocity; completes after last note ends", () => {
  const w = workerHarness();
  w.send({
    type: "start",
    runId: 7,
    data: [note(0, 60, 0.8), note(0.1, 64), note(0.1, 67)],
  });
  w.advance(99);
  assert.equal(w.messages.length, 1);
  w.advance(100);
  assert.deepEqual(
    w.messages.map((m) => [
      m.payload.note,
      m.at,
      m.payload.velocity,
      m.payload.duration,
    ]),
    [
      [60, 0, 101, 0.8],
      [64, 100, 101, 0.2],
      [67, 100, 101, 0.2],
    ],
  );
  w.advance(799);
  assert.equal(w.messages.length, 3);
  w.advance(800);
  assert.equal(w.messages[3].type, "complete");
  assert.equal(w.messages[3].runId, 7);
});
test("stop cancels future notes and completion", () => {
  const w = workerHarness();
  w.send({ type: "start", runId: 1, data: [note(0, 60), note(1, 62)] });
  w.advance(1);
  w.send({ type: "stop" });
  w.advance(2000);
  assert.equal(w.messages.length, 1);
});
test("restart clears the old schedule and tags the new run", () => {
  const w = workerHarness();
  w.send({ type: "start", runId: 1, data: [note(1, 60)] });
  w.send({ type: "start", runId: 2, data: [note(0.1, 62)] });
  w.advance(2000);
  assert.deepEqual(
    w.messages.map((m) => m.runId),
    [2, 2],
  );
  assert.equal(w.messages[0].payload.note, 62);
});
test("empty sequence completes without notes", () => {
  const w = workerHarness();
  w.send({ type: "start", runId: 3, data: [] });
  w.advance(0);
  assert.equal(w.messages.length, 1);
  assert.equal(w.messages[0].type, "complete");
});
