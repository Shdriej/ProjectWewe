"use strict";

const $ = sel => document.querySelector(sel);

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function toISO(d) {
  const p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function shiftDate(iso, days) {
  const [y, m, d] = iso.split("-").map(Number);
  return toISO(new Date(y, m - 1, d + days));
}
function parseISO(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function fmtHour(h) { return `${String(h).padStart(2, "0")}:00`; }
function fmtDate(iso) {
  return parseISO(iso).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
}
/* True once the given hour on the given date has begun (browser clock) */
function slotStarted(date, hour) {
  const now = new Date();
  const today = toISO(now);
  return date < today || (date === today && hour <= now.getHours());
}

/* ---------- app-wide state, filled by initApp() ---------- */
let CURRENCY = "₱";
let hours = [];          // opening hours, e.g. [9 ... 22]
let currentUser = null;  // { id, name, email, role } or null

async function initApp() {
  const [cfg, me] = await Promise.all([api.config(), api.me()]);
  CURRENCY = cfg.currency;
  hours = Array.from({ length: cfg.closeHour - cfg.openHour }, (_, i) => cfg.openHour + i);
  currentUser = me.user;
  renderAuthSlot();
  return cfg;
}


function renderAuthSlot() {
  const slot = $("#auth-slot");
  if (!slot) return;
  slot.replaceChildren();
  if (!currentUser) {
    const page = location.pathname.split("/").pop() || "index.html";
    const login = el("a", "", "Log in");
    login.href = `login.html?next=${encodeURIComponent(page + location.search)}`;
    slot.append(login);
    return;
  }
  slot.append(el("span", "", `${currentUser.name} · ${currentUser.role}`));
  const dash = el("a", "", "Dashboard");
  dash.href = "dashboard.html";
  if (location.pathname.endsWith("dashboard.html")) dash.setAttribute("aria-current", "page");
  const out = el("button", "linkish", "Log out");
  out.type = "button";
  out.addEventListener("click", async () => {
    try { await api.logout(); } finally { location.href = "index.html"; }
  });
  slot.append(dash, out);
}

/* The chosen city is remembered between pages */
const CITY_KEY = "studio-city";
function getCity(cities) {
  let saved = null;
  try { saved = localStorage.getItem(CITY_KEY); } catch {}
  return cities.includes(saved) ? saved : cities[0];
}
function fillCitySelect(select, cities, onChange) {
  cities.forEach(c => select.append(new Option(c, c)));
  select.value = getCity(cities);
  select.addEventListener("change", () => {
    try { localStorage.setItem(CITY_KEY, select.value); } catch {}
    onChange();
  });
}

/* One gig row, used on the home page and the gigs page */
function gigItem(g) {
  const li = el("li", "gig");
  const when = el("div", "when");
  when.append(
    el("strong", "", parseISO(g.date).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })),
    el("span", "", `${fmtHour(g.start)}–${fmtHour(g.end)}`)
  );
  const what = el("div", "what");
  what.append(el("strong", "", g.title), el("span", "", g.act), el("span", "", `${g.venue} · ${g.genre}`));
  li.append(when, what, el("div", "price", g.price ? `${CURRENCY}${g.price}` : "Free"));
  return li;
}

let toastTimer;
function toast(msg) {
  const t = $("#toast");
  if (!t) return;
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 3000);
}
