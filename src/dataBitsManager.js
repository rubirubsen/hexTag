/**
 * DataBitsManager (High-density Ingress-style XM & Cyber Energy Collection)
 * 1 Bit = 1 Bit. High particle density with magnetic vacuum physics and OSM building fountains.
 */
import * as h3 from 'h3-js';

const DATA_BITS_STORAGE_KEY = 'hextag_data_bits';
const PICKUP_RADIUS_METERS = 24; // Distance to vacuum absorb
const VACUUM_MAGNET_RADIUS = 68; // Distance where shards start flying toward player

export class DataBitsManager {
  constructor(map, onBitsUpdate) {
    this.map = map;
    this.onBitsUpdate = onBitsUpdate;
    this.bits = [];
    this.totalBits = this.loadBitsCount();
    this.maxBitsCapacity = 2500;
    this.currentCenterHex = null;
    this.activeFountains = new Set();

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

      // Outer Pulsing Neon Glow (Small & Sharp)
      this.map.addLayer({
        id: 'data-bits-glow',
        type: 'circle',
        source: 'data-bits-source',
        paint: {
          'circle-radius': ['get', 'glowRadius'],
          'circle-color': ['get', 'color'],
          'circle-opacity': 0.75,
          'circle-blur': 0.6
        }
      });

      // Inner Pixel Diamond Core (Crisp & Bitsig)
      this.map.addLayer({
        id: 'data-bits-core',
        type: 'circle',
        source: 'data-bits-source',
        paint: {
          'circle-radius': ['get', 'coreRadius'],
          'circle-color': '#ffffff',
          'circle-opacity': 1.0,
          'circle-stroke-width': 1.5,
          'circle-stroke-color': ['get', 'color']
        }
      });
    }
  }

  /**
   * Spawns a high-density field of individual 1-Bit shards in nearby hexes
   */
  spawnNearbyBits(lat, lng) {
    const centerHex = h3.latLngToCell(lat, lng, 10);
    if (this.currentCenterHex === centerHex && this.bits.length >= 60) {
      return;
    }
    this.currentCenterHex = centerHex;

    const nearbyHexes = h3.gridDisk(centerHex, 3);
    const newBits = [];
    const colors = ['#00f0ff', '#39ff14', '#ffe600', '#ff007f', '#00ffa3'];

    nearbyHexes.forEach((hex, hexIdx) => {
      // 8 - 14 individual 1-Bits per hex cell
      const count = 8 + (hexIdx % 7);
      const boundary = h3.cellToBoundary(hex);

      for (let i = 0; i < count; i++) {
        const rndVertex = boundary[i % boundary.length];
        const offsetLat = (Math.random() - 0.5) * 0.00065;
        const offsetLng = (Math.random() - 0.5) * 0.00085;

        const bLat = rndVertex[0] + offsetLat;
        const bLng = rndVertex[1] + offsetLng;
        const color = colors[(hexIdx * 3 + i) % colors.length];

        newBits.push({
          id: `bit_${hex}_${i}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
          lat: bLat,
          lng: bLng,
          value: 1, // Exactly 1 Bit per shard!
          color,
          hexId: hex,
          isCollected: false,
          animOffset: Math.random() * Math.PI * 2
        });
      }
    });

    const existing = this.bits.filter(b => !b.isCollected);
    this.bits = [...existing, ...newBits].slice(0, 220);
    this.updateGeoJSON();
  }

  /**
   * Spawns a concentrated Bit-Fountain ring around special OSM buildings (Cafés, Stations, Telecom, Monuments)
   */
  spawnBuildingFountain(poiLat, poiLng, count = 16) {
    const fountainKey = `${poiLat.toFixed(4)}_${poiLng.toFixed(4)}`;
    if (this.activeFountains.has(fountainKey)) return;
    this.activeFountains.add(fountainKey);

    const colors = ['#00f0ff', '#ffe600', '#39ff14', '#ff0055'];
    const newBits = [];

    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const radius = 0.00025 + (Math.random() - 0.5) * 0.0001; // ~25m ring
      const bLat = poiLat + Math.sin(angle) * radius;
      const bLng = poiLng + Math.cos(angle) * radius;

      newBits.push({
        id: `fountain_${fountainKey}_${i}`,
        lat: bLat,
        lng: bLng,
        value: 1,
        color: colors[i % colors.length],
        isCollected: false,
        animOffset: Math.random() * Math.PI * 2
      });
    }

    const existing = this.bits.filter(b => !b.isCollected);
    this.bits = [...existing, ...newBits].slice(0, 250);
    this.updateGeoJSON();
  }

  /**
   * Called every frame / GPS update to check magnet vacuum pickup & floating physics
   */
  update(userLat, userLng) {
    if (!userLat || !userLng || this.bits.length === 0) return;

    let collectedCount = 0;
    let totalGained = 0;
    let needsRedraw = false;

    for (let i = this.bits.length - 1; i >= 0; i--) {
      const bit = this.bits[i];
      if (bit.isCollected) continue;

      const dist = this.getDistanceMeters(userLat, userLng, bit.lat, bit.lng);

      // Vacuum Absorption
      if (dist <= PICKUP_RADIUS_METERS) {
        bit.isCollected = true;
        collectedCount++;
        totalGained += bit.value;
        this.bits.splice(i, 1);
        needsRedraw = true;
      }
      // Magnet Pull: Float smoothly towards player!
      else if (dist <= VACUUM_MAGNET_RADIUS) {
        bit.lat += (userLat - bit.lat) * 0.25;
        bit.lng += (userLng - bit.lng) * 0.25;
        needsRedraw = true;
      }
    }

    if (collectedCount > 0) {
      this.totalBits = Math.min(this.maxBitsCapacity, this.totalBits + totalGained);
      this.saveBitsCount();

      if (this.onBitsUpdate) {
        this.onBitsUpdate({
          totalBits: this.totalBits,
          gained: totalGained,
          collectedCount
        });
      }
    }

    if (needsRedraw || collectedCount > 0) {
      this.updateGeoJSON();
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

    const time = Date.now() / 350;
    const features = this.bits.map(b => {
      const pulse = Math.sin(time + b.animOffset) * 1.5;
      return {
        type: 'Feature',
        properties: {
          id: b.id,
          color: b.color,
          value: b.value,
          glowRadius: 5.5 + pulse,
          coreRadius: 2.2 + pulse * 0.2
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
    const R = 6371e3;
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
