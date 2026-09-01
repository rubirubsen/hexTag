/**
 * hexTag Drone & HQ (Stützpunkt) System
 */
import * as h3 from 'h3-js';
import maplibregl from 'maplibre-gl';

const HQ_STORAGE_KEY = 'hextag_player_hq';

export class DroneManager {
  constructor(map, onDroneUpdate) {
    this.map = map;
    this.onDroneUpdate = onDroneUpdate;
    this.hq = this.loadHQ();
    this.drones = [];
    this.droneMarkers = new Map(); // droneId -> maplibregl.Marker

    this.hqTimerSeconds = 0;
    this.hqTimerRequired = 120; // 2 Minuten am PC
    this.isHqEligible = false;

    this.initHQMarker();
  }

  loadHQ() {
    try {
      const data = localStorage.getItem(HQ_STORAGE_KEY);
      return data ? JSON.parse(data) : null;
    } catch {
      return null;
    }
  }

  saveHQ(hqData) {
    this.hq = hqData;
    localStorage.setItem(HQ_STORAGE_KEY, JSON.stringify(hqData));
    this.initHQMarker();
    if (this.onDroneUpdate) {
      this.onDroneUpdate({
        hq: this.hq,
        activeDrones: this.drones.length
      });
    }
  }

  initHQMarker() {
    if (!this.hq || !this.map) return;

    if (this.hqMarkerEl) {
      this.hqMarkerEl.remove();
    }

    const el = document.createElement('div');
    el.className = 'hq-base-marker';
    el.innerHTML = `
      <div class="hq-beacon-ring"></div>
      <div class="hq-core" style="--hq-color: ${this.hq.color || '#ffe600'}">
        <span class="hq-icon">🏢</span>
        <div class="hq-label">HQ • ${(this.hq.name || 'STÜTZPUNKT').slice(0, 16).toUpperCase()}</div>
      </div>
    `;

    this.hqMarkerEl = new maplibregl.Marker({ element: el })
      .setLngLat([this.hq.lng, this.hq.lat])
      .addTo(this.map);
  }

  deployDrone(target, colorOverride = '#00f0ff') {
    let targetHexId = '';
    let targetLat = 0;
    let targetLng = 0;
    let color = colorOverride;
    let author = 'CMD_01';

    if (typeof target === 'string') {
      targetHexId = target;
      try {
        const [hLat, hLng] = h3.cellToLatLng(targetHexId);
        targetLat = hLat;
        targetLng = hLng;
      } catch (e) {
        targetLat = this.hq ? this.hq.lat : 52.52;
        targetLng = this.hq ? this.hq.lng : 13.40;
      }
    } else if (typeof target === 'object') {
      targetHexId = target.targetHexId || '';
      targetLat = target.targetLat || target.lat;
      targetLng = target.targetLng || target.lng;
      color = target.color || color;
      author = target.author || author;
    }

    const droneId = 'drone_' + Date.now().toString(36);
    const startLat = this.hq ? this.hq.lat : targetLat;
    const startLng = this.hq ? this.hq.lng : targetLng;

    const drone = {
      id: droneId,
      author,
      color: color || '#00f0ff',
      targetHexId,
      currentLat: startLat,
      currentLng: startLng,
      targetLat,
      targetLng,
      durationTotal: 90, // 90 Sekunden Einsatzdauer
      durationRemaining: 90,
      progress: 0,
      isHyperlane: target.isHyperlane || false,
      orbitAngle: Math.random() * Math.PI * 2,
      createdAt: Date.now()
    };

    this.drones.push(drone);
    this.createDroneMarker(drone);

    if (this.onDroneUpdate) {
      this.onDroneUpdate({
        hq: this.hq,
        activeDrones: this.drones.length
      });
    }

    return drone;
  }

  createDroneMarker(drone) {
    const el = document.createElement('div');
    el.className = 'drone-marker-x';
    el.style.setProperty('--drone-color', drone.color);
    el.innerHTML = `
      <div class="drone-x-symbol">🛸</div>
      <div class="drone-tag">${drone.targetHexId ? drone.targetHexId.slice(-4).toUpperCase() : 'PATROL'}</div>
    `;

    const marker = new maplibregl.Marker({ element: el })
      .setLngLat([drone.currentLat, drone.currentLng])
      .addTo(this.map);

    this.droneMarkers.set(drone.id, marker);
  }

  update(deltaSeconds = 1) {
    for (let i = this.drones.length - 1; i >= 0; i--) {
      const drone = this.drones[i];
      drone.durationRemaining -= deltaSeconds;

      const travelTime = drone.isHyperlane ? 4 : 8; // Hyperlane flies in 4s!
      const elapsed = drone.durationTotal - drone.durationRemaining;
      drone.progress = Math.min(1, elapsed / travelTime);

      if (drone.progress < 1) {
        // En route flight towards target (Hyperlane speed boost)
        const step = drone.isHyperlane ? 0.35 : 0.2;
        drone.currentLat += (drone.targetLat - drone.currentLat) * step;
        drone.currentLng += (drone.targetLng - drone.currentLng) * step;
      } else {
        // Orbital patrol circling the target building/node
        drone.orbitAngle = (drone.orbitAngle || 0) + 0.15;
        const orbitRadiusLat = 0.00045; // ~50m Radius
        const orbitRadiusLng = 0.00065;
        drone.currentLat = drone.targetLat + Math.sin(drone.orbitAngle) * orbitRadiusLat;
        drone.currentLng = drone.targetLng + Math.cos(drone.orbitAngle) * orbitRadiusLng;
      }

      const marker = this.droneMarkers.get(drone.id);
      if (marker) {
        marker.setLngLat([drone.currentLng, drone.currentLat]);
      }

      if (drone.durationRemaining <= 0) {
        if (marker) marker.remove();
        this.droneMarkers.delete(drone.id);
        this.drones.splice(i, 1);
      }
    }

    if (this.onDroneUpdate) {
      this.onDroneUpdate({
        hq: this.hq,
        hqTimerSeconds: this.hqTimerSeconds,
        hqTimerRequired: this.hqTimerRequired,
        isHqEligible: this.isHqEligible,
        activeDrones: this.drones.length
      });
    }
  }
}
