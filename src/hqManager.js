/**
 * HQManager (Cyber Base Building Simulation, Laser Mesh Network & Control Fields)
 * Features:
 * 1. Data-Silos, Hangar, Relay, Solar Synthesizer upgrades
 * 2. Glowing Laser-Links connecting HQ and owned nodes
 * 3. Triangular Sector Control Fields (Ingress-style territory fields)
 * 4. Automated Data-Pipeline harvesting into HQ Silos
 * 5. Cluster Defense Shield Boost & Drone Hyperlanes
 */
export class HQManager {
  constructor(map, dataBitsManager, poiManager, onUpdate) {
    this.map = map;
    this.dataBitsManager = dataBitsManager;
    this.poiManager = poiManager;
    this.onUpdate = onUpdate;

    this.data = this.loadData();
    this.ownedPois = [];
    this.activeLinks = [];
    this.userColor = '#ff8000';

    this.syncCapacityToBitsManager();
    this.initNetworkLayers();
    this.startPipelineLoop();
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

    // 1. Control Fields (Shimmering Polygons)
    if (!this.map.getSource('cyber-control-fields-source')) {
      this.map.addSource('cyber-control-fields-source', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });

      this.map.addLayer({
        id: 'control-fields-fill',
        type: 'fill',
        source: 'cyber-control-fields-source',
        paint: {
          'fill-color': ['get', 'color'],
          'fill-opacity': 0.18
        }
      });
    }

    // 2. Network Laser Lines
    if (!this.map.getSource('cyber-network-links-source')) {
      this.map.addSource('cyber-network-links-source', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });

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
    this.ownedPois = ownedPois;
    this.userColor = userColor;
    if (!this.map) return;

    const linksSource = this.map.getSource('cyber-network-links-source');
    const fieldsSource = this.map.getSource('cyber-control-fields-source');

    const linkFeatures = [];
    const fieldFeatures = [];
    const hqCoord = [this.data.lng, this.data.lat];

    // Links from HQ to owned buildings
    ownedPois.forEach(poi => {
      linkFeatures.push({
        type: 'Feature',
        properties: { color: userColor },
        geometry: {
          type: 'LineString',
          coordinates: [hqCoord, [poi.lng, poi.lat]]
        }
      });
    });

    // Cross-links and triangular Control Fields (< 850m)
    for (let i = 0; i < ownedPois.length; i++) {
      for (let j = i + 1; j < ownedPois.length; j++) {
        const p1 = ownedPois[i];
        const p2 = ownedPois[j];
        const dist = this.getDistanceMeters(p1.lat, p1.lng, p2.lat, p2.lng);
        if (dist <= 850) {
          linkFeatures.push({
            type: 'Feature',
            properties: { color: userColor },
            geometry: {
              type: 'LineString',
              coordinates: [[p1.lng, p1.lat], [p2.lng, p2.lat]]
            }
          });

          // Form triangular Control Field with HQ
          fieldFeatures.push({
            type: 'Feature',
            properties: { color: userColor },
            geometry: {
              type: 'Polygon',
              coordinates: [[hqCoord, [p1.lng, p1.lat], [p2.lng, p2.lat], hqCoord]]
            }
          });
        }
      }
    }

    if (linksSource) linksSource.setData({ type: 'FeatureCollection', features: linkFeatures });
    if (fieldsSource) fieldsSource.setData({ type: 'FeatureCollection', features: fieldFeatures });
  }

  startPipelineLoop() {
    // Automated Data-Pipeline: Transfer bits from connected nodes into HQ Silos every 60s
    setInterval(() => {
      if (!this.dataBitsManager) return;

      let pipelineGain = 0;

      // 1. Solar Synthesizer Yield
      const synthYields = [0, 5, 15, 30];
      const synthRate = synthYields[this.data.synthLevel || 0] || 0;
      if (synthRate > 0) {
        pipelineGain += Math.ceil(synthRate / 5); // Per minute
      }

      // 2. Connected Data Dispensers Yield
      const dispensers = this.ownedPois.filter(p => p.isDataDispenser);
      if (dispensers.length > 0) {
        pipelineGain += dispensers.length * 2; // +2 Bits per connected dispenser node
      }

      if (pipelineGain > 0 && this.dataBitsManager.totalBits < this.getMaxStorage()) {
        this.dataBitsManager.totalBits = Math.min(this.getMaxStorage(), this.dataBitsManager.totalBits + pipelineGain);
        this.dataBitsManager.saveBitsCount();
        if (this.onUpdate) this.onUpdate(this.data);
      }
    }, 60000);
  }

  isNodeConnectedToHQ(poi) {
    if (!poi) return false;
    return this.ownedPois.some(p => p.id === poi.id);
  }

  getClusterShieldBoost(poi) {
    if (!this.isNodeConnectedToHQ(poi)) return 0;
    // +25% shield HP per connected building in cluster (up to +100%)
    return Math.min(100, (this.ownedPois.length - 1) * 25);
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
