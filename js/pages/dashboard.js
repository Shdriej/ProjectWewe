"use strict";

let studios = [];                        // studios this user manages, each with its rooms
const paging = { bookings: 1, users: 1 };
const PAGE_SIZE = 15;

const isManager = () => currentUser.role === "owner" || currentUser.role === "admin";

/* ============ Small helpers ============ */
function btn(label, cls, onClick) {
  const b = el("button", `btn ${cls || ""}`.trim(), label);
  b.type = "button";
  b.addEventListener("click", onClick);
  return b;
}

function table(headers, rows) {
  const t = el("table", "data");
  const head = el("tr");
  headers.forEach(h => head.append(el("th", "", h)));
  const thead = el("thead");
  thead.append(head);
  t.append(thead);
  const body = el("tbody");
  rows.forEach(cells => {
    const tr = el("tr");
    cells.forEach(c => {
      const td = el("td");
      if (c instanceof Node) td.append(c); else td.textContent = c ?? "";
      tr.append(td);
    });
    body.append(tr);
  });
  t.append(body);
  const wrap = el("div", "tablewrap");
  wrap.append(t);
  return wrap;
}

/* Runs an API call, then reports success as a toast and failure either in the form or as a toast */
async function attempt(action, okMessage, errorBox) {
  if (errorBox) errorBox.textContent = "";
  try {
    await action();
    if (okMessage) toast(okMessage);
    return true;
  } catch (err) {
    if (errorBox) errorBox.textContent = err.message; else toast(err.message);
    return false;
  }
}

function pager(key, total, reload) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const box = el("div", "pager");
  const prev = btn("Previous", "", () => { paging[key]--; reload(); });
  const next = btn("Next", "", () => { paging[key]++; reload(); });
  prev.disabled = paging[key] <= 1;
  next.disabled = paging[key] >= pages;
  box.append(prev, el("span", "", `Page ${paging[key]} of ${pages} · ${total} total`), next);
  return box;
}

const canCancel = b => b.status === "confirmed" && !slotStarted(b.date, b.start);

function cancelButton(b) {
  return btn("Cancel", "danger", async () => {
    if (!confirm("Cancel this booking?")) return;
    if (await attempt(() => api.cancel(b.id), "Booking cancelled.")) reloadBookings();
  });
}

function reloadBookings() {
  const jobs = [loadMyBookings()];
  if (isManager()) jobs.push(loadStudioBookings());
  return Promise.all(jobs);
}

/* ============ My bookings ============ */
async function loadMyBookings() {
  const box = $("#my-bookings");
  const list = await api.myBookings();
  box.replaceChildren();
  if (!list.length) {
    box.append(el("p", "empty", "You haven't booked anything yet."));
    return;
  }
  box.append(table(
    ["Studio", "Room", "Date", "Time", "Total", "Status", ""],
    list.map(b => [
      b.studioName, b.roomName, fmtDate(b.date), `${fmtHour(b.start)}–${fmtHour(b.end)}`, `${CURRENCY}${b.total}`,
      el("span", b.status === "cancelled" ? "cancelled" : "", b.status),
      canCancel(b) ? cancelButton(b) : "",
    ])
  ));
}

/* ============ Studios and rooms ============ */
async function loadStudios() {
  studios = await api.managedStudios();
  renderStudios();
  fillStudioSelects();
}

function renderStudios() {
  const root = $("#studio-list");
  root.replaceChildren();
  if (!studios.length) {
    root.append(el("p", "empty", "No studios yet. Add one above."));
    return;
  }
  studios.forEach(s => {
    const card = el("article", "box");
    const head = el("div", "daybar");
    const title = el("div");
    title.append(el("h3", "", s.name), el("p", "sub", `${s.address}, ${s.city}${s.tags.length ? ` · ${s.tags.join(", ")}` : ""}`));
    const actions = el("div", "daynav");
    actions.append(btn("Edit", "", () => editStudio(s)), btn("Delete", "danger", () => removeStudio(s)));
    head.append(title, actions);
    card.append(head);

    if (s.rooms.length) {
      card.append(table(
        ["Room", "Description", "Rate", ""],
        s.rooms.map(r => {
          const cell = el("span");
          cell.append(btn("Edit", "", () => editRoom(r)), btn("Remove", "danger", () => removeRoom(r)));
          return [r.name, r.desc, `${CURRENCY}${r.rate}/hr`, cell];
        })
      ));
    } else {
      card.append(el("p", "empty", "No rooms yet."));
    }
    root.append(card);
  });
}

