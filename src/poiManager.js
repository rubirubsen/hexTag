/**
 * PoiManager (OpenStreetMap Reverse Geocoding, Exact Map-Point Buildings & Tower Defense)
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

    this.renderExistingFortifiedMarkers();
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
        isOwned: false,
        turretLevel: 0,
        shieldHp: 0,
        beaconActive: false,
        owner: null,
        color: '#ff8000',
        boughtAt: null
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

  buyBuilding(poi, ownerName, color) {
    const newFort = {
      isOwned: true,
      owner: ownerName || 'Tagger',
      color: color || '#ff8000',
      turretLevel: 1,
      shieldHp: 100,
      beaconActive: false,
      boughtAt: Date.now(),
      poiData: poi
    };

    this.setFortification(poi.id, newFort);
    this.addOrUpdateMarker(poi, newFort);
    return newFort;
  }

  /**
   * Resolves exact building / POI at any clicked map coordinate via OSM Reverse Geocoding
   */
  async resolvePoint(lat, lng) {
    const hexId = h3.latLngToCell(lat, lng, 10);
    const cleanLat = Number(lat.toFixed(5));
    const cleanLng = Number(lng.toFixed(5));
    const poiId = `bld_${cleanLat}_${cleanLng}`;

    // Check if this point was already bought / saved
    const existing = this.getFortification(poiId);
    if (existing && existing.poiData) {
      return { ...existing.poiData, id: poiId };
    }

    try {
      // Nominatim OpenStreetMap Reverse Geocode API
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`,
        { headers: { 'Accept-Language': 'de' } }
      );

      if (res.ok) {
        const data = await res.json();
        const addr = data.address || {};
        const buildingName =
          data.name ||
          (addr.road ? `${addr.road} ${addr.house_number || ''}`.trim() : null) ||
          data.display_name?.split(',')[0] ||
          'Cyber Gebäude';

        const { type, icon, category } = this.categorizeAddress(data);

        const pointData = {
          id: poiId,
          name: buildingName,
          lat,
          lng,
          hexId,
          icon,
          category,
          type,
          fullAddress: data.display_name
        };

        return pointData;
      }
    } catch (e) {
      console.warn('[PoiManager] Reverse geocoding network fallback:', e.message);
    }

    // Procedural Fallback
    return {
      id: poiId,
      name: `SEKTOR-KNOTEN ${hexId.slice(-6).toUpperCase()}`,
      lat,
      lng,
      hexId,
      icon: '🏢',
      category: 'GEBÄUDE-KOMPLEX',
      type: 'building',
      fullAddress: `Waben-Koordinate (${lat.toFixed(4)}, ${lng.toFixed(4)})`
    };
  }

  categorizeAddress(data) {
    const addr = data.address || {};
    const ext = data.extratags || {};
    const cat = data.category || '';
    const type = data.type || '';

    if (cat === 'historic' || cat === 'tourism' || type === 'attraction' || type === 'monument') {
      return { type: 'monument', icon: '🏛️', category: 'HISTORISCHES DENKMAL' };
    }
    if (addr.amenity === 'cafe' || addr.amenity === 'bar' || addr.amenity === 'restaurant' || type === 'pub') {
      return { type: 'cafe', icon: '☕', category: 'STREET-HUB & CAFÉ' };
    }
    if (addr.railway || type === 'station' || type === 'subway') {
      return { type: 'station', icon: '🚉', category: 'TRANSIT-KNOTENPUNKT' };
    }
    if (addr.amenity === 'library' || addr.amenity === 'university' || addr.amenity === 'townhall') {
      return { type: 'library', icon: '🏢', category: 'ÖFFENTLICHES GEBÄUDE' };
    }
    if (addr.amenity === 'bank' || addr.shop) {
      return { type: 'shop', icon: '🏦', category: 'HANDELS-ZENTRUM' };
    }
    if (cat === 'power' || cat === 'telecom') {
      return { type: 'telecom', icon: '⚡', category: 'ENERGIE & NETZWERK' };
    }

    return { type: 'building', icon: '🏢', category: 'WOHN- & GEWERBEBAU' };
  }

  renderExistingFortifiedMarkers() {
    if (!this.map) return;
    Object.keys(this.fortifiedNodes).forEach(id => {
      const fort = this.fortifiedNodes[id];
      if (fort.poiData && fort.isOwned) {
        this.addOrUpdateMarker(fort.poiData, fort);
      }
    });
  }

  addOrUpdateMarker(poi, fort) {
    if (!this.map || !poi) return;

    if (this.markers.has(poi.id)) {
      this.updateMarkerVisual(poi.id);
      return;
    }

    const el = document.createElement('div');
    el.className = 'poi-map-marker';
    el.id = `marker_${poi.id}`;
    el.innerHTML = `
      <div class="poi-marker-badge fortified" style="--poi-color: ${fort.color || '#ff8000'}">
        <span class="poi-marker-icon">${poi.icon || '🏢'}</span>
        <span class="poi-marker-name">${(poi.name || 'Gebäude').slice(0, 16)}</span>
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
  }

  updateMarkerVisual(poiId) {
    const marker = this.markers.get(poiId);
    if (!marker) return;

    const fort = this.getFortification(poiId);
    const poi = fort.poiData;
    const el = marker.getElement();
    if (el && poi) {
      el.innerHTML = `
        <div class="poi-marker-badge ${fort.isOwned ? 'fortified' : ''}" style="--poi-color: ${fort.color || '#ff8000'}">
          <span class="poi-marker-icon">${poi.icon || '🏢'}</span>
          <span class="poi-marker-name">${(poi.name || 'Gebäude').slice(0, 16)}</span>
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
