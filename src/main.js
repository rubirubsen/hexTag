import maplibregl from 'maplibre-gl';
import * as h3 from 'h3-js';
import { GraffitiCanvas } from './graffitiCanvas.js';
import { tagStore } from './tagStore.js';
import { ARViewer } from './arViewer.js';
import { DroneManager } from './droneManager.js';
import { DataBitsManager } from './dataBitsManager.js';
import { PoiManager } from './poiManager.js';
import { soundEngine } from './soundEngine.js';

// --- GAME CONFIGURATION ---
const H3_RESOLUTION = 10;
const CAPTURE_TIME_SECONDS = 180;
const PASSIVE_XP_PER_MINUTE = 10;
const SPRAY_XP_REWARD = 20;
const DRONE_DEPLOY_COST_XP = 30;

// Persistent Player State Keys
const SAVED_COLOR_KEY = 'hextag_user_color';
const SAVED_XP_KEY = 'hextag_user_xp';
const SAVED_GUEST_NAME_KEY = 'hextag_guest_name';
const LOCAL_ZONES_KEY = 'hextag_local_zones';

let userColor = localStorage.getItem(SAVED_COLOR_KEY) || '#ff8000';
document.documentElement.style.setProperty('--user-color', userColor);

// Current User Auth State
let currentUser = null;

// State
let userLocation = { lat: 52.520008, lng: 13.404954 };
let currentHexId = null;
let captureSeconds = 0;
let totalXp = parseInt(localStorage.getItem(SAVED_XP_KEY), 10);
if (isNaN(totalXp)) totalXp = 50;

let isSimulating = false;
let isFollowingUser = true;
let watchId = null;
let isTargetingDrone = false;

// Hexagon Storage: hexId -> { owner: string, color: string, capturedAt: number }
const capturedHexes = new Map();

function loadLocalZones() {
  try {
    const saved = localStorage.getItem(LOCAL_ZONES_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      parsed.forEach(([hexId, data]) => {
        capturedHexes.set(hexId, data);
      });
    }
  } catch (e) {
    console.warn('[hexTag] Error loading local zones:', e);
  }
}
loadLocalZones();

export function saveLocalZones() {
  try {
    localStorage.setItem(LOCAL_ZONES_KEY, JSON.stringify(Array.from(capturedHexes.entries())));
  } catch (e) {
    console.warn('[hexTag] Error saving local zones:', e);
  }
}

// UI Elements
const captureCard = document.getElementById('captureCard');
const timerDisplay = document.getElementById('timerDisplay');
const progressFillBar = document.getElementById('progressFillBar');
const currentHexLabel = document.getElementById('currentHexLabel');
const captureStatusText = document.getElementById('captureStatusText');
const hexTagCount = document.getElementById('hexTagCount');
const totalXpDisplay = document.getElementById('totalXpDisplay');
const dataBitsDisplay = document.getElementById('dataBitsDisplay');
const btnToggleSound = document.getElementById('btnToggleSound');
const btnToggleHud = document.getElementById('btnToggleHud');
const btnRestoreHud = document.getElementById('btnRestoreHud');
const soundIcon = document.getElementById('soundIcon');
const floatingRewardsContainer = document.getElementById('floatingRewardsContainer');
const gpsStatus = document.getElementById('gpsStatus');
const toast = document.getElementById('toast');
const userColorDot = document.getElementById('userColorDot');
const playerName = document.getElementById('playerName');

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

// POI Node Modal Elements
const nodeModal = document.getElementById('nodeModal');
const btnCloseNodeModal = document.getElementById('btnCloseNodeModal');
const nodeModalTitle = document.getElementById('nodeModalTitle');
const nodeModalName = document.getElementById('nodeModalName');
const nodeModalTypeIcon = document.getElementById('nodeModalTypeIcon');
const nodeModalTypeTag = document.getElementById('nodeModalTypeTag');
const nodeModalHex = document.getElementById('nodeModalHex');
const nodeModalDistance = document.getElementById('nodeModalDistance');
const nodeOwnerText = document.getElementById('nodeOwnerText');
const nodeShieldText = document.getElementById('nodeShieldText');
const nodeTurretLevel = document.getElementById('nodeTurretLevel');
const btnBuyBuilding = document.getElementById('btnBuyBuilding');
const nodeUpgradesSection = document.getElementById('nodeUpgradesSection');
const btnUpgradeTurret = document.getElementById('btnUpgradeTurret');
const btnUpgradeShield = document.getElementById('btnUpgradeShield');
const btnUpgradeBeacon = document.getElementById('btnUpgradeBeacon');
const btnNodeSpray = document.getElementById('btnNodeSpray');
const btnNodeSendDrone = document.getElementById('btnNodeSendDrone');

// Auth Modal
const authModal = document.getElementById('authModal');
const btnOpenAuthModal = document.getElementById('btnOpenAuthModal');
const btnCloseAuthModal = document.getElementById('btnCloseAuthModal');
const loggedOutView = document.getElementById('loggedOutView');
const loggedInView = document.getElementById('loggedInView');
const profileAvatar = document.getElementById('profileAvatar');
const profileUsername = document.getElementById('profileUsername');
const profileProvider = document.getElementById('profileProvider');
const profileXp = document.getElementById('profileXp');
const btnGuestLogin = document.getElementById('btnGuestLogin');
const guestUsernameInput = document.getElementById('guestUsernameInput');
const guestPasswordInput = document.getElementById('guestPasswordInput');
const guestLoginError = document.getElementById('guestLoginError');
const ssoLinkSection = document.getElementById('ssoLinkSection');
const profileHexCountMini = document.getElementById('profileHexCountMini');
const profileHexCountBadge = document.getElementById('profileHexCountBadge');
const profileHexList = document.getElementById('profileHexList');
const btnLogout = document.getElementById('btnLogout');

