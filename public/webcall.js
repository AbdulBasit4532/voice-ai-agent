/**
 * Browser call to the same Vapi assistant that answers the phone number.
 * Lets reviewers (or anyone without a U.S. phone) talk to the agent via WebRTC.
 * The Vapi Web SDK is loaded on demand from a CDN; nothing here is required for the API.
 */
const $ = (sel) => document.querySelector(sel);
const toggle = $("#call-toggle");
const panel = $("#call-panel");
const statusEl = $("#call-status");
const hintEl = $("#call-hint");
const hangup = $("#call-hangup");
const transcriptEl = $("#call-transcript");

let vapi = null;
let active = false;
let config = null;

async function loadConfig() {
  try {
    const res = await fetch("/voice/vapi/web-config", { headers: { "ngrok-skip-browser-warning": "1" } });
    const json = await res.json();
    config = json.data;
    if (config?.enabled) toggle.hidden = false;
  } catch {
    /* API offline; the health pill already shows that */
  }
}

function setStatus(text, hint) {
  statusEl.textContent = text;
  if (hint !== undefined) hintEl.textContent = hint;
}

function addLine(role, text, { partial = false } = {}) {
  let last = transcriptEl.lastElementChild;
  if (last && last.dataset.role === role && last.dataset.partial === "true") {
    last.querySelector(".text").textContent = text;
  } else {
    last = document.createElement("div");
    last.className = `line line-${role}`;
    last.dataset.role = role;
    last.innerHTML = `<span class="who">${role === "assistant" ? "Maya" : "You"}</span><span class="text"></span>`;
    last.querySelector(".text").textContent = text;
    transcriptEl.appendChild(last);
  }
  last.dataset.partial = String(partial);
  transcriptEl.scrollTop = transcriptEl.scrollHeight;
}

async function startCall() {
  if (!config?.enabled) return;
  panel.hidden = false;
  transcriptEl.innerHTML = "";
  setStatus("Connecting…");
  toggle.disabled = true;
  try {
    if (!vapi) {
      const mod = await import("https://esm.sh/@vapi-ai/web@2");
      const Vapi = mod.default;
      vapi = new Vapi(config.publicKey);
      vapi.on("call-start", () => {
        active = true;
        setStatus("On the call", "Maya is listening. You can interrupt her at any time.");
        toggle.textContent = "Hang up";
        toggle.disabled = false;
      });
      vapi.on("call-end", () => {
        active = false;
        setStatus("Call ended", "Refresh the patient list to see the new record and its transcript.");
        toggle.textContent = "Talk to the agent";
        toggle.disabled = false;
        document.dispatchEvent(new CustomEvent("patients:refresh"));
      });
      vapi.on("speech-start", () => setStatus("Maya is speaking"));
      vapi.on("speech-end", () => active && setStatus("Listening…"));
      vapi.on("message", (m) => {
        if (m?.type === "transcript" && m.transcript) {
          addLine(m.role === "assistant" ? "assistant" : "user", m.transcript, { partial: m.transcriptType === "partial" });
        }
        if (m?.type === "tool-calls" || m?.type === "function-call") {
          setStatus("Checking that…");
        }
      });
      vapi.on("error", (e) => {
        console.error("vapi error", e);
        setStatus("Call failed", e?.error?.message || e?.message || "The browser call could not be started. Check the console and your Vapi public key.");
        toggle.disabled = false;
        toggle.textContent = "Talk to the agent";
        active = false;
      });
    }
    await vapi.start(config.assistantId);
  } catch (err) {
    console.error(err);
    setStatus("Call failed", err?.message || "Could not start the call.");
    toggle.disabled = false;
  }
}

function endCall() {
  if (vapi && active) vapi.stop();
  else panel.hidden = true;
}

toggle.addEventListener("click", () => (active ? endCall() : startCall()));
hangup.addEventListener("click", endCall);
loadConfig();
