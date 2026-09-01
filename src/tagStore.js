// Persistent Tag & Graffiti Storage (LocalStorage Simulation)
const STORAGE_KEY = 'hextag_graffiti_store';

class TagStore {
  constructor() {
    this.tags = this.loadFromStorage();
  }

  loadFromStorage() {
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      return data ? JSON.parse(data) : [];
    } catch (e) {
      console.warn('[TagStore] Fehler beim Laden aus LocalStorage:', e);
      return [];
    }
  }

  saveToStorage() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.tags));
    } catch (e) {
      console.warn('[TagStore] Speicherlimit erreicht oder Fehler:', e);
    }
  }

  /**
   * Speichert ein neues Graffiti fuer eine Wabe
   */
  addTag({ hexId, lat, lng, author, color, imageBase64, type = 'draw' }) {
    const newTag = {
      id: 'tag_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 4),
      hexId,
      lat,
      lng,
      author: author || 'TAGGER_01',
      color: color || '#ff0055',
      imageBase64,
      type, // 'draw' | 'sticker' | 'gif'
      timestamp: Date.now()
    };

    this.tags.unshift(newTag); // Neueste Tags zuerst
    this.saveToStorage();
    return newTag;
  }

  getTagsForHex(hexId) {
    return this.tags.filter(t => t.hexId === hexId);
  }

  getAllTags() {
    return this.tags;
  }

  getTagCountForHex(hexId) {
    return this.tags.filter(t => t.hexId === hexId).length;
  }
}

export const tagStore = new TagStore();
