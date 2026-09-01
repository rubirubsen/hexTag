import maplibregl from 'maplibre-gl';
import * as h3 from 'h3-js';
import { GraffitiCanvas } from './graffitiCanvas.js';
import { tagStore } from './tagStore.js';
import { ARViewer } from './arViewer.js';

// --- GAME CONFIGURATION ---
const H3_RESOLUTION = 10; // ~40m Kantenlaenge
const CAPTURE_TIME_SECONDS = 180; // 3 Minuten Regelzeit
const PASSIVE_XP_PER_MINUTE = 10;
const SPRAY_XP_REWARD = 20;

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
const hexTagCount = document.getElementById('hexTagCount');
const totalXpDisplay = document.getElementById('totalXpDisplay');
const gpsStatus = document.getElementById('gpsStatus');
const toast = document.getElementById('toast');
const userColorDot = document.getElementById('userColorDot');

// Modals & Panels
const sprayModal = document.getElementById('sprayModal');
const sprayModalHexLabel = document.getElementById('sprayModalHexLabel');
const galleryModal = document.getElementById('galleryModal');
const galleryHexLabel = document.getElementById('galleryHexLabel');
const galleryGrid = document.getElementById('galleryGrid');

// --- 1. INITIALIZE CANVAS & AR VIEWER ---
const sprayCanvasEl = document.getElementById('sprayCanvas');
let graffitiCanvas = null;

// Initialisiere Canvas nach erstem Rendern
setTimeout(() => {
  graffitiCanvas = new GraffitiCanvas(sprayCanvasEl);
  graffitiCanvas.setBrushColor(userColor);
}, 100);

const arContainer = document.getElementById('arContainer');
const arVideo = document.getElementById('arVideo');
const arViewer = new ARViewer(arVideo, arContainer, () => {
  console.log('[hexTag] AR-Blick beendet.');
});

