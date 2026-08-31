using System;
using System.Collections.Generic;
using UnityEngine;

namespace HexTag.Core
{
    [Serializable]
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

    [Serializable]
    public class WabenData
    {
        public string hexId;
        public string ownerPlayerId;
        public string teamId;
        public float totalTimeHeldSeconds;
        public long lastCapturedUnix;
        public int captureCount;
    }

    public class MockBackend : MonoBehaviour
    {
        public static MockBackend Instance { get; private set; }

        private readonly Dictionary<string, WabenData> _wabenDatabase = new Dictionary<string, WabenData>();
        private readonly List<GraffitiData> _graffitiDatabase = new List<GraffitiData>();

        public event Action<GraffitiData> OnGraffitiAdded;
        public event Action<WabenData> OnWabeCaptured;

        private void Awake()
        {
            if (Instance != null && Instance != this)
            {
                Destroy(gameObject);
                return;
            }
            Instance = this;
            DontDestroyOnLoad(gameObject);

            InitializeSeedData();
        }

        private void InitializeSeedData()
        {
            // Initialer Test-Datensatz fuer Demozwecke
            CaptureWabe("hex_0_0", "Player_Blue_Demo");
            Debug.Log("[MockBackend] Mock-Datenbank initialisiert.");
        }

        public void SaveGraffiti(GraffitiData data)
        {
            if (data == null) return;

            if (string.IsNullOrEmpty(data.id))
            {
                data.id = Guid.NewGuid().ToString();
            }
            data.timestampUnix = DateTimeOffset.UtcNow.ToUnixTimeSeconds();

            _graffitiDatabase.Add(data);
            Debug.Log($"[MockBackend] Graffiti '{data.id}' an GPS ({data.latitude:F6}, {data.longitude:F6}) in Wabe '{data.hexId}' gespeichert.");
            OnGraffitiAdded?.Invoke(data);
        }

        public void CaptureWabe(string hexId, string playerId, string teamId = "Team_Alpha")
        {
            if (string.IsNullOrEmpty(hexId)) return;

            if (!_wabenDatabase.TryGetValue(hexId, out WabenData wabe))
            {
                wabe = new WabenData
                {
                    hexId = hexId,
                    captureCount = 0,
                    totalTimeHeldSeconds = 0f
                };
                _wabenDatabase[hexId] = wabe;
            }

            wabe.ownerPlayerId = playerId;
            wabe.teamId = teamId;
            wabe.lastCapturedUnix = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
            wabe.captureCount++;

            Debug.Log($"[MockBackend] Wabe {hexId} gehoert nun {playerId} ({teamId}). Gesamteroberungen: {wabe.captureCount}");
            OnWabeCaptured?.Invoke(wabe);
        }

        public WabenData GetWabe(string hexId)
        {
            if (_wabenDatabase.TryGetValue(hexId, out WabenData wabe))
            {
                return wabe;
            }
            return null;
        }

        public List<GraffitiData> GetNearbyGraffitis(double currentLat, double currentLon, double searchRadiusMeters = 50.0)
        {
            List<GraffitiData> nearby = new List<GraffitiData>();

            foreach (var item in _graffitiDatabase)
            {
                double dist = GPSManager.CalculateHaversineDistanceInMeters(
                    currentLat, currentLon, item.latitude, item.longitude);

                if (dist <= searchRadiusMeters)
                {
                    nearby.Add(item);
                }
            }

            return nearby;
        }

        public IReadOnlyList<GraffitiData> GetAllGraffitis()
        {
            return _graffitiDatabase.AsReadOnly();
        }
    }
}
