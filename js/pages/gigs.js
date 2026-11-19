"use strict";

async function render() {
  const gigs = await api.gigs();
  const list = $("#gig-list");

  $("#page-title").textContent = "Events at Studizz1";
  $("#page-sub").textContent = gigs.length
    ? `${gigs.length} upcoming ${gigs.length === 1 ? "event" : "events"} at the studio.`
    : "No events scheduled right now. Check back soon.";
  list.replaceChildren();

  if (!gigs.length) {
    list.append(el("li", "empty", "New events will appear here as soon as they're announced."));
    return;
  }
  gigs.forEach(gig => list.append(gigItem(gig)));
}

function showLoadError(err) {
  $("#page-sub").textContent = `Couldn't load gigs: ${err.message}`;
}

async function init() {
  try {
    await initApp();
    await render();
  } catch (err) {
    showLoadError(err);
  }
}

init();
