# hexTag - Location-Based AR & Hex-Grid Prototype

## 1. Projektübersicht & Spielkonzept

**hexTag** ist ein mobiles Location-Based Augmented Reality (AR) Spiel für Android/iOS (Unity C#), das zwei Kernmechaniken verbindet:

1. **AR-Graffiti:** Spieler platzieren virtuelle Graffitis (Bilder/Texturen) an realen ARCore/ARKit-Ankern im 3D-Raum, gekoppelt an die exakten GPS-Koordinaten.
2. **Waben-Eroberung (King of the Hill / H3 Hex-Logik):** Die Welt ist in hexagonale Waben unterteilt. Hält sich ein Spieler 180 Sekunden (3 Minuten) durchgehend innerhalb einer Wabe auf, erobert er sie für sein Team.

---

## 2. Projektstruktur & Skripte

Alle C#-Skripte befinden sich in [`Assets/Scripts/`](./Assets/Scripts/):

| Skript | Datei | Zweck / Kernfunktionen |
| :--- | :--- | :--- |
| **`GPSManager`** | [`GPSManager.cs`](./Assets/Scripts/GPSManager.cs) | Initialisiert Android/iOS Standortdienste, liest Lat/Lon/Alt aus, liefert Editor-GPS-Simulation & berechnet Distanzen via Haversine-Formel. |
| **`HexGridManager`** | [`HexGridManager.cs`](./Assets/Scripts/HexGridManager.cs) | Projiziert GPS-Koordinaten in ein axiales Hexagon-Raster (Flat-Topped), managt den 180s-Eroberungstimer & feuert Events (`OnZoneCaptured`, `OnCaptureProgress`). |
| **`ARPlacementManager`** | [`ARPlacementManager.cs`](./Assets/Scripts/ARPlacementManager.cs) | Führt AR-Raycasts auf erkannte Flächen aus, erzeugt `ARAnchor`s, instanziiert Graffiti-Quads und verknüpft sie mit GPS & Hex-ID. |
| **`MockBackend`** | [`MockBackend.cs`](./Assets/Scripts/MockBackend.cs) | Lokale Offline-Datenbank-Simulation für `GraffitiData` und `WabenData`. Ermöglicht Speichern, Laden und Umkreis-Abfragen (`GetNearbyGraffitis`). |
| **`GameHUDController`** | [`GameHUDController.cs`](./Assets/Scripts/GameHUDController.cs) | Beispiel-UI-Controller für Canvas-Elemente (GPS-Koordinaten, Waben-ID, Countdown-Timer, Progress-Bar und Benachrichtigungen). |

---

## 3. Datenmodelle & Datenstrukturen

### `GraffitiData`
```csharp
public class GraffitiData
{
    public string id;
    public double latitude;
    public double longitude;
    public float altitude;
    public Vector3 localAnchorPosition;
    public Quaternion localAnchorRotation;
    public string imageBase64;
    public string authorPlayerId;
    public string hexId;
    public long timestampUnix;
}
```

### `WabenData`
```csharp
public class WabenData
{
    public string hexId;                // Format: "hex_Q_R"
    public string ownerPlayerId;
    public string teamId;
    public float totalTimeHeldSeconds;
    public long lastCapturedUnix;
    public int captureCount;
}
```

---

## 4. Unity Setup & Konfiguration

### Erforderliche Packages (Package Manager)
- `AR Foundation` (v5.x oder v6.x)
- `Google ARCore XR Plugin` (für Android)
- `Apple ARKit XR Plugin` (für iOS)

### Szene-Hierarchie
```text
Root
├── XR Origin (AR Session Origin)
│   ├── Camera Offset
│   │   └── Main Camera (AR Camera)
│   ├── AR Plane Manager
│   ├── AR Raycast Manager
│   └── AR Anchor Manager
├── AR Session
├── [GameManagers]
│   ├── GPSManager
│   ├── HexGridManager
│   ├── ARPlacementManager
│   └── MockBackend
└── [Canvas_HUD]
    └── GameHUDController (verknüpft mit UI-Texten & Slider)
```

### Android Build & Permissions
- **Project Settings > Player > Android > Other Settings:**
  - *Minimum API Level:* Android 7.0 (API Level 24) oder höher
  - *Location Usage Description / Access Fine Location:* Aktiviert
  - *ARCore Supported:* Aktiviert

---

## 5. Testen & Debugging

### Im Unity Editor (Ohne Smartphone)
- `GPSManager` schaltet automatisch in den Simulationsmodus (Standard: Berlin Alexanderplatz).
- Ein Mausklick im Game View platziert ein Test-Graffiti 1.5m vor der Kamera.
- Der 180s-Timer der aktuellen Wabe läuft im Editor automatisch ab und löst `OnZoneCaptured` aus.

### Auf dem physischen Smartphone
- Startet echte GPS-Erfassung.
- Touch-Taps auf reale Oberflächen setzen AR-verankerte Graffitis ab.

---

## 6. Nächste Schritte & Backlog für die nächste Session

1. **Mobile Bildauswahl (Native Gallery / Image Picker):**
   - Einbindung eines mobilen File-Pickers, damit Spieler eigene Fotos aus der Fotogalerie hochladen können.
2. **Kartenansicht (2D/3D Mapbox oder MapLibre):**
   - Mini-Map / Vollbildkarte mit Visualisierung der hexagonalen Waben und Team-Farben.
3. **Backend-Anbindung (Firebase / Supabase / WebSocket Node.js):**
   - Ersetzen von `MockBackend.cs` durch ein Live-Multiplayer-Backend mit Realtime-Synchronisation.
4. **Shader & Graffiti-Rendering:**
   - Decal-Shader oder Unlit/Blend-Shader für realistische Wandanpassung der Graffitis.
5. **Zone-Defense & Contested-Mechanik:**
   - Timer pausieren/zurücksetzen, wenn Spieler gegnerischer Teams gleichzeitig in derselben Wabe sind.
