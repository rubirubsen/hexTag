/**
 * hexTag Drone & HQ (Stützpunkt) System
 */
const HQ_STORAGE_KEY = 'hextag_player_hq';
const DRONES_STORAGE_KEY = 'hextag_active_drones';

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
  }

  initHQMarker() {
    if (!this.hq || !this.map) return;

    if (this.hqMarkerEl) {
      this.hqMarkerEl.remove();
    }

    const el = document.createElement('div');
    el.className = 'hq-base-marker';
    el.innerHTML = `
      <div class="hq-core" style="--hq-color: ${this.hq.color}">
        <span class="hq-icon">🏢</span>
        <div class="hq-label">HQ: ${this.hq.name || 'STÜTZPUNKT'}</div>
      </div>
    `;

    this.hqMarkerEl = new maplibregl.Marker({ element: el })
      .setLngLat([this.hq.lng, this.hq.lat])
      .addTo(this.map);
  }

  deployDrone({ targetHexId, targetLat, targetLng, color, author = 'CMD_01' }) {
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
      createdAt: Date.now()
    };

    this.drones.push(drone);
    this.createDroneMarker(drone);

    return drone;
  }

  createDroneMarker(drone) {
    const el = document.createElement('div');
    el.className = 'drone-marker-x';
    el.style.setProperty('--drone-color', drone.color);
    el.innerHTML = `
      <div class="drone-x-symbol">✖</div>
      <div class="drone-tag">${drone.targetHexId.slice(-4).toUpperCase()}</div>
    `;

    const marker = new maplibregl.Marker({ element: el })
      .setLngLat([drone.currentLat, drone.currentLng])
      .addTo(this.map);

    this.droneMarkers.set(drone.id, marker);
  }

  update(deltaSeconds = 1) {
    // HQ 2-Minuten Timer Update
    if (!this.hq) {
      this.hqTimerSeconds += deltaSeconds;
      if (this.hqTimerSeconds >= this.hqTimerRequired) {
        this.isHqEligible = true;
      }
    }

    // Dronen Flug & Mission Loop
    for (let i = this.drones.length - 1; i >= 0; i--) {
      const drone = this.drones[i];
      drone.durationRemaining -= deltaSeconds;

      // Flug-Interpolation zur Zielwabe (10 Sekunden Flugzeit)
      const flightDuration = 10;
      const timeElapsed = drone.durationTotal - drone.durationRemaining;
      const flightProgress = Math.min(timeElapsed / flightDuration, 1.0);

      drone.currentLat = drone.currentLat + (drone.targetLat - drone.currentLat) * (flightProgress * 0.2);
      drone.currentLng = drone.currentLng + (drone.targetLng - drone.currentLng) * (flightProgress * 0.2);

      const marker = this.droneMarkers.get(drone.id);
      if (marker) {
        marker.setLngLat([drone.currentLng, drone.currentLat]);
      }

      // Drone abgelaufen -> Aufloesen
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
        activeDrones: this.drones
      });
    }
  }
}
