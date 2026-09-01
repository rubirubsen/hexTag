/**
 * Cyberpunk FreeDraw & Spray Paint Canvas Tool
 */
export class GraffitiCanvas {
  constructor(canvasElement) {
    this.canvas = canvasElement;
    this.ctx = this.canvas.getContext('2d');

    this.isDrawing = false;
    this.brushColor = '#ff0055';
    this.brushSize = 8;
    this.brushMode = 'spray'; // 'spray' | 'brush' | 'neon'
    this.history = [];

    this.initCanvasSize();
    this.setupEvents();
  }

  initCanvasSize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = (rect.width || 360) * dpr;
    this.canvas.height = (rect.height || 360) * dpr;
    this.ctx.scale(dpr, dpr);
    this.clear();
  }

  setupEvents() {
    const getPos = (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      return {
        x: clientX - rect.left,
        y: clientY - rect.top
      };
    };

    const startDraw = (e) => {
      e.preventDefault();
      this.isDrawing = true;
      this.saveState();
      const pos = getPos(e);
      this.lastPos = pos;
      this.draw(pos.x, pos.y);
    };

    const moveDraw = (e) => {
      if (!this.isDrawing) return;
      e.preventDefault();
      const pos = getPos(e);
      this.draw(pos.x, pos.y);
      this.lastPos = pos;
    };

    const stopDraw = (e) => {
      if (this.isDrawing) {
        this.isDrawing = false;
      }
    };

    this.canvas.addEventListener('mousedown', startDraw);
    this.canvas.addEventListener('mousemove', moveDraw);
    window.addEventListener('mouseup', stopDraw);

    this.canvas.addEventListener('touchstart', startDraw, { passive: false });
    this.canvas.addEventListener('touchmove', moveDraw, { passive: false });
    window.addEventListener('touchend', stopDraw);
  }

  draw(x, y) {
    this.ctx.fillStyle = this.brushColor;
    this.ctx.strokeStyle = this.brushColor;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';

    if (this.brushMode === 'spray') {
      // Realistischer Partikel-Spray-Effekt
      const density = 28;
      const radius = this.brushSize * 2.2;
      for (let i = 0; i < density; i++) {
        const offsetAngle = Math.random() * Math.PI * 2;
        const offsetDist = Math.random() * radius;
        const pX = x + Math.cos(offsetAngle) * offsetDist;
        const pY = y + Math.sin(offsetAngle) * offsetDist;
        this.ctx.fillRect(pX, pY, Math.random() * 2 + 0.8, Math.random() * 2 + 0.8);
      }
    } else if (this.brushMode === 'neon') {
      // Neon Glow Pen
      this.ctx.shadowBlur = 14;
      this.ctx.shadowColor = this.brushColor;
      this.ctx.lineWidth = this.brushSize;
      this.ctx.beginPath();
      this.ctx.moveTo(this.lastPos.x, this.lastPos.y);
      this.ctx.lineTo(x, y);
      this.ctx.stroke();
      this.ctx.shadowBlur = 0;
    } else {
      // Standard Solid Marker
      this.ctx.lineWidth = this.brushSize;
      this.ctx.beginPath();
      this.ctx.moveTo(this.lastPos.x, this.lastPos.y);
      this.ctx.lineTo(x, y);
      this.ctx.stroke();
    }
  }

  setBrushColor(color) {
    this.brushColor = color;
  }

  setBrushSize(size) {
    this.brushSize = parseInt(size, 10);
  }

  setBrushMode(mode) {
    this.brushMode = mode;
  }

  clear() {
    this.saveState();
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  saveState() {
    if (this.history.length > 15) this.history.shift();
    this.history.push(this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height));
  }

  undo() {
    if (this.history.length > 0) {
      const last = this.history.pop();
      this.ctx.putImageData(last, 0, 0);
    }
  }

  exportDataURL() {
    return this.canvas.toDataURL('image/png');
  }
}