totalXpDisplay.textContent = totalXp;
userColorDot.style.background = userColor;
userColorDot.style.boxShadow = `0 0 12px ${userColor}`;

// Floating Reward FX
export function spawnFloatingReward(text, color = '#ffe600') {
  if (!floatingRewardsContainer) return;
  const el = document.createElement('div');
  el.className = 'floating-reward-item';
  el.style.color = color;
  el.style.left = `${window.innerWidth / 2 + (Math.random() - 0.5) * 80}px`;
  el.style.top = `${window.innerHeight * 0.62}px`;
  el.textContent = text;
  floatingRewardsContainer.appendChild(el);
  setTimeout(() => el.remove(), 1600);
}

if (btnToggleSound) {
  if (soundIcon) soundIcon.textContent = soundEngine.isMuted ? '🔇' : '🔊';
  btnToggleSound.addEventListener('click', () => {
    const isMuted = soundEngine.toggleMute();
    if (soundIcon) soundIcon.textContent = isMuted ? '🔇' : '🔊';
    showToast(isMuted ? '🔇 Soundeffekte stummgeschaltet' : '🔊 Soundeffekte aktiviert');
  });
}

// --- 1. AUTH & SSO PROFILE SYSTEM ---
export function addXP(amount, reason = '') {
  totalXp = Math.max(0, totalXp + amount);
  totalXpDisplay.textContent = totalXp;
  localStorage.setItem(SAVED_XP_KEY, totalXp);

  const calculatedLevel = Math.floor(totalXp / 100) + 1;
  if (currentUser) {
    currentUser.xp = totalXp;
    currentUser.level = calculatedLevel;
    profileXp.textContent = `${totalXp} XP • LEVEL ${calculatedLevel}`;
    syncProfileToServer({ xp: totalXp, level: calculatedLevel });
  }

  if (amount > 0) {
    spawnFloatingReward(`+${amount} XP`, '#ffe600');
    if (reason) showToast(`${reason} (+${amount} XP)`);
  } else if (amount < 0 && reason) {
    showToast(`${reason} (${amount} XP)`);
  }
}

async function syncProfileToServer(updates = {}) {
  try {
    const res = await fetch('/api/auth/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates)
    });
    if (res.ok) {
      const data = await res.json();
      if (data.user) {
        currentUser = data.user;
      }
    }
  } catch (e) {
    console.log('[Auth] Profile-Sync offline/gepuffert:', e);
  }
}

function formatTimeAgo(timestamp) {
  if (!timestamp) return 'Unbekannt';
  const diffSec = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (diffSec < 60) return 'Gerade eben';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `Vor ${diffMin} Min.`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `Vor ${diffHours} Std.`;
  return new Date(timestamp).toLocaleDateString([], { day: '2-digit', month: '2-digit' });
}

export function isZoneOwnedByMe(zone) {
  if (!zone) return false;
  if (currentUser) {
    if (zone.owner_id && (zone.owner_id === currentUser.id || zone.owner_id === `local_${currentUser.username.toLowerCase()}`)) {
      return true;
    }
    if (zone.owner && zone.owner.toLowerCase() === currentUser.username.toLowerCase()) {
      return true;
    }
    return false;
  }
  const savedGuest = localStorage.getItem(SAVED_GUEST_NAME_KEY);
  if (savedGuest && zone.owner && zone.owner.toLowerCase() === savedGuest.toLowerCase()) {
    return true;
  }
  return false;
}

