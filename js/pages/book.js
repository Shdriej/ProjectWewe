"use strict";

const params = new URLSearchParams(location.search);
const focusRoom = params.get("room");
let studio = null;
let ROOMS = [];

/* ============ State ============ */
const wantedDate = params.get("date");
const state = {
  date: /^\d{4}-\d{2}-\d{2}$/.test(wantedDate || "") ? wantedDate : toISO(new Date()),
  bookings: [],
  pick: null, // { roomId, start, end } where end is exclusive; end === null while choosing
};

/* ============ Helpers ============ */
function isPast(hour) { return slotStarted(state.date, hour); }

/* ============ Rendering ============ */
async function refresh() {
  try {
    const s = await api.schedule(studio.id, state.date);
    state.bookings = [...s.bookings, ...s.gigs.map(g => ({ ...g, label: g.title, gig: true }))];
  } catch (err) {
    state.bookings = [];
    showError(err.message);
  }
  state.pick = null;
  $("#date").value = state.date;
  renderTimeline();
  renderList();
  renderSummary();
}

function renderTimeline() {
  const root = $("#timeline");
  root.style.setProperty("--hours", hours.length);
  root.replaceChildren();

  const ruler = el("div", "row ruler");
  ruler.append(el("div", "room"));
  hours.forEach(h => ruler.append(el("div", "tick", fmtHour(h))));
  root.append(ruler);

  ROOMS.forEach(room => {
    const row = el("div", room.id === focusRoom ? "row focus" : "row");
    row.setAttribute("role", "row");
    const label = el("div", "room");
    label.append(el("strong", "", room.name), el("span", "", `${room.desc} · ${CURRENCY}${room.rate}/hr`));
    row.append(label);

    const mine = state.bookings.filter(b => b.roomId === room.id);
    for (let i = 0; i < hours.length; i++) {
      const h = hours[i];
      const booking = mine.find(b => b.start === h);
      if (booking) {
        const span = booking.end - booking.start;
        const clip = el("div", booking.gig ? "clip gig" : "clip", booking.label);
        clip.append(el("small", "", `${booking.gig ? "Gig · " : ""}${fmtHour(booking.start)}–${fmtHour(booking.end)}`));
        clip.style.gridColumn = `span ${span}`;
        row.append(clip);
        i += span - 1;
        continue;
      }
      const slot = el("button", "slot");
      slot.type = "button";
      slot.disabled = isPast(h);
      slot.setAttribute("aria-label", `${room.name}, ${fmtHour(h)}`);
      if (isPicked(room.id, h)) slot.classList.add("picked");
      slot.addEventListener("click", () => choose(room.id, h));
      row.append(slot);
    }
    root.append(row);
  });
}

function isPicked(roomId, h) {
  const p = state.pick;
  if (!p || p.roomId !== roomId) return false;
  return h >= p.start && h < (p.end ?? p.start + 1);
}

function renderSummary() {
  const box = $("#summary");
  const btn = $("#book");
  const p = state.pick;
  box.classList.remove("ready");
  btn.textContent = currentUser ? "Book studio" : "Log in to book";

  if (!p) {
    box.textContent = "Nothing selected yet. Click a start hour on any room, then an end hour.";
    btn.disabled = true;
    return;
  }
  const room = ROOMS.find(r => r.id === p.roomId);
  if (p.end === null) {
    box.textContent = `${room.name} from ${fmtHour(p.start)}. Now click the last hour you need.`;
    btn.disabled = true;
    return;
  }
  const hrs = p.end - p.start;
  box.replaceChildren(
    el("strong", "", `${room.name}, ${fmtDate(state.date)}`),
    document.createElement("br"),
    document.createTextNode(`${fmtHour(p.start)}–${fmtHour(p.end)} (${hrs} hr) · ${CURRENCY}${hrs * room.rate}`)
  );
  box.classList.add("ready");
  btn.disabled = false;
}

