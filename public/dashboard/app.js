(() => {
  const $ = (sel) => document.querySelector(sel);
  const els = {
    layout: $(".layout"),
    body: $("#patients-body"),
    status: $("#status"),
    search: $("#search"),
    showDeleted: $("#show-deleted"),
    refresh: $("#refresh"),
    health: $("#health"),
    detail: $("#detail"),
    detailName: $("#detail-name"),
    detailId: $("#detail-id"),
    detailFields: $("#detail-fields"),
    detailCalls: $("#detail-calls"),
    detailAppointments: $("#detail-appointments"),
    detailClose: $("#detail-close"),
    detailInitials: $("#detail-initials"),
    rowTemplate: $("#row-template"),
    statTotal: $("#stat-total"),
    statToday: $("#stat-today"),
    statCalls: $("#stat-calls"),
    statInsured: $("#stat-insured"),
  };

  let patients = [];
  let selectedId = null;

  const fmtPhone = (p) => (p && p.length === 10 ? `(${p.slice(0, 3)}) ${p.slice(3, 6)}-${p.slice(6)}` : p || "—");
  const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString() : "—");
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  async function api(path) {
    // ngrok's free tier replaces responses with a browser warning page unless this header is sent.
    const res = await fetch(path, { headers: { accept: "application/json", "ngrok-skip-browser-warning": "1" } });
    const json = await res.json().catch(() => ({ data: null, error: { message: `HTTP ${res.status}` } }));
    if (!res.ok || json.error) throw new Error(json.error?.message || `HTTP ${res.status}`);
    return json;
  }

  function setStatus(text, isError = false) {
    els.status.textContent = text;
    els.status.classList.toggle("error", isError);
  }

  async function checkHealth() {
    try {
      await api("/health");
      els.health.innerHTML = '<span class="dot"></span>API online';
      els.health.className = "pill pill-ok";
    } catch {
      els.health.innerHTML = '<span class="dot"></span>API unreachable';
      els.health.className = "pill pill-danger";
    }
  }

  function countUp(el, target) {
    const start = Number(el.dataset.value || 0);
    el.dataset.value = String(target);
    if (start === target || window.matchMedia("(prefers-reduced-motion: reduce)").matches) { el.textContent = String(target); return; }
    const t0 = performance.now();
    (function frame(now) {
      const p = Math.min(1, (now - t0) / 700);
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = String(Math.round(start + (target - start) * eased));
      if (p < 1) requestAnimationFrame(frame);
    })(t0);
  }

  function updateStats(total) {
    const live = patients.filter((p) => !p.deleted_at);
    const today = new Date().toDateString();
    countUp(els.statTotal, total ?? live.length);
    countUp(els.statToday, live.filter((p) => new Date(p.created_at).toDateString() === today).length);
    countUp(els.statInsured, live.filter((p) => p.insurance_provider).length);
    api("/calls").then(({ data }) => countUp(els.statCalls, data.length)).catch(() => { els.statCalls.textContent = "—"; });
  }

  async function load() {
    setStatus("Loading patients…");
    els.refresh.disabled = true;
    els.refresh.classList.add("spinning");
    try {
      const qs = els.showDeleted.checked ? "?include_deleted=true&limit=500" : "?limit=500";
      const { data, meta } = await api(`/patients${qs}`);
      patients = data;
      render();
      updateStats(els.showDeleted.checked ? undefined : meta?.total);
      setStatus(`${meta?.total ?? data.length} patient${data.length === 1 ? "" : "s"} on file`);
    } catch (err) {
      patients = [];
      render();
      setStatus(`Could not load patients: ${err.message}`, true);
    } finally {
      els.refresh.disabled = false;
      els.refresh.classList.remove("spinning");
    }
  }

  function filtered() {
    const q = els.search.value.trim().toLowerCase();
    if (!q) return patients;
    const digits = q.replace(/\D/g, "");
    return patients.filter((p) => {
      const hay = `${p.first_name} ${p.last_name} ${p.city} ${p.state} ${p.email ?? ""} ${p.insurance_provider ?? ""}`.toLowerCase();
      return hay.includes(q) || (digits && p.phone_number.includes(digits));
    });
  }

  function render() {
    const rows = filtered();
    els.body.innerHTML = "";
    if (rows.length === 0) {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td colspan="6"><div class="empty"><img src="/assets/maya.png" alt="" width="120" height="120" /><strong>${patients.length ? "No matches" : "No patients yet"}</strong>${
        patients.length ? "Try a different search." : "Call the intake line or POST to /patients to add the first record."
      }</div></td>`;
      els.body.appendChild(tr);
      return;
    }
    rows.forEach((p, i) => {
      const frag = els.rowTemplate.content.cloneNode(true);
      const tr = frag.querySelector("tr");
      tr.dataset.id = p.patient_id;
      tr.style.animationDelay = `${Math.min(i, 12) * 35}ms`;
      if (p.deleted_at) tr.classList.add("deleted");
      if (p.patient_id === selectedId) tr.classList.add("selected");
      tr.querySelector('[data-col="name"]').innerHTML = `<span class="name">${esc(p.first_name)} ${esc(p.last_name)}</span><span class="sub">${esc(p.sex)} · ${esc(p.preferred_language)}</span>`;
      tr.querySelector('[data-col="dob"]').textContent = p.date_of_birth;
      tr.querySelector('[data-col="phone"]').textContent = fmtPhone(p.phone_number);
      tr.querySelector('[data-col="location"]').textContent = `${p.city}, ${p.state} ${p.zip_code}`;
      tr.querySelector('[data-col="insurance"]').textContent = p.insurance_provider || "—";
      tr.querySelector('[data-col="created"]').textContent = fmtDate(p.created_at);
      tr.addEventListener("click", () => select(p.patient_id));
      tr.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(p.patient_id); } });
      els.body.appendChild(frag);
    });
  }

  const FIELDS = [
    ["Date of birth", "date_of_birth"], ["Sex", "sex"], ["Phone", "phone_number", fmtPhone], ["Email", "email"],
    ["Address", (p) => [p.address_line_1, p.address_line_2].filter(Boolean).join(", "), null, "wide"],
    ["City / State / ZIP", (p) => `${p.city}, ${p.state} ${p.zip_code}`, null, "wide"],
    ["Insurance", "insurance_provider"], ["Member ID", "insurance_member_id"],
    ["Preferred language", "preferred_language"],
    ["Emergency contact", (p) => p.emergency_contact_name ? `${p.emergency_contact_name} · ${fmtPhone(p.emergency_contact_phone)}` : null],
    ["Created (UTC)", "created_at", fmtDate], ["Updated (UTC)", "updated_at", fmtDate],
    ["Deleted", "deleted_at", (v) => (v ? fmtDate(v) : null)],
  ];

  async function select(id) {
    selectedId = id;
    const p = patients.find((x) => x.patient_id === id);
    if (!p) return;
    render();
    els.layout.classList.add("has-detail");
    els.detail.hidden = false;
    els.detailName.textContent = `${p.first_name} ${p.last_name}`;
    els.detailInitials.textContent = `${p.first_name[0] || ""}${p.last_name[0] || ""}`.toUpperCase();
    els.detailId.textContent = p.patient_id;
    els.detail.classList.remove("pop");
    void els.detail.offsetWidth;
    els.detail.classList.add("pop");
    els.detailFields.innerHTML = FIELDS.map(([label, key, fmt, cls]) => {
      const raw = typeof key === "function" ? key(p) : p[key];
      const val = fmt ? fmt(raw) : raw;
      if (val === null || val === undefined || val === "") return "";
      return `<div class="${cls || ""}"><dt>${esc(label)}</dt><dd>${esc(val)}</dd></div>`;
    }).join("");

    els.detailCalls.innerHTML = '<p class="muted">Loading…</p>';
    els.detailAppointments.innerHTML = '<p class="muted">Loading…</p>';
    try {
      const [{ data: calls }, { data: appts }] = await Promise.all([
        api(`/patients/${id}/calls`),
        api(`/patients/${id}/appointments`),
      ]);
      els.detailAppointments.innerHTML = appts.length
        ? appts.map((a) => `<div class="card"><div class="card-head"><strong>${esc(a.provider_name)}</strong><span class="pill pill-accent">${esc(a.status)}</span></div>${esc(new Date(a.scheduled_for).toLocaleString())}${a.reason ? `<div class="muted">${esc(a.reason)}</div>` : ""}</div>`).join("")
        : '<p class="muted">No appointments scheduled.</p>';
      els.detailCalls.innerHTML = calls.length
        ? calls.map((c) => `<div class="card">
            <div class="card-head"><span class="mono">${esc(c.provider)} · ${esc(fmtDate(c.started_at))}</span><span class="pill ${c.outcome === "registered" || c.outcome === "updated" ? "pill-ok" : "pill-muted"}">${esc(c.outcome || c.status)}</span></div>
            ${c.summary ? `<div>${esc(c.summary)}</div>` : '<div class="muted">No summary recorded.</div>'}
            ${c.transcript ? `<details><summary>Transcript</summary><pre>${esc(c.transcript)}</pre></details>` : ""}
          </div>`).join("")
        : '<p class="muted">No calls linked to this patient (record was created via the API).</p>';
    } catch (err) {
      els.detailCalls.innerHTML = `<p class="muted">Could not load history: ${esc(err.message)}</p>`;
      els.detailAppointments.innerHTML = "";
    }
  }

  function closeDetail() {
    selectedId = null;
    els.detail.hidden = true;
    els.layout.classList.remove("has-detail");
    render();
  }

  els.search.addEventListener("input", render);
  els.showDeleted.addEventListener("change", load);
  els.refresh.addEventListener("click", load);
  els.detailClose.addEventListener("click", closeDetail);
  document.addEventListener("call:ended", () => setTimeout(load, 1500));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !els.detail.hidden) closeDetail(); });

  checkHealth();
  load();
  setInterval(checkHealth, 30000);
})();