function renderProfileTerritory() {
  if (!profileHexList) return;

  const myHexes = [];

  for (const [hexId, zone] of capturedHexes.entries()) {
    if (isZoneOwnedByMe(zone)) {
      myHexes.push({
        hexId,
        color: zone.color || userColor,
        capturedAt: zone.capturedAt || zone.captured_at,
        owner: zone.owner || zone.owner_name
      });
    }
  }

  const countText = `${myHexes.length} ${myHexes.length === 1 ? 'Wabe' : 'Waben'}`;
  if (profileHexCountMini) profileHexCountMini.textContent = `⬡ ${countText}`;
  if (profileHexCountBadge) profileHexCountBadge.textContent = countText.toUpperCase();

  profileHexList.innerHTML = '';

  if (myHexes.length === 0) {
    profileHexList.innerHTML = `
      <div class="empty-territory-msg">
        <span class="empty-territory-icon">⬡</span>
        <strong class="empty-territory-title">Keine besetzten Waben</strong>
        <p class="empty-territory-sub">Bewege dich zu einer freien Wabe und halte sie 3 Minuten, um dein Revier zu markieren!</p>
      </div>
    `;
    return;
  }

  // Neueste Eroberungen zuerst
  myHexes.sort((a, b) => (b.capturedAt || 0) - (a.capturedAt || 0));

  myHexes.forEach(hex => {
    const tagCount = tagStore.getTagCountForHex(hex.hexId);
    const shortCode = hex.hexId.slice(-6).toUpperCase();
    const timeAgo = formatTimeAgo(hex.capturedAt);

    const item = document.createElement('div');
    item.className = 'profile-hex-item';
    item.innerHTML = `
      <div class="profile-hex-left">
        <span class="profile-hex-icon" style="color: ${hex.color}; text-shadow: 0 0 10px ${hex.color}">⬢</span>
        <div class="profile-hex-info">
          <strong class="profile-hex-title">WABE #${shortCode}</strong>
          <span class="profile-hex-meta">⏱️ ${timeAgo} • 🎨 ${tagCount} Tag${tagCount === 1 ? '' : 's'}</span>
        </div>
      </div>
      <button class="profile-hex-jump-btn" title="Auf Karte anspringen">ZENTRIEREN ❯</button>
    `;

    item.addEventListener('click', () => {
      try {
        const [lat, lng] = h3.cellToLatLng(hex.hexId);
        isFollowingUser = false;
        const btn = document.getElementById('btnCenterMap');
        if (btn) btn.classList.add('needs-center');

        map.flyTo({ center: [lng, lat], zoom: 18, pitch: 45, speed: 1.6 });
        authModal.classList.remove('active');
        showToast(`📍 WABE #${shortCode} AUF DER KARTE ZENTRIERT`);
      } catch (err) {
        console.error('[hexTag] Error flying to hex:', err);
      }
    });

    profileHexList.appendChild(item);
  });
}

async function checkAuthStatus() {
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.has('login')) {
    showToast('🎉 Erfolgreich angemeldet & Konto verknüpft!');
    window.history.replaceState({}, document.title, window.location.pathname);
  } else if (urlParams.has('error')) {
    showToast('⚠️ SSO-Anmeldung fehlgeschlagen.');
    window.history.replaceState({}, document.title, window.location.pathname);
  }

  try {
    const res = await fetch('/api/auth/me');
    const data = await res.json();
    if (data.authenticated && data.user) {
      setLoggedInUser(data.user);
    } else {
      setLoggedOut();
    }
  } catch (e) {
    console.log('[Auth] API im Offline/Standalone Modus:', e);
    setLoggedOut();
  }
}

function setLoggedInUser(user) {
  currentUser = user;
  playerName.textContent = user.username.toUpperCase();
  userColor = user.color || userColor;
  localStorage.setItem(SAVED_COLOR_KEY, userColor);

  totalXp = user.xp !== undefined ? user.xp : totalXp;
  localStorage.setItem(SAVED_XP_KEY, totalXp);
  totalXpDisplay.textContent = totalXp;

  loggedOutView.style.display = 'none';
  loggedInView.style.display = 'block';

  profileUsername.textContent = user.username;
  profileAvatar.src = user.avatar_url || 'https://api.dicebear.com/7.x/bottts/svg?seed=' + user.username;
  profileProvider.textContent = (user.sso_provider || 'SSO').toUpperCase();
  profileXp.textContent = `${totalXp} XP • LEVEL ${user.level || Math.floor(totalXp / 100) + 1}`;

  // SSO Verknuepfung anzeigen, wenn noch Gast
  if (ssoLinkSection) {
    ssoLinkSection.style.display = user.sso_provider === 'guest' ? 'block' : 'none';
  }

  renderProfileTerritory();

  document.documentElement.style.setProperty('--user-color', userColor);
  userColorDot.style.background = userColor;
  userColorDot.style.boxShadow = `0 0 12px ${userColor}`;
  syncColorButtons();

  showToast(`Willkommen, ${user.username}!`);
}

function setLoggedOut() {
  currentUser = null;
  const savedGuest = localStorage.getItem(SAVED_GUEST_NAME_KEY);
  playerName.textContent = savedGuest ? savedGuest.toUpperCase() : 'LOGIN ❯';
  loggedOutView.style.display = 'block';
  loggedInView.style.display = 'none';
  if (ssoLinkSection) ssoLinkSection.style.display = 'none';
  renderProfileTerritory();
}

btnOpenAuthModal.addEventListener('click', () => {
  if (guestLoginError) guestLoginError.style.display = 'none';
  renderProfileTerritory();
  authModal.classList.add('active');
});

btnCloseAuthModal.addEventListener('click', () => {
  authModal.classList.remove('active');
});

btnGuestLogin.addEventListener('click', async () => {
  const customName = guestUsernameInput.value.trim();
  const password = guestPasswordInput ? guestPasswordInput.value.trim() : '';

  if (!customName || customName.length < 2) {
    if (guestLoginError) {
      guestLoginError.textContent = '⚠️ Bitte gib einen Spielernamen ein (mind. 2 Zeichen).';
      guestLoginError.style.display = 'block';
    }
    return;
  }

  if (!password || password.length < 3) {
    if (guestLoginError) {
      guestLoginError.textContent = '⚠️ Bitte gib ein Passwort/PIN ein (mind. 3 Zeichen) zum Reservieren deines Namens.';
      guestLoginError.style.display = 'block';
    }
    return;
  }

  if (guestLoginError) guestLoginError.style.display = 'none';
  localStorage.setItem(SAVED_GUEST_NAME_KEY, customName);

  try {
    const res = await fetch('/api/auth/guest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: customName, password, color: userColor })
    });
    const data = await res.json();
    if (res.ok && data.success && data.user) {
      setLoggedInUser(data.user);
      if (guestPasswordInput) guestPasswordInput.value = '';
      authModal.classList.remove('active');
    } else {
      if (guestLoginError) {
        guestLoginError.textContent = `⚠️ ${data.error || 'Fehler beim Anmelden'}`;
        guestLoginError.style.display = 'block';
      }
    }
  } catch (err) {
    console.error(err);
    // Offline Fallback
    setLoggedInUser({
      id: `local_${customName.toLowerCase()}`,
      username: customName,
      color: userColor,
      xp: totalXp,
      level: Math.floor(totalXp / 100) + 1,
      sso_provider: 'guest (offline)'
    });
    if (guestPasswordInput) guestPasswordInput.value = '';
    authModal.classList.remove('active');
  }
});

