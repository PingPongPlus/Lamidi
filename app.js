(() => {
  "use strict";
  const WS_URL = "wss://piano.laby.net/piano";
  const $ = (id) => document.getElementById(id);
  const state = {
    socket: null,
    worker: null,
    connection: "disconnected",
    midi: null,
    events: [],
    loading: false,
    playing: false,
    runId: 0,
    loadId: 0,
    startedAt: 0,
    frame: 0,
  };
  let remoteLoading = false;
  const formatTime = (seconds) => {
    const s = Math.max(0, Math.floor(seconds));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  };
  const announce = (message, tone = "") => {
    $("status").textContent = message;
    $("status").dataset.tone = tone;
  };
  function render() {
    const connected = state.connection === "connected";
    const labels = {
      disconnected: "Disconnected",
      connecting: "Connecting…",
      connected: "Connected",
      error: "Connection error",
    };
    $("connectionBadge").dataset.state = state.connection;
    $("connectionLabel").textContent = labels[state.connection];
    $("connect").textContent = connected
      ? "Connected"
      : state.connection === "connecting"
        ? "Connecting…"
        : state.connection === "error"
          ? "Try again"
          : "Connect";
    $("connect").disabled = connected || state.connection === "connecting";
    $("connectionHelp").textContent = connected
      ? "Connected to the piano. Ready to receive notes."
      : "Connect before sending your MIDI file.";
    document.querySelectorAll(".library-load").forEach((button) => {
      button.disabled = state.playing || state.loading || remoteLoading;
    });
    $("send").disabled =
      !connected ||
      !state.events.length ||
      state.loading ||
      remoteLoading ||
      state.playing;
    $("sendLabel").textContent = state.playing ? "Playing…" : "Send MIDI";
    $("stop").hidden = !state.playing;
    $("chooseFile").disabled = state.playing || state.loading || remoteLoading;
    $("midiFile").disabled = state.playing || state.loading || remoteLoading;
    $("dropzone").classList.toggle("is-locked", state.playing);
    $("dropzone").classList.toggle("is-busy", state.loading || remoteLoading);
    $("dropzone").setAttribute(
      "aria-busy",
      String(state.loading || remoteLoading),
    );
    $("fileState").textContent = remoteLoading
      ? "Downloading…"
      : state.loading
        ? "Reading MIDI…"
        : state.midi
          ? state.events.length
            ? "Ready"
            : "No notes"
          : "No file selected";
    $("actionHint").textContent = state.playing
      ? "Stop cancels upcoming notes."
      : remoteLoading
        ? "Downloading from BitMidi…"
        : state.loading
          ? "Reading your file…"
          : !state.midi
            ? "Choose a MIDI file to begin."
            : !state.events.length
              ? "This file contains no notes."
              : !connected
                ? "Connect to send your MIDI."
                : "Ready when you are.";
  }
  function resetProgress() {
    $("progress").value = 0;
    $("elapsed").textContent = "0:00";
  }
  function endPlayback(message, tone = "", completed = false) {
    state.playing = false;
    cancelAnimationFrame(state.frame);
    if (completed) {
      $("progress").value = 1;
      $("elapsed").textContent = formatTime(state.midi.duration);
    }
    render();
    announce(message, tone);
  }
  function stopPlayback(message = "Stopped. Upcoming notes were cancelled.") {
    if (!state.playing) return;
    state.worker?.postMessage({ type: "stop" });
    state.runId++;
    endPlayback(message);
  }
  function ensureWorker() {
    if (state.worker) return true;
    try {
      const worker = new Worker("midi-worker.js");
      state.worker = worker;
      worker.onmessage = ({ data }) => {
        if (data.runId !== state.runId || !state.playing) return;
        if (data.type === "sendNote") {
          if (state.socket?.readyState !== WebSocket.OPEN) {
            stopPlayback("Connection lost. Reconnect to play again.");
            return;
          }
          try {
            state.socket.send(JSON.stringify(data.payload));
          } catch {
            stopPlayback("Could not send notes. Reconnect and try again.");
          }
        } else if (data.type === "complete")
          endPlayback("Completed. Your MIDI has been sent.", "success", true);
      };
      worker.onerror = (event) => {
        event.preventDefault();
        worker.terminate();
        state.worker = null;
        state.runId++;
        state.playing = false;
        cancelAnimationFrame(state.frame);
        render();
        announce(
          "Playback could not start. Reload the page and try again.",
          "error",
        );
      };
      return true;
    } catch {
      announce(
        "Playback is unavailable. Serve this page over HTTP or HTTPS and try again.",
        "error",
      );
      return false;
    }
  }
  function connect() {
    if (
      state.socket &&
      [WebSocket.OPEN, WebSocket.CONNECTING].includes(state.socket.readyState)
    )
      return;
    state.connection = "connecting";
    render();
    announce("Connecting to Laby.net…");
    let socket;
    try {
      socket = new WebSocket(WS_URL);
      state.socket = socket;
    } catch {
      state.connection = "error";
      render();
      announce("Could not connect. Check your network and try again.", "error");
      return;
    }
    const timeout = setTimeout(() => {
      if (
        socket === state.socket &&
        socket.readyState === WebSocket.CONNECTING
      ) {
        state.connection = "error";
        socket.close();
        render();
        announce(
          "Connection timed out. Check your network and try again.",
          "error",
        );
      }
    }, 15000);
    socket.onopen = () => {
      clearTimeout(timeout);
      if (socket !== state.socket) return;
      state.connection = "connected";
      render();
      announce(
        state.events.length
          ? "Connected. Ready to send your MIDI."
          : "Connected. Choose a MIDI file to begin.",
        "success",
      );
    };
    socket.onerror = () => {
      clearTimeout(timeout);
      if (socket !== state.socket) return;
      stopPlayback();
      state.connection = "error";
      render();
      announce(
        "Connection failed. Check your network, then try again.",
        "error",
      );
    };
    socket.onclose = () => {
      clearTimeout(timeout);
      if (socket !== state.socket) return;
      const wasPlaying = state.playing;
      stopPlayback();
      if (state.connection !== "error") {
        state.connection = "disconnected";
        announce(
          wasPlaying
            ? "Connection lost. Reconnect to restart your MIDI."
            : "Disconnected. You can connect again.",
        );
      }
      render();
    };
  }
  async function loadFile(file) {
    if (!file || state.playing || state.loading || remoteLoading) return;
    $("dropzone").classList.remove("is-error");
    const fail = (message) => {
      $("dropzone").classList.add("is-error");
      announce(message, "error");
    };
    if (!/\.(mid|midi)$/i.test(file.name)) {
      fail(
        "Choose a .mid or .midi file. Your current selection has been kept.",
      );
      return;
    }
    const loadId = ++state.loadId;
    state.loading = true;
    render();
    announce("Reading MIDI file…");
    try {
      if (typeof Midi !== "function") throw new Error("parser");
      const buffer = await file.arrayBuffer();
      if (loadId !== state.loadId) return;
      if (new TextDecoder().decode(buffer.slice(0, 4)) !== "MThd")
        throw new Error("invalid");
      const midi = new Midi(buffer);
      const events = midi.tracks.flatMap((track) =>
        track.notes.map((note) => ({
          time: note.time,
          duration: note.duration,
          midi: note.midi,
          velocity: note.velocity,
        })),
      );
      if (
        !events.every(
          (n) =>
            [n.time, n.duration, n.midi, n.velocity].every(Number.isFinite) &&
            n.time >= 0 &&
            n.duration >= 0,
        )
      )
        throw new Error("invalid");
      events.sort((a, b) => a.time - b.time);
      state.midi = midi;
      state.events = events;
      $("emptyFile").hidden = true;
      $("selectedFile").hidden = false;
      $("summary").hidden = false;
      $("fileName").textContent = file.name;
      $("fileDetails").textContent =
        `${file.size < 1024 ? `${file.size} bytes` : `${(file.size / 1024).toFixed(1)} KB`} · MIDI sequence`;
      $("chooseFile").textContent = "Replace file";
      $("trackCount").textContent = midi.tracks.length.toLocaleString();
      $("noteCount").textContent = events.length.toLocaleString();
      $("duration").textContent = formatTime(midi.duration);
      $("totalTime").textContent = formatTime(midi.duration);
      const tempos = midi.header.tempos;
      $("tempo").textContent =
        tempos.length === 0
          ? "120 BPM"
          : new Set(tempos.map((t) => t.bpm)).size > 1
            ? "Variable"
            : `${Math.round(tempos[0].bpm)} BPM`;
      $("tempo").title =
        tempos.length === 0
          ? "Standard MIDI default tempo; no tempo event in this file."
          : "Tempo from the MIDI file";
      resetProgress();
      drawNotes();
      announce(
        events.length
          ? state.connection === "connected"
            ? "MIDI loaded. Ready to send."
            : "MIDI loaded. Connect to the piano to send it."
          : "This MIDI contains no notes. Choose another file.",
        events.length ? "success" : "",
      );
    } catch (error) {
      fail(
        error.message === "parser"
          ? "The MIDI reader could not load. Check your internet connection and reload the page."
          : "This file could not be read as MIDI. Try a different .mid or .midi file.",
      );
    } finally {
      state.loading = false;
      $("midiFile").value = "";
      render();
    }
  }
  function drawNotes() {
    if (!state.midi) return;
    const canvas = $("notePreview");
    const width = canvas.clientWidth;
    const height = 76;
    const scale = window.devicePixelRatio || 1;
    canvas.width = width * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext("2d");
    ctx.scale(scale, scale);
    const style = getComputedStyle(document.documentElement);
    ctx.strokeStyle = style.getPropertyValue("--border");
    ctx.lineWidth = 0.5;
    for (let x = 0; x <= width; x += width / 8 || 1) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    if (!state.events.length) return;
    let low = 127,
      high = 0;
    for (const n of state.events) {
      low = Math.min(low, n.midi);
      high = Math.max(high, n.midi);
    }
    ctx.fillStyle = style.getPropertyValue("--accent");
    const duration = state.midi.duration || 1;
    for (const n of state.events) {
      ctx.globalAlpha = 0.35 + n.velocity * 0.65;
      ctx.fillRect(
        (n.time / duration) * width,
        6 + ((high - n.midi) / Math.max(1, high - low)) * 60,
        Math.max(2, (n.duration / duration) * width),
        3,
      );
    }
  }
  function tick() {
    if (!state.playing) return;
    const elapsed = Math.min(
      (performance.now() - state.startedAt) / 1000,
      state.midi.duration,
    );
    $("progress").value = elapsed / (state.midi.duration || 1);
    $("elapsed").textContent = formatTime(elapsed);
    state.frame = requestAnimationFrame(tick);
  }
  // BitMidi permits cross-origin search and file downloads. Keep files in browser memory.
  let searchController;
  let searchQuery = "";
  let searchPage = 0;
  let pageTotal = 0;
  async function searchLibrary(query, page = 0) {
    searchController?.abort();
    const controller = new AbortController();
    searchController = controller;
    const timer = setTimeout(() => controller.abort(), 15000);
    $("libraryStatus").textContent = "Searching BitMidi…";
    $("libraryResults").replaceChildren();
    $("libraryPagination").hidden = true;
    $("libraryResults").setAttribute("aria-busy", "true");
    try {
      const params = new URLSearchParams({
        q: query,
        page: String(page),
        pageSize: "6",
      });
      const response = await fetch(
        "https://bitmidi.com/api/midi/search?" + params,
        { signal: controller.signal, credentials: "omit" },
      );
      if (!response.ok) throw new Error("search");
      const { result } = await response.json();
      if (!result || !Array.isArray(result.results)) throw new Error("search");
      if (searchController !== controller) return;
      searchQuery = query;
      searchPage = page;
      pageTotal = Number(result.pageTotal) || 0;
      for (const item of result.results) {
        // Accept only BitMidi upload paths; never trust arbitrary API-provided URLs or markup.
        if (
          typeof item.name !== "string" ||
          !/^\/uploads\/\d+\.mid$/i.test(item.downloadUrl)
        )
          continue;
        const row = document.createElement("li");
        const title = document.createElement("span");
        title.textContent = item.name;
        title.title = item.name;
        const button = document.createElement("button");
        button.type = "button";
        button.className = "button library-load";
        button.textContent = "Load MIDI";
        button.setAttribute("aria-label", "Load " + item.name);
        button.addEventListener("click", () => loadRemote(item, button));
        row.append(title, button);
        $("libraryResults").append(row);
      }
      $("libraryStatus").textContent = result.results.length
        ? Number(result.total).toLocaleString() +
          " results on BitMidi. Choose a file to load."
        : "No MIDIs found. Try a different song or artist.";
      $("libraryPagination").hidden = pageTotal <= 1;
      $("previousPage").disabled = page === 0;
      $("nextPage").disabled = page + 1 >= pageTotal;
      $("libraryPage").textContent = "Page " + (page + 1) + " of " + pageTotal;
      render();
    } catch {
      if (searchController === controller)
        $("libraryStatus").textContent =
          "BitMidi could not be reached. Try Search again, or choose a local MIDI file.";
    } finally {
      clearTimeout(timer);
      if (searchController === controller)
        $("libraryResults").setAttribute("aria-busy", "false");
    }
  }
  async function loadRemote(item, button) {
    if (state.playing || state.loading || remoteLoading) return;
    remoteLoading = true;
    button.textContent = "Loading…";
    render();
    announce("Downloading MIDI from BitMidi…");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch("https://bitmidi.com" + item.downloadUrl, {
        signal: controller.signal,
        credentials: "omit",
      });
      if (!response.ok) throw new Error("download");
      const blob = await response.blob();
      remoteLoading = false;
      const name = /\.(mid|midi)$/i.test(item.name)
        ? item.name
        : item.name + ".mid";
      await loadFile(new File([blob], name, { type: "audio/midi" }));
    } catch {
      announce(
        "This MIDI could not be downloaded. Try again or choose another file.",
        "error",
      );
    } finally {
      clearTimeout(timeout);
      remoteLoading = false;
      button.textContent = "Load MIDI";
      render();
    }
  }
  $("librarySearch").addEventListener("submit", (event) => {
    event.preventDefault();
    const query = $("searchQuery").value.trim();
    if (query) searchLibrary(query);
  });
  $("previousPage").addEventListener("click", () => {
    if (searchPage > 0) searchLibrary(searchQuery, searchPage - 1);
  });
  $("nextPage").addEventListener("click", () => {
    if (searchPage + 1 < pageTotal) searchLibrary(searchQuery, searchPage + 1);
  });
  $("send").addEventListener("click", () => {
    if (
      state.playing ||
      state.loading ||
      !state.events.length ||
      state.socket?.readyState !== WebSocket.OPEN ||
      !ensureWorker()
    )
      return;
    state.playing = true;
    state.runId++;
    state.startedAt = performance.now();
    resetProgress();
    state.worker.postMessage({
      type: "start",
      data: state.events,
      runId: state.runId,
    });
    render();
    announce("Playing. Notes are being sent to the piano.");
    tick();
  });
  $("stop").addEventListener("click", () => {
    stopPlayback();
    $("send").focus();
  });
  $("connect").addEventListener("click", connect);
  $("chooseFile").addEventListener("click", () => $("midiFile").click());
  $("dropzone").addEventListener("click", (e) => {
    if (!e.target.closest("button, input") && !state.playing && !state.loading)
      $("midiFile").click();
  });
  $("midiFile").addEventListener("change", (e) => loadFile(e.target.files[0]));
  let dragDepth = 0;
  document.addEventListener("dragenter", (e) => {
    if ([...e.dataTransfer.types].includes("Files")) {
      e.preventDefault();
      dragDepth++;
      document.body.classList.add("is-dragging");
    }
  });
  document.addEventListener("dragover", (e) => {
    if ([...e.dataTransfer.types].includes("Files")) {
      e.preventDefault();
      e.dataTransfer.dropEffect =
        state.playing || state.loading || remoteLoading ? "none" : "copy";
    }
  });
  document.addEventListener("dragleave", () => {
    if (--dragDepth <= 0) {
      dragDepth = 0;
      document.body.classList.remove("is-dragging");
    }
  });
  document.addEventListener("drop", (e) => {
    e.preventDefault();
    dragDepth = 0;
    document.body.classList.remove("is-dragging");
    if (state.playing || state.loading || remoteLoading) return;
    if (e.dataTransfer.files.length !== 1) {
      announce("Drop one MIDI file at a time.", "error");
      return;
    }
    loadFile(e.dataTransfer.files[0]);
  });
  new ResizeObserver(drawNotes).observe($("notePreview"));
  matchMedia("(prefers-color-scheme: dark)").addEventListener(
    "change",
    drawNotes,
  );
  window.addEventListener("pagehide", () => {
    state.worker?.terminate();
    state.socket?.close();
  });
  render();
})();
