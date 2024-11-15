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

  draw(bounds: leaflet.LatLngBounds, extrinsicState: CellExtrinsicState): void {
    // Use the shared icon
    const marker = leaflet.marker(bounds.getCenter(), { icon: CacheCell.icon });
    marker.bindTooltip("You found a cache!");
    marker.addTo(map);

    // Use extrinsic state for unique data
    this.setupInteraction(marker, extrinsicState);
  }

  private setupInteraction(
    marker: leaflet.Marker,
    extrinsicState: CellExtrinsicState,
  ): void {
    marker.bindPopup(() => {
      const { i, j, coins } = extrinsicState;

      // Popup content
      const popupDiv = document.createElement("div");
      const coinListHtml = coins
        .map(
          (coin, index) =>
            `<li>${index + 1}. ${coin.i}:${coin.j}#${coin.serial}</li>`,
        )
        .join("");

      popupDiv.innerHTML = `
        <div>This cache is at "${i}, ${j}".</div>
        <div>Coins in cache:</div>
        <ul>${coinListHtml || "<li>No coins</li>"}</ul>
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
        marker.closePopup();
        marker.openPopup();
      });

      popupDiv.querySelector("#deposit")!.addEventListener("click", () => {
        if (playerCoins.length === 0) {
          alert("You have no coins to deposit!");
          return;
        }
        // Remove a coin from the player's coins and add it to the cache
        const coin = playerCoins.pop()!;
        coins.push(coin);
        updateStatusPanel();
        alert(
          `Deposited coin into cache at (${i}, ${j}) with new serial ${coin.serial}. Coin ID: ${coin.i}:${coin.j}#${coin.serial}`,
        );
        // Update the popup content
        marker.closePopup();
        marker.openPopup();
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
