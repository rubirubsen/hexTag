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
    try {
      // Nominatim OpenStreetMap Reverse Geocode API (Zoom 18 = Building-level precision)
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1&extratags=1`,
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

        // Exact OpenStreetMap centroid coordinates
        const osmLat = data.lat ? parseFloat(data.lat) : lat;
        const osmLng = data.lon ? parseFloat(data.lon) : lng;
        const poiId = data.osm_id ? `osm_${data.osm_type || 'way'}_${data.osm_id}` : `bld_${osmLat.toFixed(5)}_${osmLng.toFixed(5)}`;
        const hexId = h3.latLngToCell(osmLat, osmLng, 10);

        // Check if already in fortified nodes
        const existing = this.getFortification(poiId);
        if (existing && existing.poiData) {
          return { ...existing.poiData, id: poiId };
        }

        const { type, icon, category } = this.categorizeAddress(data);

        const pointData = {
          id: poiId,
          osmId: data.osm_id,
          osmType: data.osm_type,
          name: buildingName,
          lat: osmLat,
          lng: osmLng,
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
    const hexId = h3.latLngToCell(lat, lng, 10);
    const poiId = `bld_${lat.toFixed(5)}_${lng.toFixed(5)}`;
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
      <div class="poi-pin ${fort.isOwned ? 'fortified' : ''}" style="--poi-color: ${fort.color || '#ff8000'}" title="${poi.name || 'Gebäude'}">
        <span class="poi-pin-icon">${poi.icon || '🏢'}</span>
        ${fort.turretLevel > 0 ? `<div class="poi-turret-orbit-dot"></div>` : ''}
        ${fort.shieldHp > 0 ? `<div class="poi-shield-aura"></div>` : ''}
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
        <div class="poi-pin ${fort.isOwned ? 'fortified' : ''}" style="--poi-color: ${fort.color || '#ff8000'}" title="${poi.name || 'Gebäude'}">
          <span class="poi-pin-icon">${poi.icon || '🏢'}</span>
          ${fort.turretLevel > 0 ? `<div class="poi-turret-orbit-dot"></div>` : ''}
          ${fort.shieldHp > 0 ? `<div class="poi-shield-aura"></div>` : ''}
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
