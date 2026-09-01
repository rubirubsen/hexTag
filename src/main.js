import maplibregl from 'maplibre-gl';
import * as h3 from 'h3-js';
import { GraffitiCanvas } from './graffitiCanvas.js';
import { tagStore } from './tagStore.js';
import { ARViewer } from './arViewer.js';
import { DroneManager } from './droneManager.js';

// --- GAME CONFIGURATION ---
const H3_RESOLUTION = 10;
const CAPTURE_TIME_SECONDS = 180;
const PASSIVE_XP_PER_MINUTE = 10;
const SPRAY_XP_REWARD = 20;
const DRONE_DEPLOY_COST_XP = 30;

// Persistent Player Color
const SAVED_COLOR_KEY = 'hextag_user_color';
let userColor = localStorage.getItem(SAVED_COLOR_KEY) || '#ff0055';
document.documentElement.style.setProperty('--user-color', userColor);

// State
let userLocation = { lat: 52.520008, lng: 13.404954 };
let currentHexId = null;
let captureSeconds = 0;
let totalXp = 50; // Start-XP fuer erste Drohnentests
let isSimulating = false;
let isFollowingUser = true;
let watchId = null;
let isTargetingDrone = false;

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

// Desktop HQ & Drone Elements
const hqTimerVal = document.getElementById('hqTimerVal');
const hqProgressFill = document.getElementById('hqProgressFill');
const btnBuildHQ = document.getElementById('btnBuildHQ');
const hqTimerView = document.getElementById('hqTimerView');
const hqActiveView = document.getElementById('hqActiveView');
const hqActiveHex = document.getElementById('hqActiveHex');
const activeDroneCount = document.getElementById('activeDroneCount');
const btnArmDrone = document.getElementById('btnArmDrone');
const droneTargetHint = document.getElementById('droneTargetHint');

// Modals
const sprayModal = document.getElementById('sprayModal');
const sprayModalHexLabel = document.getElementById('sprayModalHexLabel');
const galleryModal = document.getElementById('galleryModal');
const galleryHexLabel = document.getElementById('galleryHexLabel');
const galleryGrid = document.getElementById('galleryGrid');

totalXpDisplay.textContent = totalXp;
userColorDot.style.background = userColor;
userColorDot.style.boxShadow = `0 0 12px ${userColor}`;

// --- 1. INITIALIZE CANVAS & AR VIEWER ---
const sprayCanvasEl = document.getElementById('sprayCanvas');
let graffitiCanvas = null;

setTimeout(() => {
  graffitiCanvas = new GraffitiCanvas(sprayCanvasEl);
  graffitiCanvas.setBrushColor(userColor);
}, 100);

const arContainer = document.getElementById('arContainer');
const arVideo = document.getElementById('arVideo');
const arViewer = new ARViewer(arVideo, arContainer, () => {
  console.log('[hexTag] AR beendet.');
});

// --- 2. INITIALIZE MAP (OpenStreetMap - 100% Free & No Key) ---
const map = new maplibregl.Map({
  container: 'map',
  style: {
    version: 8,
    sources: {
      'osm-tiles': {
        type: 'raster',
        tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
        tileSize: 256,
        attribution: '&copy; OpenStreetMap contributors'
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
  zoom: 17.5,
  pitch: 40,
  bearing: -15
});

const markerEl = document.createElement('div');
markerEl.className = 'user-marker';
const playerMarker = new maplibregl.Marker({ element: markerEl })
  .setLngLat([userLocation.lng, userLocation.lat])
  .addTo(map);

// --- 3. DRONE & HQ MANAGER ---
let droneManager = null;

map.on('load', () => {
  console.log('[hexTag] Initialisiere Map & Drohnen-Manager...');

  droneManager = new DroneManager(map, handleDroneManagerUpdate);

  map.addSource('hex-grid', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] }
  });

  map.addLayer({
    id: 'hex-fill',
    type: 'fill',
    source: 'hex-grid',
    paint: {
      'fill-color': ['get', 'fillColor'],
      'fill-opacity': ['get', 'fillOpacity']
    }
  });

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

  updateHexGrid(userLocation.lat, userLocation.lng);
  startGeolocation();
  syncColorButtons();
});

// --- 4. H3 GRID & GEOJSON ---
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

      // Pruefen, ob aktive Drohne in der Wabe ist
      const hasDrone = droneManager && droneManager.drones.some(d => d.targetHexId === hex);

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

      if (hasDrone) {
        fillColor = userColor;
        fillOpacity = 0.35;
        strokeColor = '#00f0ff';
        strokeWidth = 3;
      }

      if (tagCount > 0) {
        strokeColor = '#ffe600';
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
    console.error('[hexTag] Fehler beim Grid-Update:', err);
  }
}

