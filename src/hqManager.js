/**
 * HQManager (Cyber Base Building Simulation & Laser Mesh Network Links)
 * Manages Data-Silos, Drone Hangars, Relay Antennas, and connects owned buildings with glowing laser lines.
 */
export class HQManager {
  constructor(map, dataBitsManager, poiManager, onUpdate) {
    this.map = map;
    this.dataBitsManager = dataBitsManager;
    this.poiManager = poiManager;
    this.onUpdate = onUpdate;

    this.data = this.loadData();
    this.syncCapacityToBitsManager();
    this.initNetworkLayers();
  }

  loadData() {
    try {
      const saved = localStorage.getItem('hextag_hq_modules');
      return saved ? JSON.parse(saved) : {
        siloLevel: 1,      // 1: 250 Bits, 2: 500 Bits, 3: 1000 Bits, 4: 2500 Bits, 5: 5000 Bits
        hangarLevel: 1,    // 1: 1 Drone, 2: 2 Drones, 3: 3 Drones, 4: 4 Drones
        relayLevel: 1,     // 1: 800m, 2: 1500m, 3: 2500m, 4: 4500m
        synthLevel: 0,     // 0: Aus, 1: +5 Bits / 5min, 2: +15 Bits / 5min, 3: +30 Bits / 5min
        name: 'CYBER-STÜTZPUNKT',
        lat: 52.520008,
        lng: 13.404954
      };
    } catch {
      return { siloLevel: 1, hangarLevel: 1, relayLevel: 1, synthLevel: 0, name: 'CYBER-STÜTZPUNKT', lat: 52.520008, lng: 13.404954 };
    }
  }

  saveData() {
    try {
      localStorage.setItem('hextag_hq_modules', JSON.stringify(this.data));
    } catch (e) {
      console.warn('[HQManager] Error saving HQ:', e);
    }
    this.syncCapacityToBitsManager();
    if (this.onUpdate) this.onUpdate(this.data);
  }

  getMaxStorage() {
    const capacities = [250, 500, 1000, 2500, 5000];
    return capacities[(this.data.siloLevel || 1) - 1] || 250;
  }

  getSignalRangeMeters() {
    const ranges = [800, 1500, 2500, 4500];
    return ranges[(this.data.relayLevel || 1) - 1] || 800;
  }

  getMaxDrones() {
    return this.data.hangarLevel || 1;
  }

  syncCapacityToBitsManager() {
    if (this.dataBitsManager) {
      this.dataBitsManager.maxBitsCapacity = this.getMaxStorage();
      if (this.dataBitsManager.totalBits > this.dataBitsManager.maxBitsCapacity) {
        this.dataBitsManager.totalBits = this.dataBitsManager.maxBitsCapacity;
        this.dataBitsManager.saveBitsCount();
      }
    }
  }

  upgradeModule(moduleType, cost) {
    if (!this.dataBitsManager || !this.dataBitsManager.spendBits(cost)) {
      return false;
    }

    if (moduleType === 'silo') this.data.siloLevel = Math.min(5, (this.data.siloLevel || 1) + 1);
    if (moduleType === 'hangar') this.data.hangarLevel = Math.min(4, (this.data.hangarLevel || 1) + 1);
    if (moduleType === 'relay') this.data.relayLevel = Math.min(4, (this.data.relayLevel || 1) + 1);
    if (moduleType === 'synth') this.data.synthLevel = Math.min(3, (this.data.synthLevel || 0) + 1);

    this.saveData();
    return true;
  }

  initNetworkLayers() {
    if (!this.map) return;
    if (!this.map.getSource('cyber-network-links-source')) {
      this.map.addSource('cyber-network-links-source', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });

      // Neon Laser Beam Outer Glow
      this.map.addLayer({
        id: 'network-laser-glow',
        type: 'line',
        source: 'cyber-network-links-source',
        paint: {
          'line-color': ['get', 'color'],
          'line-width': 4.5,
          'line-opacity': 0.55,
          'line-blur': 2
        }
      });

      // Sharp Cyber Core Laser Line
      this.map.addLayer({
        id: 'network-laser-core',
        type: 'line',
        source: 'cyber-network-links-source',
        paint: {
          'line-color': '#ffffff',
          'line-width': 1.8,
          'line-opacity': 0.9,
          'line-dasharray': [2, 2]
        }
      });
    }
  }

  updateNetworkLinks(ownedPois = [], userColor = '#ff8000') {
    if (!this.map) return;
    const source = this.map.getSource('cyber-network-links-source');
    if (!source) return;

    const features = [];
    const hqCoord = [this.data.lng, this.data.lat];

    ownedPois.forEach(poi => {
      // Laser link from HQ to each owned node
      features.push({
        type: 'Feature',
        properties: { color: userColor },
        geometry: {
          type: 'LineString',
          coordinates: [hqCoord, [poi.lng, poi.lat]]
        }
      });
    });

    // Cross-link nearby owned nodes (< 800m) to form triangular mesh fields
    for (let i = 0; i < ownedPois.length; i++) {
      for (let j = i + 1; j < ownedPois.length; j++) {
        const p1 = ownedPois[i];
        const p2 = ownedPois[j];
        const dist = this.getDistanceMeters(p1.lat, p1.lng, p2.lat, p2.lng);
        if (dist <= 850) {
          features.push({
            type: 'Feature',
            properties: { color: userColor },
            geometry: {
              type: 'LineString',
              coordinates: [[p1.lng, p1.lat], [p2.lng, p2.lat]]
            }
          });
        }
      }
    }

    source.setData({ type: 'FeatureCollection', features });
  }

  getDistanceMeters(lat1, lon1, lat2, lon2) {
    const R = 6371e3;
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δφ = ((lat2 - lat1) * Math.PI) / 180;
    const Δλ = ((lon2 - lon1) * Math.PI) / 180;
    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
}
