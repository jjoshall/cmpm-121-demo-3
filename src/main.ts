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
const TILE_DEGREES = 1e-4; // Each grid cell is 0.0001 degrees wide and tall
const NEIGHBORHOOD_SIZE = 8; // Number of cells around the player to check
const CACHE_SPAWN_PROBABILITY = 0.1; // Probability of spawning a cache in a cell

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
  iconAnchor: [12, 12],
});

const playerMarker = leaflet.marker(OAKES, { icon: playerIcon });
playerMarker.bindTooltip("You are here!");
playerMarker.addTo(map);

// Functions to convert between coordinates and grid indices
function latToI(lat: number): number {
  return Math.floor(lat / TILE_DEGREES);
}

function lngToJ(lng: number): number {
  return Math.floor(lng / TILE_DEGREES);
}

// Interface for a coin
interface Coin {
  i: number;
  j: number;
  serial: number;
}

// Flyweight interface
interface CellFlyweight {
  draw(bounds: leaflet.LatLngBounds, extrinsicState: CellExtrinsicState): void;
}

// Extrinsic state interface (includes list of coins)
interface CellExtrinsicState {
  i: number;
  j: number;
  coins: Coin[];
}

// Flyweight factory
class CellFlyweightFactory {
  private static flyweights: { [key: string]: CellFlyweight } = {};

  static getFlyweight(type: string): CellFlyweight {
    if (!(type in this.flyweights)) {
      switch (type) {
        case "cache":
          this.flyweights[type] = new CacheCell();
          break;
        // Add other types as needed
        default:
          throw new Error(`Flyweight type "${type}" not recognized.`);
      }
    }
    return this.flyweights[type];
  }
}

// Concrete flyweight for cache cells
class CacheCell implements CellFlyweight {
  // Intrinsic state (shared among all cache cells)
  private static icon = leaflet.icon({
    iconUrl: new URL("./images/cacheIcon.png", import.meta.url).toString(),
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });

  draw(bounds: leaflet.LatLngBounds, extrinsicState: CellExtrinsicState): void {
    // Use the shared icon
    const rect = leaflet.rectangle(bounds, { color: "blue", weight: 1 });
    rect.bindTooltip("You found a cache!");
    rect.addTo(map);

    // Use extrinsic state for unique data
    this.setupInteraction(rect, extrinsicState);
  }

  private setupInteraction(
    rect: leaflet.Rectangle,
    extrinsicState: CellExtrinsicState,
  ): void {
    rect.bindPopup(() => {
      const { i, j, coins } = extrinsicState;

      // Generate a list of coin IDs using the compact format
      const coinList = coins.map((coin) =>
        `${coin.i}:${coin.j}#${coin.serial}`
      ).join(", ") ||
        "No coins";

      // Popup content
      const popupDiv = document.createElement("div");
      popupDiv.innerHTML = `
        <div>This cache is at "${i}, ${j}".</div>
        <div>Coins in cache: ${coinList}</div>
        <button id="collect" style="color: lightblue;">Collect Coin</button>
        <button id="deposit" style="color: lightblue;">Deposit Coin</button>`;

      // Event listeners
      popupDiv.querySelector("#collect")!.addEventListener("click", () => {
        if (coins.length === 0) {
          alert("This cache has no coins to collect!");
          return;
        }
        // Remove a coin from the cache and add it to the player's coins
        const coin = coins.pop()!;
        playerCoins.push(coin);
        updateStatusPanel();
        alert(
          `Collected coin ${coin.i}:${coin.j}#${coin.serial} from cache at (${i}, ${j}).`,
        );
        // Update the popup content
        rect.closePopup();
        rect.openPopup();
      });

      popupDiv.querySelector("#deposit")!.addEventListener("click", () => {
        if (playerCoins.length === 0) {
          alert("You have no coins to deposit!");
          return;
        }
        // Remove a coin from the player's coins and add it to the cache
        const coin = playerCoins.pop()!;
        // Update the coin's location to this cache
        coin.i = i;
        coin.j = j;
        coin.serial = coins.length; // Assign new serial number in this cache
        coins.push(coin);
        updateStatusPanel();
        alert(
          `Deposited coin into cache at (${i}, ${j}) with new serial ${coin.serial}. Coin ID: ${coin.i}:${coin.j}#${coin.serial}`,
        );
        // Update the popup content
        rect.closePopup();
        rect.openPopup();
      });

      return popupDiv;
    });
  }
}

// Reference to movement buttons
const northButton = document.getElementById("north")!;
const southButton = document.getElementById("south")!;
const westButton = document.getElementById("west")!;
const eastButton = document.getElementById("east")!;

// Player's current coordinates
let currentLat = OAKES.lat;
let currentLng = OAKES.lng;

// Player's current heading in degrees (0 = north, 90 = east, 180 = south, 270 = west)
let currentHeading = 0;

