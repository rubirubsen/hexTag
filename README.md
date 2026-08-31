# hexTag

Location-Based Augmented Reality (AR) & Hex-Grid Territory Game in Unity (C#).

Alle Details, Architektur-Entscheidungen, Unity-Setup-Anleitungen und die Roadmap findest du in der Dokumentation:
👉 **[PROJECT_OVERVIEW.md](./PROJECT_OVERVIEW.md)**

## Schnellstart mit Docker 🐳
```bash
docker compose up -d --build
```
Die App ist danach unter `http://localhost:8080` erreichbar.

## Lokale Entwicklung (Node.js)
```bash
npm install
npm run dev
```

## Schnellübersicht Skripte
- [`src/main.js`](./src/main.js): WebApp-Logik (MapLibre, H3-Hexagon-Raster, Live-Timer & Passive Income).
- [`src/style.css`](./src/style.css): Cyberpunk HUD & Map-Design.
- [`GPSManager.cs`](./Assets/Scripts/GPSManager.cs): GPS-Tracking, Editor-Simulation & Haversine-Distanz (Unity-Alternative).
- [`HexGridManager.cs`](./Assets/Scripts/HexGridManager.cs): Waben-Projektion & 180s Eroberungslogik (Unity-Alternative).
- [`ARPlacementManager.cs`](./Assets/Scripts/ARPlacementManager.cs): AR Foundation Placement & Verankerung.
- [`MockBackend.cs`](./Assets/Scripts/MockBackend.cs): Offline Mock-Datenbank für Graffitis und Zonen.

