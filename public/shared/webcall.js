/**
 * Browser call to the same Vapi assistant that answers the phone number.
 * Renders a call card (avatar, live transcript, timer) into #call-root and wires
 * every element with [data-call-start] as a "Talk to Maya" trigger.
 * The Vapi Web SDK is loaded on demand; only the PUBLIC key is used client-side.
 */
const HEADERS = { "ngrok-skip-browser-warning": "1" };
const root = document.getElementById("call-root");
const triggers = Array.from(document.querySelectorAll("[data-call-start]"));
const disabledNote = document.getElementById("call-disabled-note");

let vapi = null;
let config = null;
let active = false;
let timerId = null;
let startedAt = 0;

root.innerHTML = `
  <div class="call-overlay" id="call-overlay" hidden role="dialog" aria-modal="true" aria-labelledby="call-title">
    <div class="call-card">
      <div class="call-top">
        <div class="call-avatar" id="call-avatar" aria-hidden="true"></div>
        <div class="call-meta">
          <strong id="call-title">Maya · Patient intake</strong>
          <span class="muted" id="call-status">Connecting…</span>
        </div>
        <span class="wave idle" id="call-wave" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span>
        <span class="call-timer" id="call-timer">00:00</span>
      </div>
      <div class="call-body">
        <div class="call-transcript" id="call-transcript">
          <p class="call-empty">Say hello when Maya finishes speaking. Your conversation appears here.</p>
        </div>
        <div id="call-error" class="call-error" hidden></div>
        <div class="call-actions">
          <span class="call-hint">Uses your microphone. Same agent, prompt and backend as the phone line.</span>
          <button class="btn btn-danger btn-sm" id="call-hangup">Hang up</button>
        </div>
      </div>
    </div>
  </div>`;

const els = {
  overlay: root.querySelector("#call-overlay"),
  avatar: root.querySelector("#call-avatar"),
  status: root.querySelector("#call-status"),
  wave: root.querySelector("#call-wave"),
  timer: root.querySelector("#call-timer"),
  transcript: root.querySelector("#call-transcript"),
  error: root.querySelector("#call-error"),
  hangup: root.querySelector("#call-hangup"),
};

async function loadConfig() {
  try {
    const res = await fetch("/voice/vapi/web-config", { headers: HEADERS });
    config = (await res.json()).data;
  } catch {
    config = { enabled: false };
  }
  for (const t of triggers) {
    t.disabled = !config?.enabled;
    if (!config?.enabled) t.title = "Browser calls are not configured on this server";
  }
  if (disabledNote) disabledNote.hidden = Boolean(config?.enabled);
}

function setStatus(text, mode) {
  els.status.textContent = text;
  els.avatar.classList.toggle("speaking", mode === "speaking");
  els.avatar.classList.toggle("listening", mode === "listening");
  els.wave.classList.toggle("idle", mode !== "speaking");
}

function extractErrorMessage(e) {
  if (!e) return "The call could not be completed.";
  if (typeof e === "string") return e;
  const candidates = [
    e?.error?.message?.msg,
    e?.error?.message?.errorMsg,
    e?.error?.message?.message,
    typeof e?.error?.message === "string" ? e.error.message : null,
    e?.error?.msg,
    e?.error?.errorMsg,
    e?.error?.errorDetail,
    typeof e?.error === "string" ? e.error : null,
    e?.errorMsg,
    typeof e?.message === "string" ? e.message : null,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim() && c.trim() !== "[object Object]") {
      const msg = c.trim();
      if (/meeting has ended|ejected|did-not-receive-customer-audio/i.test(msg)) {
        return "No microphone audio reached Maya. Please check that your microphone is unmuted and allowed in your browser, then try again.";
      }
      return msg;
    }
  }
  return "The call ended unexpectedly. Please check your microphone and try again.";
}

function showError(msg) {
  els.error.textContent = typeof msg === "string" ? msg : extractErrorMessage(msg);
  els.error.hidden = false;
}