// --- 2. INITIALIZE MAP (OpenStreetMap - 100% Free & No API Key) ---
const map = new maplibregl.Map({
  container: 'map',
  style: {
    version: 8,
    sources: {
      'osm-tiles': {
        type: 'raster',
        tiles: [
          'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
        ],
        tileSize: 256,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      }
    },
    layers: [
      {
        id: 'osm-layer',
        type: 'raster',
        source: 'osm-tiles',
        minzoom: 0,
        maxzoom: 19
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

// --- 3. MAP LOAD & HEX LAYERS ---
map.on('load', () => {
  console.log('[hexTag] Karte geladen. Initialisiere H3-Waben-Layer...');

  // Hex GeoJSON Source
  map.addSource('hex-grid', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] }
  });

  // 1. Hex Fill Layer
  map.addLayer({
    id: 'hex-fill',
    type: 'fill',
    source: 'hex-grid',
    paint: {
      'fill-color': ['get', 'fillColor'],
      'fill-opacity': ['get', 'fillOpacity']
    }
  });

  // 2. Hex Outer Borders
  map.addLayer({
    id: 'hex-borders',
    type: 'line',
    source: 'hex-grid',
    paint: {
      'line-color': ['get', 'strokeColor'],
      'line-width': ['get', 'strokeWidth'],
      'line-opacity': 0.9
    }
  });

  // Initial Grid Update
  updateHexGrid(userLocation.lat, userLocation.lng);
  startGeolocation();
});

// --- 4. H3 GRID & GEOJSON GENERATION ---
function updateHexGrid(lat, lng) {
  try {
    const centerHex = h3.latLngToCell(lat, lng, H3_RESOLUTION);
    const nearbyHexes = h3.gridDisk(centerHex, 3);

    const features = nearbyHexes.map(hex => {
      const boundary = h3.cellToBoundary(hex).map(([bLat, bLng]) => [bLng, bLat]);
      boundary.push(boundary[0]);

      const isCurrent = hex === currentHexId;
      const captured = capturedHexes.get(hex);
      const tagCount = tagStore.getTagCountForHex(hex);

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

      if (tagCount > 0) {
        strokeColor = '#ffe600'; // Gelb leuchtender Rand bei vorhandenen Tags
      }

      if (isCurrent) {
        const progress = Math.min(captureSeconds / CAPTURE_TIME_SECONDS, 1.0);
        strokeColor = userColor;
        strokeWidth = 3.5;

        if (!captured) {
          fillColor = userColor;
          fillOpacity = 0.15 + progress * 0.45;
        }
      }

      return {
        type: 'Feature',
        properties: {
          hexId: hex,
          fillColor,
          fillOpacity,
          strokeColor,
          strokeWidth,
          tagCount
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
    console.error('[hexTag] Fehler beim Grid-Update:', err);
  }
}

// --- 5. GPS & STANDORT ---
function startGeolocation() {
  if (!navigator.geolocation) {
    gpsStatus.textContent = 'GPS: SIMULATION AKTIV';
    return;
  }

  navigator.geolocation.watchPosition(
    (pos) => {
      if (isSimulating) return;

      const { latitude, longitude, accuracy } = pos.coords;
      userLocation = { lat: latitude, lng: longitude };

      playerMarker.setLngLat([longitude, latitude]);
      gpsStatus.textContent = `GPS: ±${Math.round(accuracy)}m`;

      handlePositionChange(latitude, longitude);
    },
    (err) => {
      console.warn('[hexTag] GPS-Fallback:', err.message);
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

    // Update Tag Counter auf dem HUD
    updateHudTagCount(newHex);

    captureSeconds = 0;
    showToast(`ZONE BETRETEN: ${newHex.slice(-6).toUpperCase()}`);
  }

  updateHexGrid(lat, lng);
}

function updateHudTagCount(hexId) {
  const count = tagStore.getTagCountForHex(hexId);
  hexTagCount.textContent = `🎨 ${count} Tag${count === 1 ? '' : 's'}`;
}

// --- 6. CAPTURE & TICK LOOP ---
setInterval(() => {
  if (!currentHexId) return;

  const captured = capturedHexes.get(currentHexId);

  if (captured && captured.color === userColor) {
    timerDisplay.textContent = 'GEHALTEN';
    timerDisplay.style.color = '#39ff14';
    progressFillBar.style.width = '100%';
    captureStatusText.textContent = 'Wabe in deinem Besitz (+10 XP/Min)';

    captureSeconds++;
    if (captureSeconds % 60 === 0) {
      totalXp += PASSIVE_XP_PER_MINUTE;
      totalXpDisplay.textContent = totalXp;
      showToast(`+${PASSIVE_XP_PER_MINUTE} XP ERHALTEN!`);
    }
  } else {
    captureSeconds++;
    const progress = Math.min(captureSeconds / CAPTURE_TIME_SECONDS, 1.0);
    const remaining = Math.max(0, CAPTURE_TIME_SECONDS - captureSeconds);

    const min = Math.floor(remaining / 60);
    const sec = remaining % 60;
    timerDisplay.textContent = `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
    timerDisplay.style.color = 'var(--accent-cyan)';
    progressFillBar.style.width = `${(progress * 100).toFixed(1)}%`;
    captureStatusText.textContent = `Eroberung: ${(progress * 100).toFixed(0)}%`;

    updateHexGrid(userLocation.lat, userLocation.lng);

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

  totalXp += 50;
  totalXpDisplay.textContent = totalXp;

  showToast(`🎉 WABE EROBERT! (+50 XP)`);
  updateHexGrid(userLocation.lat, userLocation.lng);
}

// --- 7. SPRAY MODAL & GRAFFITI ENGINE ---
const btnOpenSprayModal = document.getElementById('btnOpenSprayModal');
const btnCloseSprayModal = document.getElementById('btnCloseSprayModal');
const btnSubmitSpray = document.getElementById('btnSubmitSpray');
const btnUndoCanvas = document.getElementById('btnUndoCanvas');
const btnClearCanvas = document.getElementById('btnClearCanvas');
const brushSizeSlider = document.getElementById('brushSizeSlider');

btnOpenSprayModal.addEventListener('click', () => {
  if (!currentHexId) return;
  sprayModalHexLabel.textContent = `WABE: ${currentHexId.slice(-6).toUpperCase()}`;
  sprayModal.classList.add('active');
  if (graffitiCanvas) {
    graffitiCanvas.initCanvasSize();
    graffitiCanvas.setBrushColor(userColor);
  }
});

btnCloseSprayModal.addEventListener('click', () => {
  sprayModal.classList.remove('active');
});

// Brush Modes
document.querySelectorAll('.tool-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    if (graffitiCanvas) graffitiCanvas.setBrushMode(btn.dataset.mode);
  });
});

brushSizeSlider.addEventListener('input', (e) => {
  if (graffitiCanvas) graffitiCanvas.setBrushSize(e.target.value);
});

btnUndoCanvas.addEventListener('click', () => graffitiCanvas && graffitiCanvas.undo());
btnClearCanvas.addEventListener('click', () => graffitiCanvas && graffitiCanvas.clear());

// Graffiti Einreichen
btnSubmitSpray.addEventListener('click', () => {
  if (!graffitiCanvas || !currentHexId) return;

  const imageBase64 = graffitiCanvas.exportDataURL();
  tagStore.addTag({
    hexId: currentHexId,
    lat: userLocation.lat,
    lng: userLocation.lng,
    author: 'TAGGER_01',
    color: userColor,
    imageBase64
  });

  totalXp += SPRAY_XP_REWARD;
  totalXpDisplay.textContent = totalXp;

  showToast(`🎨 TAG ERFOLGREICH GESPRÜHT! (+${SPRAY_XP_REWARD} XP)`);
  sprayModal.classList.remove('active');
  updateHudTagCount(currentHexId);
  updateHexGrid(userLocation.lat, userLocation.lng);
});

// --- 8. HEX TAG GALLERY MODAL ---
const btnOpenHexGallery = document.getElementById('btnOpenHexGallery');
const btnCloseGalleryModal = document.getElementById('btnCloseGalleryModal');

btnOpenHexGallery.addEventListener('click', () => {
  if (!currentHexId) return;
  openGalleryForHex(currentHexId);
});

btnCloseGalleryModal.addEventListener('click', () => {
  galleryModal.classList.remove('active');
});

function openGalleryForHex(hexId) {
  galleryHexLabel.textContent = `WABE: ${hexId.slice(-6).toUpperCase()}`;
  const tags = tagStore.getTagsForHex(hexId);

  galleryGrid.innerHTML = '';
  if (tags.length === 0) {
    galleryGrid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; color: var(--text-dim); padding: 30px 0;">Noch keine Tags in dieser Wabe.<br>Sei der Erste und spraye ein Graffiti!</div>';
  } else {
    tags.forEach(t => {
      const card = document.createElement('div');
      card.className = 'gallery-card';
      card.innerHTML = `
        <img src="${t.imageBase64}" alt="Tag" />
        <div class="gallery-card-meta">
          <span style="color: ${t.color}; font-weight: bold;">${t.author}</span>
          <span>${new Date(t.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        </div>
      `;
      galleryGrid.appendChild(card);
    });
  }

  galleryModal.classList.add('active');
}

// --- 9. AR CAMERA VIEWER ---
const btnToggleAR = document.getElementById('btnToggleAR');
const btnCloseAR = document.getElementById('btnCloseAR');

btnToggleAR.addEventListener('click', () => {
  if (!currentHexId) return;
  const currentTags = tagStore.getTagsForHex(currentHexId);
  arViewer.start(currentTags);
});

btnCloseAR.addEventListener('click', () => {
  arViewer.stop();
});

// --- 10. UI HELPERS & COLOR PICKER ---
function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3000);
}

document.querySelectorAll('.color-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.color-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    userColor = btn.dataset.color;
    document.documentElement.style.setProperty('--user-color', userColor);
    userColorDot.style.background = userColor;
    userColorDot.style.boxShadow = `0 0 12px ${userColor}`;

    if (graffitiCanvas) graffitiCanvas.setBrushColor(userColor);
    updateHexGrid(userLocation.lat, userLocation.lng);
    showToast(`Farbe: ${btn.title}`);
  });
});

document.getElementById('btnCenterMap').addEventListener('click', () => {
  map.flyTo({ center: [userLocation.lng, userLocation.lat], zoom: 17, speed: 1.5 });
});

document.getElementById('btnSimulateMove').addEventListener('click', () => {
  isSimulating = true;
  const dLat = (Math.random() - 0.5) * 0.0008;
  const dLng = (Math.random() - 0.5) * 0.0008;
  userLocation.lat += dLat;
  userLocation.lng += dLng;

  playerMarker.setLngLat([userLocation.lng, userLocation.lat]);
  map.easeTo({ center: [userLocation.lng, userLocation.lat] });
  handlePositionChange(userLocation.lat, userLocation.lng);
});

map.on('click', (e) => {
  isSimulating = true;
  userLocation.lat = e.lngLat.lat;
  userLocation.lng = e.lngLat.lng;
  playerMarker.setLngLat([userLocation.lng, userLocation.lat]);
  handlePositionChange(userLocation.lat, userLocation.lng);
});