// --- 5. GPS & STANDORTVERARBEITUNG ---
async function startGeolocation() {
  try {
    const ipRes = await fetch('https://ipapi.co/json/');
    if (ipRes.ok) {
      const ipData = await ipRes.json();
      if (ipData.latitude && ipData.longitude && !isSimulating) {
        userLocation = { lat: ipData.latitude, lng: ipData.longitude };
        playerMarker.setLngLat([userLocation.lng, userLocation.lat]);
        if (isFollowingUser) map.setCenter([userLocation.lng, userLocation.lat]);
        handlePositionChange(userLocation.lat, userLocation.lng);
        gpsStatus.textContent = `ORT: ${ipData.city || 'ERMITTELT'}`;
      }
    }
  } catch (e) {
    console.log('[hexTag] IP-Lookup uebersprungen:', e);
  }

  if (!navigator.geolocation) {
    gpsStatus.textContent = 'GPS: NICHT UNTERSTÜTZT';
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (pos) => applyGPSUpdate(pos, true),
    (err) => console.warn('[hexTag] getCurrentPosition:', err.message),
    { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
  );

  if (watchId) navigator.geolocation.clearWatch(watchId);
  watchId = navigator.geolocation.watchPosition(
    (pos) => applyGPSUpdate(pos, false),
    (err) => console.warn('[hexTag] WatchPosition:', err.message),
    { enableHighAccuracy: true, maximumAge: 1000, timeout: 10000 }
  );
}

function applyGPSUpdate(pos, isInstantJump = false) {
  if (isSimulating) return;

  const { latitude, longitude, accuracy } = pos.coords;
  userLocation = { lat: latitude, lng: longitude };

  playerMarker.setLngLat([longitude, latitude]);
  gpsStatus.textContent = `GPS: ±${Math.round(accuracy)}m`;

  if (isFollowingUser) {
    if (isInstantJump) {
      map.flyTo({ center: [longitude, latitude], zoom: 17.5, pitch: 40, speed: 1.8 });
    } else {
      map.easeTo({ center: [longitude, latitude], duration: 800 });
    }
  }

  handlePositionChange(latitude, longitude);
}

map.on('dragstart', () => {
  isFollowingUser = false;
  const btn = document.getElementById('btnCenterMap');
  if (btn) btn.classList.add('needs-center');
});

function handlePositionChange(lat, lng) {
  const newHex = h3.latLngToCell(lat, lng, H3_RESOLUTION);

  if (newHex !== currentHexId) {
    currentHexId = newHex;
    currentHexLabel.textContent = `HEX: ${newHex.slice(-6).toUpperCase()}`;
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

// --- 6. GAME LOOP (Sekundentakt) ---
setInterval(() => {
  // Drone & HQ Update
  if (droneManager) {
    droneManager.update(1);
  }

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

// --- 7. DESKTOP HQ & DROHNEN LOGIK ---
function handleDroneManagerUpdate(data) {
  // HQ UI
  if (data.hq) {
    hqTimerView.style.display = 'none';
    hqActiveView.style.display = 'block';
    hqActiveHex.textContent = `WABE: ${data.hq.hexId.slice(-6).toUpperCase()}`;
  } else {
    hqTimerView.style.display = 'block';
    hqActiveView.style.display = 'none';

    const min = Math.floor(data.hqTimerSeconds / 60);
    const sec = data.hqTimerSeconds % 60;
    const reqMin = Math.floor(data.hqTimerRequired / 60);
    const reqSec = data.hqTimerRequired % 60;
    hqTimerVal.textContent = `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')} / ${String(reqMin).padStart(2, '0')}:${String(reqSec).padStart(2, '0')}`;

    const progress = Math.min(data.hqTimerSeconds / data.hqTimerRequired, 1.0);
    hqProgressFill.style.width = `${(progress * 100).toFixed(0)}%`;

    if (data.isHqEligible) {
      btnBuildHQ.disabled = false;
      btnBuildHQ.textContent = '⚡ HQ HIER ERRICHTEN!';
    }
  }

  // Drohnen Counter
  activeDroneCount.textContent = `${data.activeDrones.length} AKTIV`;
}

btnBuildHQ.addEventListener('click', () => {
  if (!currentHexId || !droneManager) return;

  droneManager.saveHQ({
    hexId: currentHexId,
    lat: userLocation.lat,
    lng: userLocation.lng,
    name: 'STÜTZPUNKT ALPHA',
    color: userColor,
    createdAt: Date.now()
  });

  showToast('🏢 STÜTZPUNKT ERFOLGREICH ERRICHTET!');
});

btnArmDrone.addEventListener('click', () => {
  if (totalXp < DRONE_DEPLOY_COST_XP) {
    showToast(`⚠️ Nicht genug XP! Du benötigst ${DRONE_DEPLOY_COST_XP} XP.`);
    return;
  }

  isTargetingDrone = !isTargetingDrone;
  droneTargetHint.style.display = isTargetingDrone ? 'block' : 'none';
  btnArmDrone.style.background = isTargetingDrone ? '#ffe600' : '';
  btnArmDrone.style.color = isTargetingDrone ? '#000' : '#fff';

  if (isTargetingDrone) {
    showToast('🎯 Klicke auf eine Wabe auf der Karte!');
  }
});

// Map Click: Drohnen-Entsendung ODER Waben-Inspektion
map.on('click', (e) => {
  const clickedHex = h3.latLngToCell(e.lngLat.lat, e.lngLat.lng, H3_RESOLUTION);
  const [tLat, tLng] = h3.cellToLatLng(clickedHex);

  // Drohne entsenden
  if (isTargetingDrone && droneManager) {
    isTargetingDrone = false;
    droneTargetHint.style.display = 'none';
    btnArmDrone.style.background = '';
    btnArmDrone.style.color = '#fff';

    totalXp -= DRONE_DEPLOY_COST_XP;
    totalXpDisplay.textContent = totalXp;

    droneManager.deployDrone({
      targetHexId: clickedHex,
      targetLat: tLat,
      targetLng: tLng,
      color: userColor
    });

    // Drohne erobert Wabe waehrend des Einsatzes
    capturedHexes.set(clickedHex, {
      owner: 'DROHNE (HQ)',
      color: userColor,
      capturedAt: Date.now()
    });

    showToast(`🛸 DROHNE (✖) ZU WABE ${clickedHex.slice(-4).toUpperCase()} ENTSANDT!`);
    updateHexGrid(userLocation.lat, userLocation.lng);
    return;
  }

  // Normaler Waben-Inspektor
  const captured = capturedHexes.get(clickedHex);
  const tagCount = tagStore.getTagCountForHex(clickedHex);

  if (clickedHex === currentHexId) {
    showToast(`📍 Deine aktuelle Wabe (${clickedHex.slice(-6).toUpperCase()})`);
  } else if (captured) {
    showToast(`🛡️ Wabe ${clickedHex.slice(-6).toUpperCase()} gehört ${captured.owner}`);
  } else {
    showToast(`⬡ Freie Wabe ${clickedHex.slice(-6).toUpperCase()}`);
  }

  if (tagCount > 0) {
    openGalleryForHex(clickedHex);
  }
});

// --- 8. SPRAY MODAL & GRAFFITI ---
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

  showToast(`🎨 TAG GESPRÜHT! (+${SPRAY_XP_REWARD} XP)`);
  sprayModal.classList.remove('active');
  updateHudTagCount(currentHexId);
  updateHexGrid(userLocation.lat, userLocation.lng);
});

// --- 9. GALLERY & AR ---
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
    galleryGrid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; color: var(--text-dim); padding: 30px 0;">Noch keine Tags vorhanden.</div>';
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

btnToggleAR.addEventListener('click', () => {
  if (!currentHexId) return;
  const currentTags = tagStore.getTagsForHex(currentHexId);
  arViewer.start(currentTags);
});

btnCloseAR.addEventListener('click', () => arViewer.stop());

// --- 10. COLOR PICKER & HELPERS ---
function syncColorButtons() {
  document.querySelectorAll('.color-btn').forEach(btn => {
    if (btn.dataset.color === userColor) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
}

document.querySelectorAll('.color-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    userColor = btn.dataset.color;
    localStorage.setItem(SAVED_COLOR_KEY, userColor);

    document.documentElement.style.setProperty('--user-color', userColor);
    userColorDot.style.background = userColor;
    userColorDot.style.boxShadow = `0 0 12px ${userColor}`;

    syncColorButtons();

    if (graffitiCanvas) graffitiCanvas.setBrushColor(userColor);
    updateHexGrid(userLocation.lat, userLocation.lng);
    showToast(`Farbe gewählt: ${btn.title}`);
  });
});

document.getElementById('btnCenterMap').addEventListener('click', () => {
  isFollowingUser = true;
  const btn = document.getElementById('btnCenterMap');
  if (btn) btn.classList.remove('needs-center');

  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        applyGPSUpdate(pos, true);
        showToast('🛰️ GPS ZENTRIERT & GEKOPPELT!');
      },
      (err) => {
        map.flyTo({ center: [userLocation.lng, userLocation.lat], zoom: 17.5, pitch: 40, speed: 1.6 });
      },
      { enableHighAccuracy: true, timeout: 5000 }
    );
  } else {
    map.flyTo({ center: [userLocation.lng, userLocation.lat], zoom: 17.5, pitch: 40, speed: 1.6 });
  }
});

function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3000);
}
