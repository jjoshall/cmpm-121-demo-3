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
    iconUrl: new URL("./images/coin.png", import.meta.url).toString(),
    iconSize: [32, 32],
    iconAnchor: [12, 12],
  });

  // Draw is now purely about placing the marker
  draw(bounds: leaflet.LatLngBounds, extrinsicState: CellExtrinsicState): void {
    const marker = leaflet.marker(bounds.getCenter(), { icon: CacheCell.icon });
    marker.addTo(map);

    // Delegate UI logic to a dedicated handler
    CacheCellUIHandler.handlePopup(marker, extrinsicState);
  }
}

class CacheCellUIHandler {
  static handlePopup(
    marker: leaflet.Marker,
    extrinsicState: CellExtrinsicState,
  ) {
    const popupDiv = document.createElement("div");
    popupDiv.innerHTML = CacheCellUIHandler.generatePopupHtml(extrinsicState);

    popupDiv.querySelector("#collect")!.addEventListener("click", () => {
      CacheCellUIHandler.collectCoin(extrinsicState);
      CacheCellUIHandler.refreshPopup(marker, extrinsicState);
    });

    popupDiv.querySelector("#deposit")!.addEventListener("click", () => {
      CacheCellUIHandler.depositCoin(extrinsicState);
      CacheCellUIHandler.refreshPopup(marker, extrinsicState);
    });

    marker.bindPopup(popupDiv);
  }

  static generatePopupHtml(extrinsicState: CellExtrinsicState): string {
    // Generates HTML content for the popup without binding any behavior
    const { i, j, coins } = extrinsicState;
    const coinListHtml = coins
      .map(
        (coin, index) =>
          `<li>${index + 1}. ${coin.i}:${coin.j}#${coin.serial}</li>`,
      )
      .join("");
    return `
        <div>This cache is at "${i}, ${j}".</div>
        <div>Coins in cache:</div>
        <ul>${coinListHtml || "<li>No coins</li>"}</ul>
        <button id="collect" style="color: lightblue;">Collect Coin</button>
        <button id="deposit" style="color: lightblue;">Deposit Coin</button>
    `;
  }

  static collectCoin(extrinsicState: CellExtrinsicState) {
    if (extrinsicState.coins.length === 0) {
      alert("This cache has no coins to collect!");
      return;
    }
    const coin = extrinsicState.coins.pop()!;
    playerCoins.push(coin);
    updateStatusPanel();
    saveGameState();
  }

  static depositCoin(extrinsicState: CellExtrinsicState) {
    if (playerCoins.length === 0) {
      alert("You have no coins to deposit!");
      return;
    }
    const coin = playerCoins.pop()!;
    extrinsicState.coins.push(coin);
    updateStatusPanel();
    saveGameState();
  }

  static refreshPopup(
    marker: leaflet.Marker,
    extrinsicState: CellExtrinsicState,
  ) {
    // Regenerate the popup content
    const updatedPopupHtml = CacheCellUIHandler.generatePopupHtml(
      extrinsicState,
    );

    // Update the marker's popup content
    marker.setPopupContent(updatedPopupHtml);

    // Optionally reopen the popup if it's closed
    if (!marker.isPopupOpen()) {
      marker.openPopup();
    }
  }
}

// Reference to movement buttons
const northButton = document.getElementById("north")!;
const southButton = document.getElementById("south")!;
const westButton = document.getElementById("west")!;
const eastButton = document.getElementById("east")!;

const geoButton = document.getElementById("sensor")!;

const resetButton = document.getElementById("reset")!;

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

// Update the movement history whenever the player moves
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
  updateMovementHistory();

  // Save game state to localStorage
  saveGameState();
}

// Array to store the player's movement history
const movementHistory: leaflet.LatLng[] = [OAKES];

// Polyline to show the player's movement history
const movementPolyline = leaflet
  .polyline(movementHistory, {
    color: "limegreen",
    weight: 3,
  })
  .addTo(map);

