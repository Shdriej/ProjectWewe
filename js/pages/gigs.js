"use strict";

let cities = [];

async function render() {
  const city = getCity(cities);
  const gigs = await api.gigs(city);
  const list = $("#gig-list");

  $("#page-title").textContent = `Upcoming gigs in ${city}`;
  $("#page-sub").textContent = `${gigs.length} ${gigs.length === 1 ? "gig" : "gigs"} coming up.`;
  list.replaceChildren();

  if (!gigs.length) {
    list.append(el("li", "empty", `No gigs listed in ${city} yet.`));
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
    cities = await api.cities();
    if (!cities.length) {
      $("#page-sub").textContent = "No gigs listed yet.";
      return;
    }
    fillCitySelect($("#city"), cities, () => render().catch(showLoadError));
    await render();
  } catch (err) {
    showLoadError(err);
  }
}

init();
