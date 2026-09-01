/**
 * Lightweight WebAR & Camera Gyroscope Graffiti Viewer
 */
export class ARViewer {
  constructor(videoElement, containerElement, onBack) {
    this.video = videoElement;
    this.container = containerElement;
    this.onBack = onBack;
    this.stream = null;
    this.isActive = false;
    this.tagsOverlay = containerElement.querySelector('.ar-tags-layer');
    this.yaw = 0;
    this.pitch = 0;

    this.handleOrientation = this.handleOrientation.bind(this);
  }

  async start(currentTags = []) {
    this.isActive = true;
    this.container.classList.add('active');

    try {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        this.stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false
        });
        this.video.srcObject = this.stream;
        await this.video.play();
      }
    } catch (e) {
      console.warn('[ARViewer] Kamera konnte nicht gestartet werden (z.B. Desktop/fehlende Rechte):', e);
      this.video.style.background = 'radial-gradient(circle, #1a2236 0%, #080c14 100%)';
    }

    // Orientierungs-Sensoren (Handy-Bewegung)
    if (window.DeviceOrientationEvent) {
      window.addEventListener('deviceorientation', this.handleOrientation);
    }

    this.renderTags(currentTags);
  }

  handleOrientation(e) {
    if (!this.isActive) return;
    const alpha = e.alpha || 0; // Kompass (0 - 360)
    const beta = e.beta || 0;   // Neigung (Front/Back)
    const gamma = e.gamma || 0; // Neigung (Left/Right)

    if (this.tagsOverlay) {
      // Parallax-Verschiebung der Graffitis passend zur Handy-Bewegung
      const moveX = (gamma * 4);
      const moveY = ((beta - 45) * 4);
      this.tagsOverlay.style.transform = `translate(${moveX}px, ${moveY}px)`;
    }
  }

  renderTags(tags) {
    if (!this.tagsOverlay) return;
    this.tagsOverlay.innerHTML = '';

    if (tags.length === 0) {
      const emptyNotice = document.createElement('div');
      emptyNotice.className = 'ar-empty-badge';
      emptyNotice.innerHTML = '<span>NOCH KEINE GRAFFITIS HIER</span><small>Sei der Erste und spraye einen Tag!</small>';
      this.tagsOverlay.appendChild(emptyNotice);
      return;
    }

    // Platziere die Tags versetzt im virtuellen Raum
    tags.forEach((tag, idx) => {
      const tagCard = document.createElement('div');
      tagCard.className = 'ar-graffiti-item';
      
      const offsetX = (idx % 3 - 1) * 110;
      const offsetY = Math.floor(idx / 3) * 120 - 40;
      tagCard.style.transform = `translate(${offsetX}px, ${offsetY}px)`;

      tagCard.innerHTML = `
        <div class="tag-meta">${tag.author} • ${new Date(tag.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
        <img src="${tag.imageBase64}" alt="Graffiti Tag" class="tag-img" />
      `;
      this.tagsOverlay.appendChild(tagCard);
    });
  }

  stop() {
    this.isActive = false;
    this.container.classList.remove('active');

    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }

    window.removeEventListener('deviceorientation', this.handleOrientation);
    if (this.onBack) this.onBack();
  }
}