// Function to update the movement history
function updateMovementHistory() {
  movementHistory.push(leaflet.latLng(currentLat, currentLng));
  movementPolyline.setLatLngs(movementHistory);
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

geoButton.addEventListener("click", () => {
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        currentLat = latitude;
        currentLng = longitude;
        playerMarker.setLatLng([currentLat, currentLng]);
        map.panTo([currentLat, currentLng]);
        updateStatusPanel();
        updateMovementHistory();
        updateVisibleCaches();
      },
      (error) => {
        console.error("Error getting geolocation: ", error);
        alert("Unable to retrieve your location.");
      },
    );
  } else {
    alert("Geolocation is not supported by this browser.");
  }
});

resetButton.addEventListener("click", () => {
  prompt("Are you sure you want to reset the game? Type 'yes' to confirm.") ===
      "yes"
    ? resetGame()
    : alert("Game reset canceled.");
});

function resetGame() {
  currentLat = OAKES.lat;
  currentLng = OAKES.lng;
  playerMarker.setLatLng([currentLat, currentLng]);
  map.panTo([currentLat, currentLng]);
  movementHistory.length = 0;
  movementHistory.push(OAKES);
  movementPolyline.setLatLngs(movementHistory);

  // Return all coins back to their original cache
  playerCoins.forEach((coin) => {
    const cellKey = `${coin.i},${coin.j}`;
    const extrinsicState = cellStates.get(cellKey);
    if (extrinsicState) {
      extrinsicState.coins.push(coin);
    }
  });
  playerCoins.length = 0;

  // Ensure all caches return their coins to their original state
  cellStates.forEach((extrinsicState) => {
    extrinsicState.coins.forEach((coin) => {
      const originalCellKey = `${coin.i},${coin.j}`;
      const originalExtrinsicState = cellStates.get(originalCellKey);
      if (originalExtrinsicState && originalExtrinsicState !== extrinsicState) {
        originalExtrinsicState.coins.push(coin);
      }
    });
    extrinsicState.coins = extrinsicState.coins.filter(
      (coin) =>
        `${coin.i},${coin.j}` === `${extrinsicState.i},${extrinsicState.j}`,
    );
  });

  updateStatusPanel();
  updateVisibleCaches();
}

