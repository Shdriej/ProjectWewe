"use strict";

async function render() {
  const [studios, gigs] = await Promise.all([api.studios(), api.gigs(3)]);
  const studio = studios[0];
  if (!studio) {
    $("#studio-location").textContent = "Studio details are unavailable right now.";
    $("#studio-description").textContent = "Please try again in a moment.";
    $("#room-list").replaceChildren(el("p", "empty", "No rooms are available to show."));
    return;
  }

  document.title = `${studio.name} – Rehearsal & Recording`;
  $("#studio-location").textContent = `${studio.address}, ${studio.city}`;
  $("#studio-description").textContent = studio.blurb;

  const tags = $("#studio-tags");
  tags.replaceChildren(...studio.tags.map(tag => el("li", "", tag)));

  const roomList = $("#room-list");
  roomList.replaceChildren();
  studio.rooms.forEach(room => {
    const card = el("article", "room-card");
    const link = el("a", "primary linkbtn", "See availability");
    const rate = el("p", "room-rate");
    link.href = `book.html?studio=${encodeURIComponent(studio.id)}&room=${encodeURIComponent(room.id)}`;
    rate.append(`${CURRENCY}${room.rate} `, el("span", "/ hour"));
    card.append(
      el("h3", "", room.name),
      el("p", "room-desc", room.desc),
      rate,
      link
    );
    roomList.append(card);
  });

  const preview = $("#gig-preview");
  preview.replaceChildren();
  if (!gigs.length) preview.append(el("li", "empty", "No events scheduled yet. Check back soon."));
  gigs.forEach(gig => preview.append(gigItem(gig)));
}

async function init() {
  try {
    await initApp();
    await render();
  } catch (err) {
    $("#studio-location").textContent = `Couldn't load studio details: ${err.message}`;
    $("#studio-description").textContent = "Please try again in a moment.";
  }
}

init();
