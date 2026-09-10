// Timing stays in the worker. The main thread owns the WebSocket, as before.
let timeoutIds = [];
let generation = 0;

function stop() {
  generation++;
  timeoutIds.forEach(clearTimeout);
  timeoutIds = [];
}

self.onmessage = ({ data: { type, data, runId } }) => {
  if (type === "stop") {
    stop();
    return;
  }
  if (type !== "start") return;
  stop();
  const current = generation;
  const startTime = performance.now();
  let endTime = 0;
  // Preserve stable event order, seconds-based onset/duration, and velocity mapping.
  data.forEach((event) => {
    endTime = Math.max(endTime, event.time + event.duration);
    timeoutIds.push(
      setTimeout(
        () => {
          if (generation !== current) return;
          self.postMessage({
            type: "sendNote",
            runId,
            payload: {
              type: "note",
              note: event.midi,
              velocity: Math.floor(event.velocity * 127),
              duration: event.duration,
            },
          });
        },
        Math.max(0, event.time * 1000 - (performance.now() - startTime)),
      ),
    );
  });
  timeoutIds.push(
    setTimeout(
      () => {
        if (generation !== current) return;
        timeoutIds = [];
        self.postMessage({ type: "complete", runId });
      },
      Math.max(0, endTime * 1000 - (performance.now() - startTime)),
    ),
  );
};