// Function to rotate the player's icon
function rotatePlayerIcon(degrees: number) {
  currentHeading = degrees;
  const element = playerMarker.getElement();
  if (element) {
    element.style.transform = `rotate(${currentHeading}deg)`;
  }
}

// Function to move the player and update the map
function movePlayer(latChange: number, lngChange: number) {
  if (latChange > 0) {
    // Moving north
    rotatePlayerIcon(0);
  } else if (latChange < 0) {
    // Moving south
    rotatePlayerIcon(180);
  } else if (lngChange > 0) {
    // Moving east
    rotatePlayerIcon(90);
  } else if (lngChange < 0) {
    // Moving west
    rotatePlayerIcon(270);
  }

  currentLat += latChange;
  currentLng += lngChange;
  playerMarker.setLatLng([currentLat, currentLng]);
  map.panTo([currentLat, currentLng]);
  updateStatusPanel();
}

// Add event listeners to buttons for movement
northButton.addEventListener("click", () => {
  movePlayer(TILE_DEGREES, 0); // Move north
});
southButton.addEventListener("click", () => {
  movePlayer(-TILE_DEGREES, 0); // Move south
});
westButton.addEventListener("click", () => {
  movePlayer(0, -TILE_DEGREES); // Move west
});
eastButton.addEventListener("click", () => {
  movePlayer(0, TILE_DEGREES); // Move east
});

// Ensure the player's marker element supports rotation
playerMarker.on("add", () => {
  if (playerMarker.getElement()) {
    playerMarker.getElement()!.style.transition = "transform 0.2s ease";
  }
});

// Map to store extrinsic states of cells
const cellStates = new Map<string, CellExtrinsicState>();

// Function to update visible caches based on player's position
function updateVisibleCaches() {
  // Clear all existing cache layers
  map.eachLayer((layer) => {
    if (layer instanceof leaflet.Rectangle) {
      map.removeLayer(layer);
    }
  });

  // Get player's current cell indices
  const playerI = latToI(currentLat);
  const playerJ = lngToJ(currentLng);

  // Spawn caches around the player
  for (let di = -NEIGHBORHOOD_SIZE; di <= NEIGHBORHOOD_SIZE; di++) {
    for (let dj = -NEIGHBORHOOD_SIZE; dj <= NEIGHBORHOOD_SIZE; dj++) {
      const i = playerI + di;
      const j = playerJ + dj;
      if (luck([i, j].toString()) < CACHE_SPAWN_PROBABILITY) {
        spawnCache(i, j);
      }
    }
  }
}

// Update visible caches whenever the player moves
map.on("moveend", updateVisibleCaches);

// Function to spawn a cache cell at global grid indices (i, j)
function spawnCache(i: number, j: number) {
  // Convert cell numbers into lat/lng bounds
  const bounds = leaflet.latLngBounds([
    [i * TILE_DEGREES, j * TILE_DEGREES],
    [(i + 1) * TILE_DEGREES, (j + 1) * TILE_DEGREES],
  ]);

  // Get the flyweight object
  const cacheCell = CellFlyweightFactory.getFlyweight("cache");

  // Generate or retrieve the extrinsic state for this cell
  const cellKey = `${i},${j}`;
  let extrinsicState = cellStates.get(cellKey);

  if (!extrinsicState) {
    // Initialize coins for this cache
    const numCoins = Math.floor(luck([i, j, "initialCoins"].toString()) * 3); // 0 to 2 coins
    const coins: Coin[] = [];
    for (let serial = 0; serial < numCoins; serial++) {
      coins.push({ i, j, serial });
    }
    extrinsicState = { i, j, coins };
    cellStates.set(cellKey, extrinsicState);
  }

  // Draw the cell using the flyweight object
  cacheCell.draw(bounds, extrinsicState);
}

// Player's current cell indices
const playerI = latToI(OAKES.lat);
const playerJ = lngToJ(OAKES.lng);

// Player's coins
const playerCoins: Coin[] = [];

// Displaying the player's coins
const statusPanel = document.querySelector<HTMLDivElement>("#statusPanel")!;
function updateStatusPanel() {
  const coinList = playerCoins
    .map((coin) => `${coin.i}:${coin.j}#${coin.serial}`)
    .join(", ") || "No coins";
  statusPanel.innerHTML = `Your coins: ${coinList}`;
}
updateStatusPanel();

// Spawning caches around the player
for (let di = -NEIGHBORHOOD_SIZE; di <= NEIGHBORHOOD_SIZE; di++) {
  for (let dj = -NEIGHBORHOOD_SIZE; dj <= NEIGHBORHOOD_SIZE; dj++) {
    const i = playerI + di;
    const j = playerJ + dj;
    if (luck([i, j].toString()) < CACHE_SPAWN_PROBABILITY) {
      spawnCache(i, j);
    }
  }
}
