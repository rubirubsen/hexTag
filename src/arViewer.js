/**
 * Directional Spatial WebAR ("Sie leben" Style Real-World AR Vision)
 * Pins Graffiti Tags to exact 360° compass heading, tilt, and field-of-view in real space!
 */
export class ARViewer {
  constructor(videoElement, containerElement, onBack) {
    this.video = videoElement;
    this.container = containerElement;
    this.onBack = onBack;
    this.stream = null;
    this.isActive = false;
    this.tagsOverlay = containerElement.querySelector('.ar-tags-layer');
    this.tags = [];

    this.currentHeading = 0;
    this.currentPitch = 0;
    this.currentRoll = 0;

    this.handleOrientation = this.handleOrientation.bind(this);
  }

  async start(currentTags = []) {
    this.isActive = true;
    this.tags = currentTags;
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
      console.warn('[ARViewer] Kamera konnte nicht gestartet werden:', e);
      this.video.style.background = 'radial-gradient(circle, #1a2236 0%, #080c14 100%)';
    }

    // Device orientation permissions (iOS 13+) & orientation listening
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      try {
        const response = await DeviceOrientationEvent.requestPermission();
        if (response === 'granted') {
          window.addEventListener('deviceorientation', this.handleOrientation);
        }
      } catch (err) {
        window.addEventListener('deviceorientation', this.handleOrientation);
      }
    } else if (window.DeviceOrientationEvent) {
      window.addEventListener('deviceorientation', this.handleOrientation);
    }

    this.renderSpatialTags();
  }

  handleOrientation(e) {
    if (!this.isActive) return;

    // Compass Heading (Alpha: 0 - 360)
    let heading = 0;
    if (e.webkitCompassHeading !== undefined) {
      heading = e.webkitCompassHeading;
    } else if (e.alpha !== null) {
      heading = (360 - e.alpha) % 360;
    }

    const pitch = e.beta !== null ? e.beta : 45; // Front/Back tilt
    const roll = e.gamma !== null ? e.gamma : 0;  // Left/Right tilt

    this.currentHeading = heading;
    this.currentPitch = pitch;
    this.currentRoll = roll;

    this.updateSpatialPositions();
  }

  updateSpatialPositions() {
    if (!this.tagsOverlay || this.tags.length === 0) return;

    const screenWidth = window.innerWidth || 360;
    const screenHeight = window.innerHeight || 640;
    const hFov = 65; // Horizontal field of view in degrees (~65° for smartphone cameras)
    const vFov = 45; // Vertical field of view in degrees

    const items = this.tagsOverlay.querySelectorAll('.ar-spatial-tag');

    items.forEach((el, idx) => {
      const tag = this.tags[idx];
      if (!tag) return;

      // Target Anchor: Stored heading & pitch when the author snapped/sprayed the wall
      const targetHeading = tag.heading !== undefined ? tag.heading : 180;
      const targetPitch = tag.pitch !== undefined ? tag.pitch : 45;

      // Calculate smallest angular difference in 360° circle
      let deltaHeading = (targetHeading - this.currentHeading + 540) % 360 - 180;
      let deltaPitch = (targetPitch - this.currentPitch);

      // Check if tag is in front of camera FOV (e.g. ±35° horizon)
      const isInFov = Math.abs(deltaHeading) <= (hFov / 2) && Math.abs(deltaPitch) <= (vFov / 2);

      if (isInFov) {
        // Map degrees to screen pixels
        const screenX = (screenWidth / 2) + (deltaHeading / (hFov / 2)) * (screenWidth / 2);
        const screenY = (screenHeight / 2) - (deltaPitch / (vFov / 2)) * (screenHeight / 2);

        el.style.opacity = '1';
        el.style.visibility = 'visible';
        el.style.transform = `translate(${screenX - 100}px, ${screenY - 100}px) scale(1)`;
      } else {
        // Looking at wrong wall / other direction -> Hide!
        el.style.opacity = '0';
        el.style.visibility = 'hidden';
      }
    });
  }

  renderSpatialTags() {
    if (!this.tagsOverlay) return;
    this.tagsOverlay.innerHTML = '';

    if (this.tags.length === 0) {
      const emptyNotice = document.createElement('div');
      emptyNotice.className = 'ar-empty-badge';
      emptyNotice.innerHTML = '<span>SCANNE DIE UMGEBUNG</span><small>Blicke mit der Kamera auf die Wände im Umkreis!</small>';
      this.tagsOverlay.appendChild(emptyNotice);
      return;
    }

    this.tags.forEach(tag => {
      const item = document.createElement('div');
      item.className = 'ar-spatial-tag';
      item.innerHTML = `
        <div class="ar-tag-hologram">
          <div class="ar-tag-header">
            <span class="ar-author" style="color: ${tag.color || '#00f0ff'}">${tag.author || 'ANON'}</span>
            <span class="ar-anchor-badge">📍 360° ANCHOR</span>
          </div>
          <img src="${tag.imageBase64 || tag.image_data}" alt="AR Graffiti" class="ar-graffiti-img" />
        </div>
      `;
      this.tagsOverlay.appendChild(item);
    });

    this.updateSpatialPositions();
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
