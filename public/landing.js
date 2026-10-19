(() => {
  const HEADERS = { accept: "application/json", "ngrok-skip-browser-warning": "1" };
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* Reveal elements as they scroll into view */
  const revealEls = Array.from(document.querySelectorAll(".reveal:not(.in)"));
  if ("IntersectionObserver" in window && !reduceMotion) {
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
      }
    }, { rootMargin: "0px 0px -10% 0px", threshold: 0.12 });
    revealEls.forEach((el) => io.observe(el));
  } else {
    revealEls.forEach((el) => el.classList.add("in"));
  }

  /* Typewriter effect for Maya's first speech bubble */
  for (const el of document.querySelectorAll(".typed[data-text]")) {
    const text = el.dataset.text || "";
    if (reduceMotion) { el.textContent = text; el.classList.add("done"); continue; }
    const delayMs = 1400;
    let i = 0;
    setTimeout(function step() {
      el.textContent = text.slice(0, ++i);
      if (i < text.length) setTimeout(step, 22 + Math.random() * 30);
      else el.classList.add("done");
    }, delayMs);
  }

  /* Live stats from the API with a count-up animation */
  function countUp(el, target) {
    const start = Number(el.dataset.value || 0);
    el.dataset.value = String(target);
    if (reduceMotion || start === target) { el.textContent = String(target); return; }
    const t0 = performance.now();
    const dur = 900;
    (function frame(now) {
      const p = Math.min(1, (now - t0) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = String(Math.round(start + (target - start) * eased));
      if (p < 1) requestAnimationFrame(frame);
    })(t0);
  }

  async function getJson(path) {
    const res = await fetch(path, { headers: HEADERS });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async function loadStats() {
    const patientsEl = document.getElementById("stat-patients");
    const callsEl = document.getElementById("stat-calls");
    try {
      const [p, c] = await Promise.all([getJson("/patients?limit=1"), getJson("/calls")]);
      countUp(patientsEl, p.meta?.total ?? (p.data || []).length);
      countUp(callsEl, (c.data || []).length);
    } catch {
      patientsEl.textContent = "—";
      callsEl.textContent = "—";
    }
  }
  loadStats();
  document.addEventListener("call:ended", () => setTimeout(loadStats, 1500));

  /* curl snippet: point at this server and copy */
  const snippet = document.getElementById("curl-snippet");
  const copyBtn = document.getElementById("copy-curl");
  if (snippet) {
    const url = snippet.querySelector(".url");
    if (url) url.textContent = location.origin;
  }
  if (copyBtn && snippet) {
    copyBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(snippet.textContent.trim());
        copyBtn.textContent = "Copied";
      } catch {
        copyBtn.textContent = "Press Ctrl+C";
      }
      setTimeout(() => { copyBtn.textContent = "Copy"; }, 1800);
    });
  }

  /* Mobile navigation */
  const nav = document.querySelector(".nav");
  const burger = document.getElementById("nav-burger");
  if (nav && burger) {
    burger.addEventListener("click", () => {
      const open = nav.classList.toggle("open");
      burger.setAttribute("aria-expanded", String(open));
    });
    nav.querySelectorAll(".nav-links a").forEach((a) =>
      a.addEventListener("click", () => { nav.classList.remove("open"); burger.setAttribute("aria-expanded", "false"); }),
    );
  }

  /* Subtle parallax on the hero illustration */
  const stage = document.querySelector(".maya-stage");
  if (stage && !reduceMotion && window.matchMedia("(pointer: fine)").matches) {
    const hero = document.querySelector(".hero");
    hero.addEventListener("mousemove", (e) => {
      const r = hero.getBoundingClientRect();
      const dx = (e.clientX - r.left) / r.width - 0.5;
      const dy = (e.clientY - r.top) / r.height - 0.5;
      stage.style.transform = `rotateY(${dx * 6}deg) rotateX(${-dy * 6}deg)`;
    });
    hero.addEventListener("mouseleave", () => { stage.style.transform = ""; });
  }
})();