// Ensure the player's marker element supports smooth movement
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
    const numCoins = Math.floor(luck([i, j, "initialCoins"].toString()) * 6); // 0 to 5 coins
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
    .map(
      (coin) =>
        `<span class="coin" data-coin-id="${coin.i}:${coin.j}#${coin.serial}">${coin.i}:${coin.j}#${coin.serial}</span>`,
    )
    .join(", ") || "No coins";
  statusPanel.innerHTML = `Your coins: ${coinList}`;

  // Add event listeners to each coin
  document.querySelectorAll(".coin").forEach((coinElement) => {
    coinElement.addEventListener("click", () => {
      const coinId = coinElement.getAttribute("data-coin-id")!;
      const [i, j, serial] = coinId.split(/[:#]/).map(Number);
      const coin = playerCoins.find(
        (c) => c.i === i && c.j === j && c.serial === serial,
      );
      if (coin) {
        handleCoinClick(coin);
      }
    });
  });
}
updateStatusPanel();

// Function to handle clicking on a coin in the player's inventory
function handleCoinClick(coin: Coin) {
  const cacheLat = coin.i * TILE_DEGREES + TILE_DEGREES / 2;
  const cacheLng = coin.j * TILE_DEGREES + TILE_DEGREES / 2;
  map.setView([cacheLat, cacheLng], GAMEPLAY_ZOOM_LEVEL);

  alert(`Showing ${coin.i}:${coin.j}#${coin.serial}'s original cache.`);
}

// Add CSS to change cursor on hover
const style = document.createElement("style");
style.innerHTML = `
  .coin:hover {
    cursor: pointer;
  }
`;
document.head.appendChild(style);

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

// Memento interface
interface Memento {
  getState(): Map<string, CellExtrinsicState>;
}

// Concrete Memento class
class ConcreteMemento implements Memento {
  private state: Map<string, CellExtrinsicState>;

  constructor(state: Map<string, CellExtrinsicState>) {
    // Deep copy the state to ensure immutability
    this.state = new Map(state);
  }

  getState(): Map<string, CellExtrinsicState> {
    return this.state;
  }
}

// Originator class
class Originator {
  private state: Map<string, CellExtrinsicState>;

  constructor(state: Map<string, CellExtrinsicState>) {
    this.state = state;
  }

  save(): Memento {
    return new ConcreteMemento(this.state);
  }

  restore(memento: Memento): void {
    this.state = memento.getState();
    // Redraw all caches based on the restored state
    updateVisibleCaches();
  }
}

// Caretaker class
class Caretaker {
  private mementos: Memento[] = [];
  private originator: Originator;

  constructor(originator: Originator) {
    this.originator = originator;
  }

  backup(): void {
    this.mementos.push(this.originator.save());
  }

  undo(): void {
    if (!this.mementos.length) {
      return;
    }
    const memento = this.mementos.pop()!;
    this.originator.restore(memento);
  }
}

// Initialize the originator and caretaker
const originator = new Originator(cellStates);
const caretaker = new Caretaker(originator);

// Example usage: Save and restore state
document.getElementById("saveState")!.addEventListener("click", () => {
  caretaker.backup();
  alert("State saved!");
});

document.getElementById("restoreState")!.addEventListener("click", () => {
  caretaker.undo();
  alert("State restored!");
});

// Save game state to localStorage
// Tried getting help from Nathan Shturm's code but this saving and loading game state is not working
function saveGameState() {
  const gameState = {
    playerLocation: {
      lat: currentLat,
      lng: currentLng,
    },
    movementHistory: movementHistory.map((latlng) => ({
      lat: latlng.lat,
      lng: latlng.lng,
    })),
    playerCoins: playerCoins.map((coin) => ({ ...coin })),
    cellStates: Array.from(cellStates.entries()).map(([key, value]) => [
      key,
      { ...value, coins: value.coins.map((coin) => ({ ...coin })) },
    ]),
  };

  localStorage.setItem("geocoinGameState", JSON.stringify(gameState));
}

// Load game state from localStorage
function loadGameState() {
  const savedState = localStorage.getItem("geocoinGameState");

  if (savedState) {
    const gameState = JSON.parse(savedState);

    // Restore player location
    currentLat = gameState.playerLocation.lat;
    currentLng = gameState.playerLocation.lng;

    // Restore movement history
    movementHistory.length = 0;
    gameState.movementHistory.forEach((loc: { lat: number; lng: number }) => {
      movementHistory.push(leaflet.latLng(loc.lat, loc.lng));
    });

    if (movementHistory.length > 0) {
      movementPolyline.setLatLngs(movementHistory);
    }

    // Restore player inventory
    playerCoins.length = 0;
    gameState.playerCoins.forEach((coin: Coin) => {
      playerCoins.push(coin);
    });

    // Restore cell states
    cellStates.clear();
    gameState.cellStates.forEach(
      ([key, value]: [string, CellExtrinsicState]) => {
        cellStates.set(key, {
          ...value,
          coins: value.coins.map((coin) => ({ ...coin })),
        });
      },
    );

    updateStatusPanel();

    // Refresh player marker and map position
    playerMarker.setLatLng([currentLat, currentLng]);
    map.panTo([currentLat, currentLng]);

    updateVisibleCaches();
  } else {
    updateVisibleCaches();
  }
}

// Load game state on initialization
self.addEventListener("load", loadGameState);

if (movementHistory.length === 0) {
  movementHistory.push(leaflet.latLng(currentLat, currentLng));
}
