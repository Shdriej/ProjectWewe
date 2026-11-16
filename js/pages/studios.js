"use strict";

let cities = [];

async function render() {
  const city = getCity(cities);
  $("#page-title").textContent = `Studios in ${city}`;

  const [list, gigs] = await Promise.all([api.studios(city), api.gigs(city, 3)]);
  $("#page-sub").textContent = `${list.length} ${list.length === 1 ? "studio" : "studios"} to rehearse or record in. Open hours are for today.`;

  const grid = $("#studios");
  grid.replaceChildren();
  if (!list.length) grid.append(el("p", "empty", `No studios listed in ${city} yet.`));

  list.forEach(s => {
    const card = el("article", "card");
    const tags = el("ul", "tags");
    s.tags.forEach(t => tags.append(el("li", "", t)));
    const link = el("a", "primary linkbtn", "See schedule and book");
    link.href = `book.html?studio=${encodeURIComponent(s.id)}`;

    const meta = s.rooms.length
      ? `${s.rooms.length} ${s.rooms.length === 1 ? "room" : "rooms"} · from ${CURRENCY}${s.cheapest}/hr`
      : "No rooms listed yet";

    card.append(
      el("h3", "", s.name),
      el("p", "addr", s.address),
      el("p", "", s.blurb),
      tags,
      el("p", "meta", meta),
      el("p", s.openRoomHours ? "avail ok" : "avail none", s.openRoomHours ? `${s.openRoomHours} open room-hours today` : "Fully booked today"),
      link
    );
    grid.append(card);
  });

  const preview = $("#gig-preview");
  preview.replaceChildren();
  if (!gigs.length) preview.append(el("li", "empty", `No gigs listed in ${city} yet.`));
  gigs.forEach(g => preview.append(gigItem(g)));
}

async function init() {
  try {
    await initApp();
    cities = await api.cities();
    if (!cities.length) {
      $("#page-sub").textContent = "No studios listed yet.";
      return;
    }
    fillCitySelect($("#city"), cities, () => render().catch(showLoadError));
    await render();
  } catch (err) {
    showLoadError(err);
  }
}

function showLoadError(err) {
  $("#page-sub").textContent = `Couldn't load studios: ${err.message}`;
}

init();
