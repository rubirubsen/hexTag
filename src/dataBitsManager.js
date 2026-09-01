/**
 * DataBitsManager (Ingress-style XM & Cyber Energy Collection)
 */
import * as h3 from 'h3-js';

const DATA_BITS_STORAGE_KEY = 'hextag_data_bits';
const PICKUP_RADIUS_METERS = 38; // Distance in meters to vacuum bits

export class DataBitsManager {
  constructor(map, onBitsUpdate) {
    this.map = map;
    this.onBitsUpdate = onBitsUpdate;
    this.bits = [];
    this.totalBits = this.loadBitsCount();
    this.maxBitsCapacity = 1000;
    this.lastSpawnTime = 0;
    this.currentCenterHex = null;

    this.initSourceAndLayers();
  }

  loadBitsCount() {
    try {
      const val = parseInt(localStorage.getItem(DATA_BITS_STORAGE_KEY), 10);
      return isNaN(val) ? 50 : val;
    } catch {
      return 50;
    }
  }

  saveBitsCount() {
    try {
      localStorage.setItem(DATA_BITS_STORAGE_KEY, this.totalBits);
    } catch (e) {
      console.warn('[DataBits] Error saving count:', e);
    }
  }

  initSourceAndLayers() {
    if (!this.map) return;

    if (!this.map.getSource('data-bits-source')) {
      this.map.addSource('data-bits-source', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });

      // Outer Glow Pulse
      this.map.addLayer({
        id: 'data-bits-glow',
        type: 'circle',
        source: 'data-bits-source',
        paint: {
          'circle-radius': ['get', 'glowRadius'],
          'circle-color': ['get', 'color'],
          'circle-opacity': 0.25,
          'circle-blur': 0.8
        }
      });

      // Inner Core
      this.map.addLayer({
        id: 'data-bits-core',
        type: 'circle',
        source: 'data-bits-source',
        paint: {
          'circle-radius': ['get', 'coreRadius'],
          'circle-color': '#ffffff',
          'circle-opacity': 0.95,
          'circle-stroke-width': 1.5,
          'circle-stroke-color': ['get', 'color']
        }
      });
    }
  }

  /**
   * Spawns Data Bits in nearby hexes around user location
   */
  spawnNearbyBits(lat, lng) {
    const centerHex = h3.latLngToCell(lat, lng, 10);
    if (this.currentCenterHex === centerHex && this.bits.length > 12) {
      return;
    }
    this.currentCenterHex = centerHex;

    const nearbyHexes = h3.gridDisk(centerHex, 3);
    const newBits = [];
    const colors = ['#00f0ff', '#ff8000', '#39ff14', '#ffe600', '#ff0055'];

    nearbyHexes.forEach((hex, hexIdx) => {
      // 2 - 4 bits per hex
      const count = (hexIdx % 3) + 2;
      const boundary = h3.cellToBoundary(hex);

      for (let i = 0; i < count; i++) {
        // Random point inside hex approximation
        const rndVertex = boundary[i % boundary.length];
        const offsetLat = (Math.random() - 0.5) * 0.0006;
        const offsetLng = (Math.random() - 0.5) * 0.0008;

        const bLat = rndVertex[0] + offsetLat;
        const bLng = rndVertex[1] + offsetLng;
        const value = Math.floor(Math.random() * 5) + 3; // 3 to 7 bits per shard
        const color = colors[(hexIdx + i) % colors.length];

        newBits.push({
          id: `bit_${hex}_${i}_${Date.now().toString(36)}`,
          lat: bLat,
          lng: bLng,
          value,
          color,
          hexId: hex,
          isCollected: false,
          animOffset: Math.random() * Math.PI * 2
        });
      }
    });

    // Keep existing uncollected bits + new bits (cap at 60)
    const existing = this.bits.filter(b => !b.isCollected);
    this.bits = [...existing, ...newBits].slice(0, 60);
    this.updateGeoJSON();
  }

  /**
   * Called every frame / GPS update to check magnet vacuum pickup
   */
  update(userLat, userLng) {
    if (!userLat || !userLng || this.bits.length === 0) return;

    let collectedCount = 0;
    let totalGained = 0;

    for (let i = this.bits.length - 1; i >= 0; i--) {
      const bit = this.bits[i];
      if (bit.isCollected) continue;

      const dist = this.getDistanceMeters(userLat, userLng, bit.lat, bit.lng);

      // Vacuum range
      if (dist <= PICKUP_RADIUS_METERS) {
        bit.isCollected = true;
        collectedCount++;
        totalGained += bit.value;
        this.bits.splice(i, 1);
      }
    }

    if (collectedCount > 0) {
      this.totalBits = Math.min(this.maxBitsCapacity, this.totalBits + totalGained);
      this.saveBitsCount();
      this.updateGeoJSON();

      if (this.onBitsUpdate) {
        this.onBitsUpdate({
          totalBits: this.totalBits,
          gained: totalGained,
          collectedCount
        });
      }
    }
  }

  spendBits(amount) {
    if (this.totalBits >= amount) {
      this.totalBits -= amount;
      this.saveBitsCount();
      if (this.onBitsUpdate) {
        this.onBitsUpdate({
          totalBits: this.totalBits,
          spent: amount
        });
      }
      return true;
    }
    return false;
  }

  updateGeoJSON() {
    if (!this.map) return;
    const source = this.map.getSource('data-bits-source');
    if (!source) return;

    const time = Date.now() / 600;
    const features = this.bits.map(b => {
      const pulse = Math.sin(time + b.animOffset) * 2;
      return {
        type: 'Feature',
        properties: {
          id: b.id,
          color: b.color,
          value: b.value,
          glowRadius: 10 + pulse,
          coreRadius: 4 + pulse * 0.3
        },
        geometry: {
          type: 'Point',
          coordinates: [b.lng, b.lat]
        }
      };
    });

    source.setData({ type: 'FeatureCollection', features });
  }

  getDistanceMeters(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // metres
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δφ = ((lat2 - lat1) * Math.PI) / 180;
    const Δλ = ((lon2 - lon1) * Math.PI) / 180;

    const a =
      Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
      Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
  }
}