function fillStudioSelects() {
  const roomSel = $("#room-studio");
  const keep = roomSel.value;
  roomSel.replaceChildren(...studios.map(s => new Option(`${s.name} (${s.city})`, s.id)));
  if (studios.some(s => s.id === keep)) roomSel.value = keep;

  const gigSel = $("#gig-studio");
  const keepGig = gigSel.value;
  gigSel.replaceChildren(new Option("Another venue (outside a studio)", ""), ...studios.map(s => new Option(s.name, s.id)));
  if (studios.some(s => s.id === keepGig)) gigSel.value = keepGig;
  syncGigWhere();
}

function editStudio(s) {
  $("#studio-form-title").textContent = `Edit ${s.name}`;
  $("#studio-id").value = s.id;
  $("#studio-version").value = s.version;
  $("#studio-name").value = s.name;
  $("#studio-city").value = s.city;
  $("#studio-address").value = s.address;
  $("#studio-blurb").value = s.blurb || "";
  $("#studio-tags").value = s.tags.join(", ");
  $("#studio-form").scrollIntoView();
}

function resetStudioForm() {
  $("#studio-form").reset();
  $("#studio-id").value = "";
  $("#studio-version").value = "";
  $("#studio-form-title").textContent = "Add a studio";
  $("#studio-error").textContent = "";
}

async function removeStudio(s) {
  if (!confirm(`Delete ${s.name}, its rooms and its gigs?`)) return;
  if (await attempt(() => api.deleteStudio(s.id), "Studio deleted.")) {
    await Promise.all([loadStudios(), loadGigs(), loadStudioBookings()]);
  }
}

function editRoom(r) {
  $("#room-form-title").textContent = `Edit ${r.name}`;
  $("#room-id").value = r.id;
  $("#room-studio").value = r.studioId;
  $("#room-studio").disabled = true; // a room stays in its studio
  $("#room-name").value = r.name;
  $("#room-desc").value = r.desc || "";
  $("#room-rate").value = r.rate;
  $("#room-form").scrollIntoView();
}

function resetRoomForm() {
  $("#room-form").reset();
  $("#room-id").value = "";
  $("#room-studio").disabled = false;
  $("#room-form-title").textContent = "Add a room";
  $("#room-error").textContent = "";
}

async function removeRoom(r) {
  if (!confirm(`Remove ${r.name}?`)) return;
  if (await attempt(() => api.deleteRoom(r.id), "Room removed.")) await loadStudios();
}

/* ============ Gigs ============ */
async function loadGigs() {
  const box = $("#gig-list");
  const list = await api.manageGigs();
  box.replaceChildren();
  if (!list.length) {
    box.append(el("p", "empty", "No gigs yet."));
    return;
  }
  box.append(table(
    ["Date", "Time", "Title", "Venue", "City", "Price", ""],
    list.map(g => [
      fmtDate(g.date), `${fmtHour(g.start)}–${fmtHour(g.end)}`, g.title, g.venue, g.city, g.price ? `${CURRENCY}${g.price}` : "Free",
      btn("Delete", "danger", async () => {
        if (!confirm(`Delete "${g.title}"?`)) return;
        if (await attempt(() => api.deleteGig(g.id), "Gig deleted.")) loadGigs();
      }),
    ])
  ));
}

/* Studio gigs pick a room (which blocks it); outside-venue gigs type a venue and city */
function syncGigWhere() {
  const studioId = $("#gig-studio").value;
  $("#gig-room-wrap").hidden = !studioId;
  $("#gig-venue-wrap").hidden = !!studioId;
  const s = studios.find(x => x.id === studioId);
  $("#gig-room").replaceChildren(...(s ? s.rooms : []).map(r => new Option(r.name, r.id)));
}

/* ============ Studio bookings (owner, admin) ============ */
async function loadStudioBookings() {
  const box = $("#studio-bookings");
  const data = await api.studioBookings({ page: paging.bookings, limit: PAGE_SIZE });
  box.replaceChildren();
  if (!data.total) {
    box.append(el("p", "empty", "No bookings at your studios yet."));
    return;
  }
  box.append(
    table(
      ["Date", "Time", "Studio / room", "Customer", "Total", "Status", ""],
      data.bookings.map(b => [
        fmtDate(b.date), `${fmtHour(b.start)}–${fmtHour(b.end)}`, `${b.studioName} / ${b.roomName}`,
        `${b.customerName || "Deleted user"}${b.customerEmail ? ` (${b.customerEmail})` : ""}`,
        `${CURRENCY}${b.total}`, el("span", b.status === "cancelled" ? "cancelled" : "", b.status),
        canCancel(b) ? cancelButton(b) : "",
      ])
    ),
    pager("bookings", data.total, loadStudioBookings)
  );
}

