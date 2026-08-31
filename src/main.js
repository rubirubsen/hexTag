import maplibregl from 'maplibre-gl';
import * as h3 from 'h3-js';

// --- GAME CONFIGURATION ---
const H3_RESOLUTION = 10; // ~40m Kantenlaenge, optimal fuer Bushaltestellen
const CAPTURE_TIME_SECONDS = 180; // 3 Minuten Regelzeit
const PASSIVE_XP_PER_MINUTE = 10;

// State
let userColor = '#ff0055';
let userLocation = { lat: 52.520008, lng: 13.404954 }; // Default: Berlin Alexanderplatz
let currentHexId = null;
let captureSeconds = 0;
let totalXp = 0;
let isSimulating = false;

// Hexagon Storage: hexId -> { owner: string, color: string, capturedAt: number }
const capturedHexes = new Map();

// UI Elements
const timerDisplay = document.getElementById('timerDisplay');
const progressFillBar = document.getElementById('progressFillBar');
const currentHexLabel = document.getElementById('currentHexLabel');
const captureStatusText = document.getElementById('captureStatusText');
const totalXpDisplay = document.getElementById('totalXpDisplay');
const gpsStatus = document.getElementById('gpsStatus');
const toast = document.getElementById('toast');
const userColorDot = document.getElementById('userColorDot');

// --- 1. INITIALIZE MAP (Dark Theme) ---
const map = new maplibregl.Map({
  container: 'map',
  style: {
    version: 8,
    sources: {
      'carto-dark': {
        type: 'raster',
        tiles: [
          'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
          'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
          'https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png'
        ],
        tileSize: 256,
        attribution: '&copy; OpenStreetMap &copy; CARTO'
      }
    },
    layers: [
      {
        id: 'carto-dark-layer',
        type: 'raster',
        source: 'carto-dark',
        minzoom: 0,
        maxzoom: 20
      }
    ]
  },
  center: [userLocation.lng, userLocation.lat],
  zoom: 17,
  pitch: 45,
  bearing: -15
});

// Custom Player GPS Marker
const markerEl = document.createElement('div');
markerEl.className = 'user-marker';
const playerMarker = new maplibregl.Marker({ element: markerEl })
  .setLngLat([userLocation.lng, userLocation.lat])
  .addTo(map);

// --- 2. MAP LOAD & HEX LAYERS ---
map.on('load', () => {
  console.log('[hexTag] Karte geladen. Initialisiere H3-Waben-Layer...');

  // Hex GeoJSON Source
  map.addSource('hex-grid', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] }
  });

  // 1. Hex Fill Layer (Gefuellte Farben & Eroberungs-Status)
  map.addLayer({
    id: 'hex-fill',
    type: 'fill',
    source: 'hex-grid',
    paint: {
      'fill-color': ['get', 'fillColor'],
      'fill-opacity': ['get', 'fillOpacity']
    }
  });

  // 2. Hex Outer Borders (Cyber Glow Outline)
  map.addLayer({
    id: 'hex-borders',
    type: 'line',
    source: 'hex-grid',
    paint: {
      'line-color': ['get', 'strokeColor'],
      'line-width': ['get', 'strokeWidth'],
      'line-opacity': 0.85
    }
  });

  // Initial Grid Update
  updateHexGrid(userLocation.lat, userLocation.lng);
  startGeolocation();
});

// --- 3. H3 GRID & GEOJSON GENERATION ---
function updateHexGrid(lat, lng) {
  try {
    const centerHex = h3.latLngToCell(lat, lng, H3_RESOLUTION);
    const nearbyHexes = h3.gridDisk(centerHex, 3); // 3 Ringe um den Spieler

    const features = nearbyHexes.map(hex => {
      // Koordinaten der 6 Waben-Ecken abrufen [lat, lng] -> [lng, lat] fuer GeoJSON
      const boundary = h3.cellToBoundary(hex).map(([bLat, bLng]) => [bLng, bLat]);
      boundary.push(boundary[0]); // Polygon schliessen

      const isCurrent = hex === currentHexId;
      const captured = capturedHexes.get(hex);

      let fillColor = '#000000';
      let fillOpacity = 0.05;
      let strokeColor = 'rgba(0, 240, 255, 0.2)';
      let strokeWidth = 1.5;

      if (captured) {
        fillColor = captured.color;
        fillOpacity = 0.45;
        strokeColor = captured.color;
        strokeWidth = 2.5;
      }

      if (isCurrent) {
        const progress = Math.min(captureSeconds / CAPTURE_TIME_SECONDS, 1.0);
        strokeColor = userColor;
        strokeWidth = 3.5;

        if (!captured) {
          fillColor = userColor;
          fillOpacity = 0.15 + progress * 0.45; // Dynamischer Fuell-Effekt waehrend Eroberung
        }
      }

      return {
        type: 'Feature',
        properties: {
          hexId: hex,
          fillColor,
          fillOpacity,
          strokeColor,
          strokeWidth
        },
        geometry: {
          type: 'Polygon',
          coordinates: [boundary]
        }
      };
    });

    const source = map.getSource('hex-grid');
    if (source) {
      source.setData({ type: 'FeatureCollection', features });
    }
  } catch (err) {
    console.error('[hexTag] Fehler beim Aktualisieren der Waben:', err);
  }
}