btnLogout.addEventListener('click', async () => {
  try {
    await fetch('/api/auth/logout');
  } catch (e) {}
  localStorage.removeItem(SAVED_GUEST_NAME_KEY);
  setLoggedOut();
  renderProfileTerritory();
  updateHexGrid(userLocation.lat, userLocation.lng);
  if (captureCard) captureCard.classList.remove('is-held');
  captureSeconds = 0;
  authModal.classList.remove('active');
  showToast('Erfolgreich abgemeldet.');
});

// --- 2. INITIALIZE CANVAS & AR VIEWER ---
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

// --- 3. INITIALIZE MAP (OpenStreetMap - 100% Free & No Key) ---
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

// --- 4. DRONE, DATA BITS & POI MANAGERS ---
let droneManager = null;
let dataBitsManager = null;
let poiManager = null;
let activeSelectedPoi = null;

map.on('load', () => {
  console.log('[hexTag] Initialisiere Map, SSO, DataBits & OSM POIs...');

  droneManager = new DroneManager(map, handleDroneManagerUpdate);

  dataBitsManager = new DataBitsManager(map, (data) => {
    if (dataBitsDisplay) {
      dataBitsDisplay.textContent = `💎 ${data.totalBits}`;
    }
    if (data.gained) {
      soundEngine.playBitCollect();
      spawnFloatingReward(`+${data.gained} 💎`, '#00f0ff');
      showToast(`✨ +${data.gained} ENERGY BITS GESAMMELT!`);
    }
  });
  if (dataBitsDisplay && dataBitsManager) {
    dataBitsDisplay.textContent = `💎 ${dataBitsManager.totalBits}`;
  }

  poiManager = new PoiManager(map, (poi, fort) => {
    openNodeControlModal(poi, fort);
  });

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

  // Initialize Data Bits layers on top of hex grid
  if (dataBitsManager) {
    dataBitsManager.initSourceAndLayers();
    dataBitsManager.spawnNearbyBits(userLocation.lat, userLocation.lng);
  }
  if (poiManager) {
    poiManager.fetchNearbyPOIs(userLocation.lat, userLocation.lng);
  }

  checkAuthStatus();
  fetchServerZones();
  updateHexGrid(userLocation.lat, userLocation.lng);
  startGeolocation();
  syncColorButtons();

  // Handle responsive resizing (e.g. Chrome DevTools Device Mode toggle)
  window.addEventListener('resize', () => {
    if (map) map.resize();
  });
  const mapEl = document.getElementById('map');
  if (window.ResizeObserver && mapEl) {
    new ResizeObserver(() => {
      if (map) map.resize();
    }).observe(mapEl);
  }

  // Refresh grid when user moves the map
  map.on('moveend', () => {
    const center = map.getCenter();
    updateHexGrid(center.lat, center.lng);
  });
});

// Sync Zones with Backend
async function fetchServerZones() {
  try {
    const res = await fetch('/api/zones');
    if (res.ok) {
      const zones = await res.json();
      zones.forEach(z => {
        capturedHexes.set(z.hex_id, {
          owner: z.owner_name || 'Tagger',
          color: z.color || '#ff8000',
          capturedAt: z.captured_at
        });
      });
      saveLocalZones();
      updateHexGrid(userLocation.lat, userLocation.lng);
      renderProfileTerritory();
    }
  } catch (e) {
    console.log('[hexTag] Server-Zonen Offline (verwende lokalen Speicher):', e);
  }
}

