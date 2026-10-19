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
    rowTemplate: $("#row-template"),
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
      els.health.textContent = "API online";
      els.health.className = "pill pill-ok";
    } catch {
      els.health.textContent = "API unreachable";
      els.health.className = "pill pill-danger";
    }
  }

  async function load() {
    setStatus("Loading patients…");
    els.refresh.disabled = true;
    try {
      const qs = els.showDeleted.checked ? "?include_deleted=true&limit=500" : "?limit=500";
      const { data, meta } = await api(`/patients${qs}`);
      patients = data;
      render();
      setStatus(`${meta?.total ?? data.length} patient${data.length === 1 ? "" : "s"} on file`);
    } catch (err) {
      patients = [];
      render();
      setStatus(`Could not load patients: ${err.message}`, true);
    } finally {
      els.refresh.disabled = false;
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
      tr.innerHTML = `<td colspan="6"><div class="empty"><strong>${patients.length ? "No matches" : "No patients yet"}</strong>${
        patients.length ? "Try a different search." : "Call the intake line or POST to /patients to add the first record."
      }</div></td>`;
      els.body.appendChild(tr);
      return;
    }
    for (const p of rows) {
      const frag = els.rowTemplate.content.cloneNode(true);
      const tr = frag.querySelector("tr");
      tr.dataset.id = p.patient_id;
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
    }
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
    els.detailId.textContent = p.patient_id;
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
  document.addEventListener("patients:refresh", load);

  checkHealth();
  load();
  setInterval(checkHealth, 30000);
})();
