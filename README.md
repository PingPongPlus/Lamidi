# Lamidi

A lightweight MIDI WebSocket controller for the Laby.net Minecraft piano.

Live site: https://pingminus.github.io/Lamidi/

## Use

1. Choose or drop a `.mid` / `.midi` file, or search the BitMidi library and select **Load MIDI**.
2. Select **Connect** to connect to `wss://piano.laby.net/piano`.
3. Select **Send MIDI**. The progress bar follows the sequence timeline; completion includes the final note duration.
4. **Stop** cancels upcoming notes. Notes already delivered to the piano continue for their sent duration: the existing protocol has no note-cancellation command.

Files are parsed locally with the existing pinned `@tonejs/midi@2.0.28` CDN dependency. The UI shows actual tracks, notes, duration, tempo, and a note overview. A tempo-changing file is labeled Variable; files without a tempo event use the standard MIDI default of 120 BPM.

The interface follows the system light/dark appearance and reduced-motion preference. Keyboard access, inline announcements, drag-and-drop, reconnect, loading, and error states are supported. Invalid replacement files retain the last valid MIDI.

## BitMidi library

Search calls `https://bitmidi.com/api/midi/search` directly from the visitor's browser. Selecting a result fetches its `/uploads/<id>.mid` file from BitMidi into browser memory and passes it to the same parser as local files. MIDI files are **not stored in this repository**, and no proxy, server storage, API key, or manual file download is required. Search and load are user initiated; loading does not transmit notes until **Send MIDI** is selected.

BitMidi currently enables CORS on its search and upload routes. This is an external service, not a guaranteed versioned API; if it is unavailable, changes its API, or withdraws CORS support, Lamidi shows a recoverable error and local files still work. Search queries and selected-file requests go to BitMidi. Only allowlisted BitMidi upload paths are accepted from search results; result names are rendered as text.

Sources: [BitMidi API routes](https://github.com/feross/bitmidi.com/blob/master/src/server/router-api.js), [file hosting](https://github.com/feross/bitmidi.com/blob/master/src/server/app.js).

## Run locally / deploy

Serve this directory over HTTP using any static server (for example `python -m http.server 4173`), then open `http://localhost:4173`. No application build or package installation is needed. Opening a `file://` URL will not reliably support workers. Deploy the root files together on GitHub Pages or another static host.

- `index.html`: semantic interface and pinned parser script
- `styles.css`: responsive design, light/dark tokens, focus and motion rules
- `app.js`: file and library loading, rendering, WebSocket lifecycle and playback controls
- `midi-worker.js`: scheduling, cancellation and completion
- `favicon.svg`: original application icon

The worker retains onset and duration in seconds, stable track/note order for simultaneous events, and `Math.floor(velocity * 127)`. The main thread sends the unchanged JSON payload `{ type: "note", note, velocity, duration }` only while the socket is open. Run identifiers reject stale messages after Stop/restart. Timers share a worker start timestamp so scheduling setup does not accumulate drift. Browser/OS scheduling and network latency still affect delivery; neither a worker nor the progress bar guarantees remote audible timing or acknowledgement.

## Validation

Dependency-free worker tests:

```sh
node --test tests/worker.test.cjs
node --check app.js
node --check midi-worker.js
```

The optional browser regression suite requires Playwright available in your development environment and the local server running. It does not add a production dependency:

```sh
node tests/browser.cjs
```

Use `PLAYWRIGHT_PATH` for a custom Playwright module path, `BROWSER_CHANNEL` for a browser channel (default `msedge`), and `TEST_URL` for another local URL. The suite uses a mocked WebSocket to verify ordered transmission, stop, reconnect, and disabled states without playing test notes on the public piano. It also covers local parsing, drag/drop, invalid input, keyboard focus, responsive widths, dark/reduced-motion settings, and library error/empty states.

Real BitMidi search/download and a real WebSocket handshake should additionally be checked when releasing. Audibility on the Minecraft piano requires an in-game listening check; a successful WebSocket send is not a server acknowledgement.