// --- 5. H3 GRID & GEOJSON ---
function updateHexGrid(lat, lng) {
  try {
    const centerHex = h3.latLngToCell(lat, lng, H3_RESOLUTION);
    const nearbyHexes = h3.gridDisk(centerHex, 5); // 5 rings = 91 hexes (~700m radius)

    const features = nearbyHexes.map(hex => {
      const boundary = h3.cellToBoundary(hex).map(([bLat, bLng]) => [bLng, bLat]);
      boundary.push(boundary[0]);

      const isCurrent = hex === currentHexId;
      const captured = capturedHexes.get(hex);
      const tagCount = tagStore.getTagCountForHex(hex);
      const hasDrone = droneManager && droneManager.drones.some(d => d.targetHexId === hex);

      let fillColor = '#ff8000';
      let fillOpacity = 0.04;
      let strokeColor = 'rgba(255, 128, 0, 0.45)';
      let strokeWidth = 2.0;

      if (captured) {
        fillColor = captured.color;
        fillOpacity = 0.45;
        strokeColor = captured.color;
        strokeWidth = 2.8;
      }

      if (hasDrone) {
        fillColor = userColor;
        fillOpacity = 0.35;
        strokeColor = '#ff8000';
        strokeWidth = 3;
      }

      if (tagCount > 0) {
        strokeColor = '#ffe600';
        strokeWidth = 2.5;
      }

      if (isCurrent) {
        const progress = Math.min(captureSeconds / CAPTURE_TIME_SECONDS, 1.0);
        strokeColor = userColor;
        strokeWidth = 3.8;

        if (!captured) {
          fillColor = userColor;
          fillOpacity = 0.20 + progress * 0.45;
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

// --- 6. GPS & TRACKING ---
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
  document.body.classList.add('map-dragging');
  const btn = document.getElementById('btnCenterMap');
  if (btn) btn.classList.add('needs-center');
});

map.on('dragend', () => {
  document.body.classList.remove('map-dragging');
});

function handlePositionChange(lat, lng) {
  const newHex = h3.latLngToCell(lat, lng, H3_RESOLUTION);

  if (newHex !== currentHexId) {
    currentHexId = newHex;
    currentHexLabel.textContent = `HEX: ${newHex.slice(-6).toUpperCase()}`;
    updateHudTagCount(newHex);

    const existingZone = capturedHexes.get(newHex);
    const isMine = isZoneOwnedByMe(existingZone);

    // If already owned by player, start immediately as held!
    if (isMine) {
      captureSeconds = CAPTURE_TIME_SECONDS;
      if (captureCard) captureCard.classList.add('is-held');
      timerDisplay.textContent = '🛡️ GEHALTEN';
      timerDisplay.style.color = '#39ff14';
      progressFillBar.style.width = '100%';
      captureStatusText.textContent = 'Wabe in deinem Besitz (+10 XP/Min)';
      showToast(`🛡️ DEIN REVIER: ${newHex.slice(-6).toUpperCase()}`);
    } else {
      captureSeconds = 0;
      if (captureCard) captureCard.classList.remove('is-held');
      showToast(`ZONE BETRETEN: ${newHex.slice(-6).toUpperCase()}`);
    }
  }

  updateHexGrid(lat, lng);

  if (dataBitsManager) {
    dataBitsManager.spawnNearbyBits(lat, lng);
    dataBitsManager.update(lat, lng);
  }
  if (poiManager) {
    poiManager.fetchNearbyPOIs(lat, lng);
  }
}

function updateHudTagCount(hexId) {
  const count = tagStore.getTagCountForHex(hexId);
  hexTagCount.textContent = `🎨 ${count} Tag${count === 1 ? '' : 's'}`;
}

// --- 7. GAME LOOP ---
setInterval(() => {
  if (droneManager) droneManager.update(1);
  if (dataBitsManager) dataBitsManager.update(userLocation.lat, userLocation.lng);
  if (!currentHexId) return;

  const captured = capturedHexes.get(currentHexId);
  const isMine = isZoneOwnedByMe(captured);

  if (isMine) {
    if (captureCard) captureCard.classList.add('is-held');
    timerDisplay.textContent = '🛡️ GEHALTEN';
    timerDisplay.style.color = '#39ff14';
    progressFillBar.style.width = '100%';
    captureStatusText.textContent = 'Wabe in deinem Besitz (+10 XP/Min)';

    captureSeconds++;
    if (captureSeconds % 60 === 0) {
      addXP(PASSIVE_XP_PER_MINUTE, '⏱️ WABE GEHALTEN');
    }
  } else {
    if (captureCard) captureCard.classList.remove('is-held');
    captureSeconds++;
    const progress = Math.min(captureSeconds / CAPTURE_TIME_SECONDS, 1.0);
    const remaining = Math.max(0, CAPTURE_TIME_SECONDS - captureSeconds);

    const min = Math.floor(remaining / 60);
    const sec = remaining % 60;
    timerDisplay.textContent = `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
    timerDisplay.style.color = 'var(--accent-orange)';
    progressFillBar.style.width = `${(progress * 100).toFixed(1)}%`;
    captureStatusText.textContent = `Eroberung: ${(progress * 100).toFixed(0)}%`;

    updateHexGrid(userLocation.lat, userLocation.lng);

    if (captureSeconds >= CAPTURE_TIME_SECONDS) {
      completeCapture(currentHexId);
    }
  }
}, 1000);

async function completeCapture(hexId) {
  const currentName = currentUser?.username || localStorage.getItem(SAVED_GUEST_NAME_KEY) || 'TAGGER_01';
  const ownerId = currentUser?.id || (localStorage.getItem(SAVED_GUEST_NAME_KEY) ? `guest_${localStorage.getItem(SAVED_GUEST_NAME_KEY)}` : 'guest_anon');

  capturedHexes.set(hexId, {
    owner: currentName,
    owner_id: ownerId,
    color: userColor,
    capturedAt: Date.now()
  });
  saveLocalZones();
  soundEngine.playCaptureComplete();

  // Server-Sync
  try {
    const res = await fetch('/api/zones/capture', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hexId, color: userColor, ownerName: currentName })
    });
    if (res.ok) {
      const data = await res.json();
      if (data.user) {
        currentUser = data.user;
      }
    }
  } catch (e) {
    console.log('[hexTag] Offline Capture Sync:', e);
  }

  if (dataBitsManager) {
    dataBitsManager.totalBits = Math.min(dataBitsManager.maxBitsCapacity, dataBitsManager.totalBits + 25);
    dataBitsManager.saveBitsCount();
    if (dataBitsDisplay) dataBitsDisplay.textContent = `💎 ${dataBitsManager.totalBits}`;
  }

  addXP(50, '🎉 WABE EROBERT! (+25 💎 Bits)');
  updateHexGrid(userLocation.lat, userLocation.lng);
  renderProfileTerritory();
}

// --- 8. DESKTOP HQ & DROHNEN LOGIK ---
function handleDroneManagerUpdate(data) {
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

  activeDroneCount.textContent = `${data.activeDrones || 0} AKTIV`;
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

// Map Click
map.on('click', (e) => {
  const clickedHex = h3.latLngToCell(e.lngLat.lat, e.lngLat.lng, H3_RESOLUTION);
  const [tLat, tLng] = h3.cellToLatLng(clickedHex);

  if (isTargetingDrone && droneManager) {
    isTargetingDrone = false;
    droneTargetHint.style.display = 'none';
    btnArmDrone.style.background = '';
    btnArmDrone.style.color = '#fff';

    addXP(-DRONE_DEPLOY_COST_XP, '🛸 DROHNE ENTSANDT');

    droneManager.deployDrone({
      targetHexId: clickedHex,
      targetLat: tLat,
      targetLng: tLng,
      color: userColor
    });

    capturedHexes.set(clickedHex, {
      owner: 'DROHNE (HQ)',
      color: userColor,
      capturedAt: Date.now()
    });

    showToast(`🛸 DROHNE (✖) ZU WABE ${clickedHex.slice(-4).toUpperCase()} ENTSANDT!`);
    updateHexGrid(userLocation.lat, userLocation.lng);
    return;
  }

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

// --- 9. SPRAY MODAL & GRAFFITI ---
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

btnSubmitSpray.addEventListener('click', async () => {
  if (!graffitiCanvas || !currentHexId) return;

  const imageBase64 = graffitiCanvas.exportDataURL();
  const authorName = currentUser ? currentUser.username : 'TAGGER_01';

  tagStore.addTag({
    hexId: currentHexId,
    lat: userLocation.lat,
    lng: userLocation.lng,
    author: authorName,
    color: userColor,
    imageBase64
  });

  // Server Tag Sync
  try {
    const res = await fetch('/api/tags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        hexId: currentHexId,
        lat: userLocation.lat,
        lng: userLocation.lng,
        color: userColor,
        imageBase64,
        author: authorName
      })
    });
    if (res.ok) {
      const data = await res.json();
      if (data.user) {
        currentUser = data.user;
      }
    }
  } catch (e) {
    console.log('[hexTag] Offline Tag Sync:', e);
  }

  addXP(SPRAY_XP_REWARD, '🎨 TAG GESPRÜHT!');
  sprayModal.classList.remove('active');
  updateHudTagCount(currentHexId);
  updateHexGrid(userLocation.lat, userLocation.lng);
});

// --- 10. GALLERY & AR ---
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
        <img src="${t.imageBase64 || t.image_data}" alt="Tag" />
        <div class="gallery-card-meta">
          <span style="color: ${t.color}; font-weight: bold;">${t.author}</span>
          <span>${new Date(t.timestamp || t.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
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

function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3000);
}

// --- 12. POI NODE CONTROL & TOWER DEFENSE ---
map.on('click', async (e) => {
  if (isTargetingDrone) return;

  const { lng, lat } = e.lngLat;
  showToast('🔍 Scanne Gebäude & Adresse...');

  try {
    const pointData = await poiManager.resolvePoint(lat, lng);
    openNodeControlModal(pointData);
  } catch (err) {
    console.error('[PoiManager] Click resolve error:', err);
  }
});

function openNodeControlModal(poi, fort) {
  activeSelectedPoi = poi;
  const currentFort = poiManager ? poiManager.getFortification(poi.id) : (fort || {});
  const isOwned = currentFort.isOwned || false;
  const currentName = currentUser?.username || localStorage.getItem(SAVED_GUEST_NAME_KEY) || 'TAGGER_01';
  const isMine = isOwned && currentFort.owner && currentFort.owner.toLowerCase() === currentName.toLowerCase();
  const dist = poiManager ? poiManager.getDistanceMeters(userLocation.lat, userLocation.lng, poi.lat, poi.lng) : 0;

  if (nodeModalTitle) nodeModalTitle.textContent = `${poi.icon || '🏢'} ${poi.category || 'KNOTENPUNKT'}`;
  if (nodeModalName) nodeModalName.textContent = poi.name || 'Cyber Gebäude';
  if (nodeModalTypeIcon) nodeModalTypeIcon.textContent = poi.icon || '🏢';
  if (nodeModalTypeTag) nodeModalTypeTag.textContent = poi.category || 'GEBÄUDE-KOMPLEX';
  if (nodeModalHex) nodeModalHex.textContent = `WABE: #${(poi.hexId || '000000').slice(-6).toUpperCase()}`;
  if (nodeModalDistance) nodeModalDistance.textContent = `📍 ${Math.round(dist)}m`;

  if (nodeOwnerText) {
    if (isMine) {
      nodeOwnerText.textContent = '🏢 IN DEINEM BESITZ';
      nodeOwnerText.style.color = '#39ff14';
    } else if (isOwned) {
      nodeOwnerText.textContent = `GEHÖRT: ${(currentFort.owner || 'TAGGER').toUpperCase()}`;
      nodeOwnerText.style.color = currentFort.color || '#ff0055';
    } else {
      nodeOwnerText.textContent = 'FREIES GEBÄUDE';
      nodeOwnerText.style.color = 'var(--text-dim)';
    }
  }

  if (nodeShieldText) nodeShieldText.textContent = `${currentFort.shieldHp || 0} / 100 HP`;
  if (nodeTurretLevel) nodeTurretLevel.textContent = currentFort.turretLevel > 0 ? `LVL ${currentFort.turretLevel} (AKTIV)` : 'LVL 0 (AUS)';

  // Show/Hide Buy Button vs Upgrade Options
  if (btnBuyBuilding) {
    btnBuyBuilding.style.display = isMine ? 'none' : 'block';
    btnBuyBuilding.textContent = isOwned ? '⚔️ GEBÄUDE ÜBERNEHMEN (100 💎 BITS)' : '🏢 DIESES GEBÄUDE KAUFEN (75 💎 BITS)';
  }

  if (nodeUpgradesSection) {
    nodeUpgradesSection.style.display = isMine ? 'flex' : 'none';
  }

  if (nodeModal) nodeModal.classList.add('active');
}

if (btnBuyBuilding) {
  btnBuyBuilding.addEventListener('click', () => {
    if (!activeSelectedPoi || !dataBitsManager || !poiManager) return;
    const currentFort = poiManager.getFortification(activeSelectedPoi.id);
    const cost = currentFort.isOwned ? 100 : 75;

    if (!dataBitsManager.spendBits(cost)) {
      showToast(`⚠️ Nicht genug Energy Bits! (Benötigt ${cost} 💎)`);
      return;
    }

    const currentName = currentUser?.username || localStorage.getItem(SAVED_GUEST_NAME_KEY) || 'TAGGER_01';
    const ownerId = currentUser?.id || (localStorage.getItem(SAVED_GUEST_NAME_KEY) ? `guest_${localStorage.getItem(SAVED_GUEST_NAME_KEY)}` : 'guest_anon');
    poiManager.buyBuilding(activeSelectedPoi, currentName, userColor);

    // Also claim the building's hex zone for the player!
    capturedHexes.set(activeSelectedPoi.hexId, {
      owner: currentName,
      owner_id: ownerId,
      color: userColor,
      capturedAt: Date.now()
    });
    saveLocalZones();
    updateHexGrid(userLocation.lat, userLocation.lng);
    renderProfileTerritory();

    soundEngine.playCaptureComplete();
    addXP(75, '🏢 GEBÄUDE ERFOLGREICH BESETZT!');
    openNodeControlModal(activeSelectedPoi);
    showToast(`🎉 ${activeSelectedPoi.name} GEKAUFT & VERTEIDIGT! (-${cost} 💎)`);
  });
}

if (btnCloseNodeModal) {
  btnCloseNodeModal.addEventListener('click', () => {
    soundEngine.playClick();
    if (nodeModal) nodeModal.classList.remove('active');
  });
}

if (btnUpgradeTurret) {
  btnUpgradeTurret.addEventListener('click', () => {
    if (!activeSelectedPoi || !dataBitsManager || !poiManager) return;
    const cost = 50;
    if (!dataBitsManager.spendBits(cost)) {
      showToast('⚠️ Nicht genug Energy Bits! (Benötigt 50 💎)');
      return;
    }
    const cur = poiManager.getFortification(activeSelectedPoi.id);
    const newLvl = Math.min(3, (cur.turretLevel || 0) + 1);
    poiManager.setFortification(activeSelectedPoi.id, {
      turretLevel: newLvl,
      color: userColor,
      owner: currentUser?.username || 'Tagger'
    });
    soundEngine.playUpgrade();
    openNodeControlModal(activeSelectedPoi);
    showToast(`⚡ EMP-TURRET AUF LEVEL ${newLvl} VERSTÄRKT! (-50 💎)`);
  });
}

if (btnUpgradeShield) {
  btnUpgradeShield.addEventListener('click', () => {
    if (!activeSelectedPoi || !dataBitsManager || !poiManager) return;
    const cost = 40;
    if (!dataBitsManager.spendBits(cost)) {
      showToast('⚠️ Nicht genug Energy Bits! (Benötigt 40 💎)');
      return;
    }
    poiManager.setFortification(activeSelectedPoi.id, {
      shieldHp: 100,
      color: userColor,
      owner: currentUser?.username || 'Tagger'
    });
    soundEngine.playUpgrade();
    openNodeControlModal(activeSelectedPoi);
    showToast(`🛡️ PLASMA-SCHUTZSCHILD AKTIVIERT (100 HP)! (-40 💎)`);
  });
}

if (btnUpgradeBeacon) {
  btnUpgradeBeacon.addEventListener('click', () => {
    if (!activeSelectedPoi || !dataBitsManager || !poiManager) return;
    const cost = 60;
    if (!dataBitsManager.spendBits(cost)) {
      showToast('⚠️ Nicht genug Energy Bits! (Benötigt 60 💎)');
      return;
    }
    poiManager.setFortification(activeSelectedPoi.id, {
      beaconActive: true,
      color: userColor,
      owner: currentUser?.username || 'Tagger'
    });
    soundEngine.playUpgrade();
    addXP(100, '📡 SIGNAL-BEACON AKTIVIERT');
    openNodeControlModal(activeSelectedPoi);
    showToast(`📡 SIGNAL-BEACON ONLINE! (+100 XP, -60 💎)`);
  });
}

if (btnNodeSpray) {
  btnNodeSpray.addEventListener('click', () => {
    if (!activeSelectedPoi) return;
    soundEngine.playClick();
    if (nodeModal) nodeModal.classList.remove('active');
    sprayModalHexLabel.textContent = `GEBÄUDE: ${activeSelectedPoi.name.slice(0, 18).toUpperCase()}`;
    if (graffitiCanvas) graffitiCanvas.clear();
    sprayModal.classList.add('active');
  });
}

if (btnNodeSendDrone) {
  btnNodeSendDrone.addEventListener('click', () => {
    if (!activeSelectedPoi || !droneManager) return;
    soundEngine.playClick();
    if (nodeModal) nodeModal.classList.remove('active');
    if (totalXp < DRONE_DEPLOY_COST_XP) {
      showToast(`⚠️ Nicht genug XP für Drohne (${DRONE_DEPLOY_COST_XP} XP benötigt)!`);
      return;
    }
    addXP(-DRONE_DEPLOY_COST_XP, '🛸 DROHNE ENTSANDT');
    droneManager.deployDrone(activeSelectedPoi.hexId, userColor);
    showToast(`🛸 Drohne auf dem Weg zu ${activeSelectedPoi.name}!`);
  });
}

// --- 13. FREE CHOICE COLOR PICKER & GPS RECENTER ---
const desktopColorPreview = document.getElementById('desktopColorPreview');
const desktopColorHex = document.getElementById('desktopColorHex');
const mobileColorOrb = document.getElementById('mobileColorOrb');

export function applyUserColor(color, isSilent = false) {
  userColor = color;
  localStorage.setItem(SAVED_COLOR_KEY, userColor);

  document.documentElement.style.setProperty('--user-color', userColor);
  if (userColorDot) {
    userColorDot.style.background = userColor;
    userColorDot.style.boxShadow = `0 0 12px ${userColor}`;
  }

  syncColorButtons();

  if (currentUser) {
    currentUser.color = userColor;
    syncProfileToServer({ color: userColor });
  }

  if (graffitiCanvas) graffitiCanvas.setBrushColor(userColor);
  updateHexGrid(userLocation.lat, userLocation.lng);
  
  if (!isSilent) {
    soundEngine.playClick();
    showToast(`🎨 Farbe gewählt: ${userColor.toUpperCase()}`);
  }
}

function syncColorButtons() {
  document.querySelectorAll('.custom-color-input').forEach(input => {
    input.value = userColor;
  });
  if (desktopColorPreview) {
    desktopColorPreview.style.background = userColor;
    desktopColorPreview.style.boxShadow = `0 0 16px ${userColor}`;
  }
  if (desktopColorHex) {
    desktopColorHex.textContent = userColor.toUpperCase();
  }
  if (mobileColorOrb) {
    mobileColorOrb.style.background = userColor;
    mobileColorOrb.style.boxShadow = `0 0 14px ${userColor}`;
  }
}

document.querySelectorAll('.custom-color-input').forEach(input => {
  input.addEventListener('input', (e) => {
    applyUserColor(e.target.value, false);
  });
});

document.getElementById('btnCenterMap')?.addEventListener('click', () => {
  isFollowingUser = true;
  soundEngine.playClick();
  const btn = document.getElementById('btnCenterMap');
  if (btn) btn.classList.remove('needs-center');

  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        applyGPSUpdate(pos, true);
        showToast('🛰️ GPS ZENTRIERT & GEKOPPELT!');
      },
      () => {
        map.flyTo({ center: [userLocation.lng, userLocation.lat], zoom: 17.5, pitch: 40, speed: 1.6 });
      },
      { enableHighAccuracy: true, timeout: 5000 }
    );
  } else {
    map.flyTo({ center: [userLocation.lng, userLocation.lat], zoom: 17.5, pitch: 40, speed: 1.6 });
  }
});

// --- 14. MINIMAL VIEW & HUD FOCUS MODE ---
if (captureCard) {
  captureCard.addEventListener('click', (e) => {
    // Only toggle expansion if not clicking the tag gallery button
    if (e.target.closest('#btnOpenHexGallery')) return;
    captureCard.classList.toggle('expanded');
    soundEngine.playClick();
  });
}

if (btnToggleHud) {
  btnToggleHud.addEventListener('click', () => {
    document.body.classList.toggle('hud-hidden');
    soundEngine.playClick();
    if (document.body.classList.contains('hud-hidden')) {
      showToast('👁️ Freie Sicht aktiviert (Tippe 👁️ HUD zum Wiederherstellen)');
    }
  });
}

if (btnRestoreHud) {
  btnRestoreHud.addEventListener('click', () => {
    document.body.classList.remove('hud-hidden');
    soundEngine.playClick();
    showToast('👁️ HUD wieder eingeblendet');
  });
}