// --- 4. GPS & STANDORTVERARBEITUNG ---
function startGeolocation() {
  if (!navigator.geolocation) {
    gpsStatus.textContent = 'GPS: NICHT UNTERSTÜTZT (SIMULATION)';
    return;
  }

  navigator.geolocation.watchPosition(
    (pos) => {
      if (isSimulating) return; // Simulation nicht ueberschreiben

      const { latitude, longitude, accuracy } = pos.coords;
      userLocation = { lat: latitude, lng: longitude };

      playerMarker.setLngLat([longitude, latitude]);
      gpsStatus.textContent = `GPS: ±${Math.round(accuracy)}m GENAU`;

      handlePositionChange(latitude, longitude);
    },
    (err) => {
      console.warn('[hexTag] GPS-Fehler oder blockiert:', err.message);
      gpsStatus.textContent = 'GPS: SIMULATION AKTIV';
      handlePositionChange(userLocation.lat, userLocation.lng);
    },
    { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 }
  );
}

function handlePositionChange(lat, lng) {
  const newHex = h3.latLngToCell(lat, lng, H3_RESOLUTION);

  if (newHex !== currentHexId) {
    currentHexId = newHex;
    currentHexLabel.textContent = `HEX: ${newHex.slice(-6).toUpperCase()}`;

    // Reset Capture Timer beim Wabenwechsel
    captureSeconds = 0;
    showToast(`ZONE BETRETEN: ${newHex.slice(-6).toUpperCase()}`);
    console.log(`[hexTag] Wabe betreten: ${newHex}`);
  }

  updateHexGrid(lat, lng);
}

// --- 5. CAPTURE & PASSIVE TICK LOOP (Jede Sekunde) ---
setInterval(() => {
  if (!currentHexId) return;

  const captured = capturedHexes.get(currentHexId);

  // Fall A: Wabe gehoert dem Spieler bereits -> Passives Einkommen generieren
  if (captured && captured.color === userColor) {
    timerDisplay.textContent = 'EROIL';
    timerDisplay.style.color = '#39ff14';
    timerDisplay.textContent = 'EROIL';
    timerDisplay.textContent = 'GEHALTEN';
    progressFillBar.style.width = '100%';
    captureStatusText.textContent = 'Wabe in deinem Besitz! Du erhaeltst XP.';

    // Minutentakt fuer XP (+10 XP alle 60 Sek)
    captureSeconds++;
    if (captureSeconds % 60 === 0) {
      totalXp += PASSIVE_XP_PER_MINUTE;
      totalXpDisplay.textContent = totalXp;
      showToast(`+${PASSIVE_XP_PER_MINUTE} XP ERHALTEN!`);
    }
  } 
  // Fall B: Wabe wird aktiv erobert
  else {
    captureSeconds++;
    const progress = Math.min(captureSeconds / CAPTURE_TIME_SECONDS, 1.0);
    const remaining = Math.max(0, CAPTURE_TIME_SECONDS - captureSeconds);

    const min = Math.floor(remaining / 60);
    const sec = remaining % 60;
    timerDisplay.textContent = `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
    timerDisplay.style.color = 'var(--accent-cyan)';
    progressFillBar.style.width = `${(progress * 100).toFixed(1)}%`;
    captureStatusText.textContent = `Eroberung laeuft... (${(progress * 100).toFixed(0)}%)`;

    // Visuelles Update der Waben-Fuellung
    updateHexGrid(userLocation.lat, userLocation.lng);

    // 100% erreicht -> Wabe erobern!
    if (captureSeconds >= CAPTURE_TIME_SECONDS) {
      completeCapture(currentHexId);
    }
  }
}, 1000);

function completeCapture(hexId) {
  capturedHexes.set(hexId, {
    owner: 'TAGGER_01',
    color: userColor,
    capturedAt: Date.now()
  });

  totalXp += 50; // Einmaliger Eroberungs-Bonus
  totalXpDisplay.textContent = totalXp;

  showToast(`🎉 WABE ${hexId.slice(-6).toUpperCase()} EROBERT! (+50 XP)`);
  updateHexGrid(userLocation.lat, userLocation.lng);
}

// --- 6. UI INTERAKTIONEN & TEST-BUTTONS ---
function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3200);
}

// Farbwechsel
document.querySelectorAll('.color-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    document.querySelectorAll('.color-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    userColor = btn.dataset.color;
    document.documentElement.style.setProperty('--user-color', userColor);
    userColorDot.style.background = userColor;
    userColorDot.style.boxShadow = `0 0 12px ${userColor}`;

    updateHexGrid(userLocation.lat, userLocation.lng);
    showToast(`Farbe gewechselt auf ${btn.title}`);
  });
});

// GPS Zentrieren
document.getElementById('btnCenterMap').addEventListener('click', () => {
  map.flyTo({ center: [userLocation.lng, userLocation.lat], zoom: 17, speed: 1.5 });
});

// Test-Move Simulation (Klick auf Karte oder Test-Button)
document.getElementById('btnSimulateMove').addEventListener('click', () => {
  isSimulating = true;
  // Bewege Spieler zufaellig ca 60 Meter in eine Richtung
  const dLat = (Math.random() - 0.5) * 0.0008;
  const dLng = (Math.random() - 0.5) * 0.0008;

  userLocation.lat += dLat;
  userLocation.lng += dLng;

  playerMarker.setLngLat([userLocation.lng, userLocation.lat]);
  map.easeTo({ center: [userLocation.lng, userLocation.lat] });
  handlePositionChange(userLocation.lat, userLocation.lng);
});

// Klick auf die Karte bewegt Spieler im Testmodus sofort
map.on('click', (e) => {
  isSimulating = true;
  userLocation.lat = e.lngLat.lat;
  userLocation.lng = e.lngLat.lng;

  playerMarker.setLngLat([userLocation.lng, userLocation.lat]);
  handlePositionChange(userLocation.lat, userLocation.lng);
});
