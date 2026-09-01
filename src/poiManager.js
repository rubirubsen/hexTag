/**
 * PoiManager (OpenStreetMap POI Overpass API & Tower Defense Integration)
 */
import * as h3 from 'h3-js';
import maplibregl from 'maplibre-gl';

const POI_STORAGE_KEY = 'hextag_fortified_nodes';

export class PoiManager {
  constructor(map, onPoiSelect) {
    this.map = map;
    this.onPoiSelect = onPoiSelect;
    this.pois = [];
    this.markers = new Map(); // poiId -> maplibregl.Marker
    this.fortifiedNodes = this.loadFortifiedNodes();
    this.lastFetchCoords = null;
    this.isLoading = false;
  }

  loadFortifiedNodes() {
    try {
      const data = localStorage.getItem(POI_STORAGE_KEY);
      return data ? JSON.parse(data) : {};
    } catch {
      return {};
    }
  }

  saveFortifiedNodes() {
    try {
      localStorage.setItem(POI_STORAGE_KEY, JSON.stringify(this.fortifiedNodes));
    } catch (e) {
      console.warn('[PoiManager] Error saving fortified nodes:', e);
    }
  }

  getFortification(poiId) {
    return (
      this.fortifiedNodes[poiId] || {
        turretLevel: 0,
        shieldHp: 0,
        beaconActive: false,
        owner: null,
        color: '#ff8000'
      }
    );
  }

  setFortification(poiId, data) {
    this.fortifiedNodes[poiId] = {
      ...this.getFortification(poiId),
      ...data,
      updatedAt: Date.now()
    };
    this.saveFortifiedNodes();
    this.updateMarkerVisual(poiId);
  }

  async fetchNearbyPOIs(lat, lng) {
    if (this.isLoading) return;

    // Check if moved significantly (> 400m)
    if (this.lastFetchCoords) {
      const movedDist = this.getDistanceMeters(
        this.lastFetchCoords.lat,
        this.lastFetchCoords.lng,
        lat,
        lng
      );
      if (movedDist < 400 && this.pois.length > 0) return;
    }

    this.isLoading = true;
    this.lastFetchCoords = { lat, lng };

    try {
      // Overpass API Query: Bounding box ~800m
      const delta = 0.007;
      const south = lat - delta;
      const north = lat + delta;
      const west = lng - delta * 1.5;
      const east = lng + delta * 1.5;

      const overpassQuery = `
        [out:json][timeout:8];
        (
          node["historic"](${south},${west},${north},${east});
          node["tourism"="attraction"](${south},${west},${north},${east});
          node["amenity"~"cafe|bar|restaurant|library|townhall"](${south},${west},${north},${east});
          node["railway"="station"](${south},${west},${north},${east});
          node["telecom"](${south},${west},${north},${east});
        );
        out body 25;
      `;

      const res = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(overpassQuery)
      });