function tick() {
  const s = Math.floor((Date.now() - startedAt) / 1000);
  els.timer.textContent = `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function addLine(role, text, partial) {
  const empty = els.transcript.querySelector(".call-empty");
  if (empty) empty.remove();
  let last = els.transcript.lastElementChild;
  if (last && last.dataset.role === role && last.dataset.partial === "true") {
    last.querySelector(".text").textContent = text;
  } else {
    last = document.createElement("div");
    last.className = `bubble bubble-${role}`;
    last.dataset.role = role;
    last.innerHTML = `<span class="who">${role === "assistant" ? "Maya" : "You"}</span><span class="text"></span>`;
    last.querySelector(".text").textContent = text;
    els.transcript.appendChild(last);
  }
  last.dataset.partial = String(partial);
  els.transcript.scrollTop = els.transcript.scrollHeight;
}

function reset() {
  els.transcript.innerHTML = '<p class="call-empty">Say hello when Maya finishes speaking. Your conversation appears here.</p>';
  els.error.hidden = true;
  els.timer.textContent = "00:00";
}

async function ensureSdk() {
  if (vapi) return;
  const mod = await import("https://esm.sh/@vapi-ai/web@2");
  vapi = new mod.default(config.publicKey);
  vapi.on("call-start-progress", (ev) => {
    // Prevent Daily's Krisp noise-cancellation WASM on esm.sh from failing or muting the mic stream.
    if (ev?.stage === "daily-call-object-creation" && ev?.status === "completed" && vapi?.call) {
      const origUpdate = vapi.call.updateInputSettings?.bind(vapi.call);
      if (origUpdate) {
        vapi.call.updateInputSettings = (settings) => {
          if (settings?.audio?.processor?.type === "noise-cancellation") {
            return Promise.resolve();
          }
          return origUpdate(settings);
        };
      }
    }
  });
  vapi.on("call-start", () => {
    active = true;
    startedAt = Date.now();
    clearInterval(timerId);
    timerId = setInterval(tick, 1000);
    els.error.hidden = true;
    try { vapi.setMuted(false); } catch {}
    setStatus("Connected", "listening");
    els.hangup.textContent = "Hang up";
  });
  vapi.on("call-end", () => {
    active = false;
    clearInterval(timerId);
    setStatus("Call ended. Thanks for talking to Maya.", "idle");
    els.hangup.textContent = "Close";
    document.dispatchEvent(new CustomEvent("call:ended"));
  });
  vapi.on("speech-start", () => setStatus("Maya is speaking", "speaking"));
  vapi.on("speech-end", () => active && setStatus("Listening…", "listening"));
  vapi.on("message", (m) => {
    if (m?.type === "transcript" && m.transcript) {
      addLine(m.role === "assistant" ? "assistant" : "user", m.transcript, m.transcriptType === "partial");
    }
    if (m?.type === "tool-calls" || m?.type === "function-call") setStatus("Checking that for you…", "listening");
  });
  vapi.on("error", (e) => {
    console.warn("vapi event error", e);
    // Ignore non-fatal audio processor / level observer errors so the active call continues uninterrupted.
    const nonFatalTypes = ["audio-processing-setup-error", "local-audio-level-observer-error", "audio-observer-setup-error"];
    if (nonFatalTypes.includes(e?.type) || nonFatalTypes.includes(e?.stage)) {
      try { vapi.call?.setLocalAudio?.(true); } catch {}
      return;
    }
    const msg = extractErrorMessage(e);
    showError(/payment|billing|card/i.test(msg) ? `${msg} (Add a payment method in the Vapi dashboard.)` : msg);
    setStatus("Call ended", "idle");
    active = false;
    clearInterval(timerId);
    els.hangup.textContent = "Close";
  });
}

async function startCall() {
  if (!config?.enabled) return;
  reset();
  els.overlay.hidden = false;
  setStatus("Checking microphone…", "idle");
  try {
    // Request mic permission & wake up the audio input device BEFORE Vapi starts its 15-second audio timeout.
    if (navigator.mediaDevices?.getUserMedia) {
      const preStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      preStream.getTracks().forEach((t) => t.stop());
    }
    setStatus("Connecting…", "idle");
    await ensureSdk();
    await vapi.start(config.assistantId);
  } catch (err) {
    console.error(err);
    showError(extractErrorMessage(err));
    setStatus("Call failed", "idle");
    els.hangup.textContent = "Close";
  }
}

function endOrClose() {
  if (vapi && active) {
    vapi.stop();
  } else {
    els.overlay.hidden = true;
  }
}

for (const t of triggers) t.addEventListener("click", startCall);
els.hangup.addEventListener("click", endOrClose);
els.overlay.addEventListener("click", (e) => { if (e.target === els.overlay && !active) els.overlay.hidden = true; });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !active) els.overlay.hidden = true; });
loadConfig();