function renderList() {
  const ul = $("#booking-list");
  ul.replaceChildren();
  if (!state.bookings.length) {
    ul.append(el("li", "empty", "No bookings yet for this day."));
    return;
  }
  [...state.bookings]
    .sort((a, b) => a.start - b.start)
    .forEach(b => {
      const room = ROOMS.find(r => r.id === b.roomId);
      const li = el("li");
      li.append(el("span", "", `${room ? room.name : "Room"} · ${fmtHour(b.start)}–${fmtHour(b.end)} · ${b.label}`));
      if (!b.gig && b.canCancel) {
        const cancel = el("button", "", "Cancel");
        cancel.type = "button";
        cancel.addEventListener("click", async () => {
          try {
            await api.cancel(b.id);
            toast("Booking cancelled.");
          } catch (err) {
            showError(err.message);
          }
          refresh();
        });
        li.append(cancel);
      }
      ul.append(li);
    });
}

function renderWho() {
  const box = $("#who");
  box.replaceChildren();
  if (currentUser) {
    box.textContent = `Booking as ${currentUser.name} (${currentUser.email})`;
    return;
  }
  const link = el("a", "", "Log in or sign up");
  link.href = loginUrl();
  box.append("You need an account to book. ", link, ".");
}

function loginUrl() {
  return `login.html?next=${encodeURIComponent(`book.html?studio=${studio.id}&date=${state.date}`)}`;
}

/* ============ Selection ============ */
function choose(roomId, h) {
  const p = state.pick;
  showError("");
  // First click, a different room, or a finished selection: start over
  if (!p || p.roomId !== roomId || p.end !== null) {
    state.pick = { roomId, start: h, end: null };
  } else {
    const start = Math.min(p.start, h);
    const last = Math.max(p.start, h);
    const blocked = state.bookings.some(b =>
      b.roomId === roomId && start < b.end && b.start < last + 1);
    const past = hours.some(x => x >= start && x <= last && isPast(x));
    state.pick = (blocked || past)
      ? { roomId, start: h, end: null }
      : { roomId, start, end: last + 1 };
    if (blocked) showError("That range overlaps an existing booking.");
  }
  renderTimeline();
  renderSummary();
}

/* ============ Booking form ============ */
function showError(msg) { $("#error").textContent = msg; }

$("#booking-form").addEventListener("submit", async e => {
  e.preventDefault();
  showError("");
  const p = state.pick;

  if (!currentUser) { location.href = loginUrl(); return; }
  if (!p || p.end === null) return showError("Pick a room and a time range first.");

  const button = $("#book");
  button.disabled = true;
  try {
    await api.book({
      studioId: studio.id,
      roomId: p.roomId,
      date: state.date,
      start: p.start,
      end: p.end,
      notes: $("#notes").value.trim(),
    });
    const room = ROOMS.find(r => r.id === p.roomId);
    toast(`Booked ${room.name}, ${fmtHour(p.start)}–${fmtHour(p.end)}.`);
    $("#notes").value = "";
    await refresh();
  } catch (err) {
    if (err.status === 401) { location.href = loginUrl(); return; }
    await refresh();
    showError(err.message);
  }
});

/* ============ Date navigation ============ */
$("#prev").addEventListener("click", () => { state.date = shiftDate(state.date, -1); refresh(); });
$("#next").addEventListener("click", () => { state.date = shiftDate(state.date, 1); refresh(); });
$("#today").addEventListener("click", () => { state.date = toISO(new Date()); refresh(); });
$("#date").addEventListener("change", e => { if (e.target.value) { state.date = e.target.value; refresh(); } });

/* ============ Start ============ */
async function init() {
  try {
    await initApp();
    const id = params.get("studio");
    if (id) {
      studio = await api.studio(id);
    } else {
      const cities = await api.cities();
      const list = cities.length ? await api.studios(getCity(cities)) : [];
      studio = list[0] || null;
    }
  } catch { studio = null; }

  if (!studio) {
    $("#studio-name").textContent = "Studio not found";
    $("#studio-sub").textContent = "Pick a studio from the studios page.";
    document.querySelector(".schedule").hidden = true;
    document.querySelector(".panel").hidden = true;
    return;
  }

  ROOMS = studio.rooms;
  document.title = `Book ${studio.name} – Studizzz`;
  $("#studio-name").textContent = studio.name;
  $("#studio-sub").textContent = `${studio.address}, ${studio.city}. Click the first hour you need, then the last one.`;
  renderWho();
  await refresh();
}

init();