      if (res.ok) {
        const data = await res.json();
        if (data && data.elements && data.elements.length > 0) {
          this.processOverpassElements(data.elements);
          this.isLoading = false;
          return;
        }
      }
    } catch (e) {
      console.warn('[PoiManager] Overpass API offline/timeout, verwende lokale POIs:', e.message);
    }

    // Fallback: Generate smart procedural local POIs if Overpass is slow/offline
    this.generateFallbackPOIs(lat, lng);
    this.isLoading = false;
  }

  processOverpassElements(elements) {
    const parsed = elements
      .filter(el => el.tags && (el.tags.name || el.tags.amenity || el.tags.historic))
      .map(el => {
        const name = el.tags.name || this.getDefaultName(el.tags);
        const { type, icon, category } = this.categorizeTags(el.tags);
        const hexId = h3.latLngToCell(el.lat, el.lon, 10);

        return {
          id: `osm_${el.id}`,
          name,
          lat: el.lat,
          lng: el.lon,
          hexId,
          type,
          icon,
          category,
          tags: el.tags
        };
      });

    this.pois = parsed;
    this.renderMarkers();
  }

  generateFallbackPOIs(lat, lng) {
    const centerHex = h3.latLngToCell(lat, lng, 10);
    const ringHexes = h3.gridRingUnsafe(centerHex, 1);
    const demoTemplates = [
      { name: 'KRAFTWERK ALPHA', type: 'telecom', icon: '⚡', category: 'SIGNAL-VERSTÄRKER' },
      { name: 'CYBER ARCHIV', type: 'library', icon: '🏢', category: 'DATEN-FESTUNG' },
      { name: 'NEON CAFÉ OASIS', type: 'cafe', icon: '☕', category: 'STREET-HUB' },
      { name: 'METRO STATION NEXUS', type: 'station', icon: '🚉', category: 'TRANSIT-KNOTEN' },
      { name: 'MONUMENT DER EROBERER', type: 'monument', icon: '🏛️', category: 'ANCIENT CORE' }
    ];

    const fallback = ringHexes.map((hex, idx) => {
      const [hLat, hLng] = h3.cellToLatLng(hex);
      const tpl = demoTemplates[idx % demoTemplates.length];
      return {
        id: `node_gen_${hex}`,
        name: tpl.name,
        lat: hLat,
        lng: hLng,
        hexId: hex,
        type: tpl.type,
        icon: tpl.icon,
        category: tpl.category
      };
    });

    this.pois = fallback;
    this.renderMarkers();
  }

  categorizeTags(tags) {
    if (tags.historic || tags.tourism === 'attraction') {
      return { type: 'monument', icon: '🏛️', category: 'ANCIENT CORE' };
    }
    if (tags.telecom || tags.power) {
      return { type: 'telecom', icon: '⚡', category: 'SIGNAL-VERSTÄRKER' };
    }
    if (tags.railway === 'station') {
      return { type: 'station', icon: '🚉', category: 'TRANSIT-KNOTEN' };
    }
    if (tags.amenity === 'library' || tags.amenity === 'townhall') {
      return { type: 'fortress', icon: '🏢', category: 'DATEN-FESTUNG' };
    }
    return { type: 'social', icon: '☕', category: 'STREET-HUB' };
  }

  getDefaultName(tags) {
    if (tags.amenity) return `Cyber ${tags.amenity.toUpperCase()}`;
    if (tags.historic) return `Historischer Knoten`;
    if (tags.railway) return `Bahnhof Nexus`;
    return 'Knotenpunkt';
  }

  renderMarkers() {
    if (!this.map) return;

    // Clear removed markers
    for (const [id, marker] of this.markers.entries()) {
      if (!this.pois.some(p => p.id === id)) {
        marker.remove();
        this.markers.delete(id);
      }
    }

    // Add or update markers
    this.pois.forEach(poi => {
      if (this.markers.has(poi.id)) {
        this.updateMarkerVisual(poi.id);
        return;
      }

      const fort = this.getFortification(poi.id);
      const el = document.createElement('div');
      el.className = 'poi-map-marker';
      el.id = `marker_${poi.id}`;
      el.innerHTML = `
        <div class="poi-marker-badge" style="--poi-color: ${fort.color || '#ff8000'}">
          <span class="poi-marker-icon">${poi.icon}</span>
          <span class="poi-marker-name">${poi.name.slice(0, 16)}</span>
          ${fort.turretLevel > 0 ? `<span class="poi-turret-tag">⚡ L${fort.turretLevel}</span>` : ''}
          ${fort.shieldHp > 0 ? `<span class="poi-shield-tag">🛡️</span>` : ''}
        </div>
      `;

      el.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.onPoiSelect) {
          this.onPoiSelect(poi, this.getFortification(poi.id));
        }
      });

      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([poi.lng, poi.lat])
        .addTo(this.map);

      this.markers.set(poi.id, marker);
    });
  }

  updateMarkerVisual(poiId) {
    const marker = this.markers.get(poiId);
    if (!marker) return;
    const poi = this.pois.find(p => p.id === poiId);
    if (!poi) return;

    const fort = this.getFortification(poiId);
    const el = marker.getElement();
    if (el) {
      el.innerHTML = `
        <div class="poi-marker-badge ${fort.turretLevel > 0 ? 'fortified' : ''}" style="--poi-color: ${fort.color || '#ff8000'}">
          <span class="poi-marker-icon">${poi.icon}</span>
          <span class="poi-marker-name">${poi.name.slice(0, 16)}</span>
          ${fort.turretLevel > 0 ? `<span class="poi-turret-tag">⚡ L${fort.turretLevel}</span>` : ''}
          ${fort.shieldHp > 0 ? `<span class="poi-shield-tag">🛡️</span>` : ''}
        </div>
      `;
    }
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