/* ============ Users (admin) ============ */
async function loadUsers() {
  const box = $("#user-list");
  const data = await api.users({ page: paging.users, limit: PAGE_SIZE });
  box.replaceChildren();
  box.append(
    table(
      ["Name", "Email", "Role", "Joined", ""],
      data.users.map(u => {
        const self = u.id === currentUser.id;
        const select = el("select");
        ["customer", "owner", "admin"].forEach(r => select.append(new Option(r, r)));
        select.value = u.role;
        select.disabled = self;
        select.setAttribute("aria-label", `Role for ${u.name}`);
        select.addEventListener("change", async () => {
          const ok = await attempt(() => api.setRole(u.id, select.value), "Role updated.");
          if (!ok) loadUsers();
        });
        return [
          u.name, u.email, select, new Date(u.createdAt).toLocaleDateString(),
          self ? "" : btn("Delete", "danger", async () => {
            if (!confirm(`Delete ${u.name}? Their upcoming bookings will be cancelled.`)) return;
            if (await attempt(() => api.deleteUser(u.id), "User deleted.")) loadUsers();
          }),
        ];
      })
    ),
    pager("users", data.total, loadUsers)
  );
}

/* ============ Forms ============ */
function wireForms() {
  $("#studio-form").addEventListener("submit", async e => {
    e.preventDefault();
    const id = $("#studio-id").value;
    const body = {
      name: $("#studio-name").value, city: $("#studio-city").value, address: $("#studio-address").value,
      blurb: $("#studio-blurb").value, tags: $("#studio-tags").value,
    };
    if (id) body.version = Number($("#studio-version").value);
    const ok = await attempt(() => (id ? api.updateStudio(id, body) : api.createStudio(body)), id ? "Studio updated." : "Studio added.", $("#studio-error"));
    if (ok) {
      resetStudioForm();
      await Promise.all([loadStudios(), loadGigs()]);
    }
  });
  $("#studio-clear").addEventListener("click", resetStudioForm);

  $("#room-form").addEventListener("submit", async e => {
    e.preventDefault();
    const id = $("#room-id").value;
    const body = { name: $("#room-name").value, desc: $("#room-desc").value, rate: $("#room-rate").value };
    const studioId = $("#room-studio").value;
    if (!id && !studioId) { $("#room-error").textContent = "Add a studio first."; return; }
    const ok = await attempt(() => (id ? api.updateRoom(id, body) : api.createRoom(studioId, body)), id ? "Room updated." : "Room added.", $("#room-error"));
    if (ok) {
      resetRoomForm();
      await loadStudios();
    }
  });
  $("#room-clear").addEventListener("click", resetRoomForm);

  $("#gig-studio").addEventListener("change", syncGigWhere);
  $("#gig-form").addEventListener("submit", async e => {
    e.preventDefault();
    const studioId = $("#gig-studio").value;
    const body = {
      title: $("#gig-title").value, act: $("#gig-act").value, genre: $("#gig-genre").value, price: $("#gig-price").value,
      date: $("#gig-date").value, start: Number($("#gig-start").value), end: Number($("#gig-end").value),
    };
    if (studioId) {
      body.studioId = studioId;
      body.roomId = $("#gig-room").value;
      if (!body.roomId) { $("#gig-error").textContent = "Add a room to that studio first."; return; }
    } else {
      body.venue = $("#gig-venue").value;
      body.city = $("#gig-city").value;
    }
    const ok = await attempt(() => api.createGig(body), "Gig added.", $("#gig-error"));
    if (ok) {
      $("#gig-form").reset();
      syncGigWhere();
      await Promise.all([loadGigs(), loadStudioBookings()]);
    }
  });
}

function fillHourSelects() {
  const start = $("#gig-start");
  const end = $("#gig-end");
  hours.forEach(h => start.append(new Option(fmtHour(h), h)));
  [...hours.slice(1), hours[hours.length - 1] + 1].forEach(h => end.append(new Option(fmtHour(h), h)));
  start.value = hours.includes(19) ? 19 : hours[0];
  end.value = hours.includes(21) ? 22 : hours[hours.length - 1] + 1;
  $("#gig-date").min = toISO(new Date());
}

/* ============ Start ============ */
async function load(job) {
  try { await job(); } catch (err) { toast(err.message); }
}

async function init() {
  try {
    await initApp();
  } catch (err) {
    $("#page-sub").textContent = `Couldn't load your account: ${err.message}`;
    return;
  }
  if (!currentUser) {
    location.href = "login.html?next=dashboard.html";
    return;
  }
  $("#page-sub").textContent = `Signed in as ${currentUser.name} (${currentUser.role}).`;
  $("#sec-bookings").hidden = false;
  const jobs = [load(loadMyBookings)];

  if (isManager()) {
    ["#sec-studios", "#sec-gigs", "#sec-studio-bookings"].forEach(s => { $(s).hidden = false; });
    fillHourSelects();
    wireForms();
    jobs.push(load(loadStudios), load(loadGigs), load(loadStudioBookings));
  }
  if (currentUser.role === "admin") {
    $("#sec-users").hidden = false;
    jobs.push(load(loadUsers));
  }
  await Promise.all(jobs);
}

init();
