// @deno-types="npm:@types/leaflet@^1.9.14"
import leaflet from "leaflet";

// Style sheets
import "leaflet/dist/leaflet.css";
import "./style.css";

// Fix missing marker images
import "./leafletWorkaround.ts";

// Deterministic random number generator
import luck from "./luck.ts";

// Location of Oakes College
const OAKES = leaflet.latLng(36.98949379578401, -122.06277128548504);

// Setting game parameters
const GAMEPLAY_ZOOM_LEVEL = 19;
const TILE_DEGREES = 1e-4;
const NEIGHBORHOOD_SIZE = 8;
const CACHE_SPAWN_PROBABILITY = 0.1;

// Creating a map for the webpage
const map = leaflet.map(document.getElementById("map")!, {
  center: OAKES,
  zoom: GAMEPLAY_ZOOM_LEVEL,
  minZoom: GAMEPLAY_ZOOM_LEVEL,
  maxZoom: GAMEPLAY_ZOOM_LEVEL,
  zoomControl: false,
  scrollWheelZoom: false,
});

// Adding a tile layer to the map
leaflet
  .tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution:
      '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  })
  .addTo(map);

// Making the player marker
const playerIcon = leaflet.icon({
  iconUrl: new URL("./images/playerArrow.png", import.meta.url).toString(),
  iconSize: [24, 24],
  iconAnchor: [16, 32],
});

const playerMarker = leaflet.marker(OAKES, { icon: playerIcon });
playerMarker.bindTooltip("You are here!");
playerMarker.addTo(map);

// Displaying the player's points
let playerPoints = 0;
const statusPanel = document.querySelector<HTMLDivElement>("#statusPanel")!;
statusPanel.innerHTML = "You have no coins yet.";

// Adding caches to the map
function spawnCache(i: number, j: number) {
  // Convert cell numbers into lat/lng bounds
  const origin = OAKES;
  const bounds = leaflet.latLngBounds([
    [origin.lat + i * TILE_DEGREES, origin.lng + j * TILE_DEGREES],
    [origin.lat + (i + 1) * TILE_DEGREES, origin.lng + (j + 1) * TILE_DEGREES],
  ]);

  // Add rectangular areas on map to represent caches
  const rects = leaflet.rectangle(bounds);
  rects.bindTooltip("You found a cache!");
  rects.addTo(map);

  // Add interaction with the caches
  rects.bindPopup(() => {
    // Each cache has random point valuable
    let pointVal = Math.floor(luck([i, j, "initialValue"].toString()) * 100);

    // Popup gives details of cache
    const popupDiv = document.createElement("div");
    popupDiv.innerHTML = `
            <div> This cache is at "${i}, ${j}" and contains <span id="value">${pointVal}</span> coin(s). </div>
            <button id="poke" style="color: lightblue;">Collect</button>
            <button id="deposit" style="color: lightblue;">Deposit</button>`;

    // Clicking the button will increase the player's points and decrease the cache's value
    popupDiv.querySelector("#poke")!.addEventListener("click", () => {
      pointVal--;
      popupDiv.querySelector<HTMLSpanElement>("#value")!.innerHTML = pointVal
        .toString();
      playerPoints++;
      statusPanel.innerHTML = `You have ${playerPoints} coin(s).`;
    });

    // Clicking the deposit button will deposit the player's points in the cache
    popupDiv.querySelector("#deposit")!.addEventListener("click", () => {
      pointVal++;
      popupDiv.querySelector<HTMLSpanElement>("#value")!.innerHTML = pointVal
        .toString();
      playerPoints--;
      statusPanel.innerHTML = `You have ${playerPoints} coin(s).`;
    });

    return popupDiv;
  });
}

// Look around the player's neighborhood for caches to spawn
for (let i = -NEIGHBORHOOD_SIZE; i < NEIGHBORHOOD_SIZE; i++) {
  for (let j = -NEIGHBORHOOD_SIZE; j < NEIGHBORHOOD_SIZE; j++) {
    if (luck([i, j].toString()) < CACHE_SPAWN_PROBABILITY) {
      spawnCache(i, j);
    }
  }
}
