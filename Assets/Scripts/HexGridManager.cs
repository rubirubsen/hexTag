using System;
using UnityEngine;

namespace HexTag.Core
{
    [Serializable]
    public struct HexCoordinate : IEquatable<HexCoordinate>
    {
        public int Q; // Column / Axial Q
        public int R; // Row / Axial R

        public HexCoordinate(int q, int r)
        {
            Q = q;
            R = r;
        }

        public string ToHexId()
        {
            return $"hex_{Q}_{R}";
        }

        public bool Equals(HexCoordinate other)
        {
            return Q == other.Q && R == other.R;
        }

        public override bool Equals(object obj)
        {
            return obj is HexCoordinate other && Equals(other);
        }

        public override int GetHashCode()
        {
            return HashCode.Combine(Q, R);
        }

        public override string ToString()
        {
            return $"({Q}, {R})";
        }
    }

    public class HexGridManager : MonoBehaviour
    {
        public static HexGridManager Instance { get; private set; }

        [Header("Hex Grid Settings")]
        [Tooltip("Ungefaehre Waben-Kantenlaenge / Radius in Metern.")]
        [SerializeField] private double hexRadiusMeters = 35.0;

        [Header("King of the Hill Rules")]
        [Tooltip("Benoetigte Verweildauer in Sekunden zur Eroberung der Wabe.")]
        [SerializeField] private float captureDurationSeconds = 180f;
        [SerializeField] private string currentPlayerId = "Player_Red_01";

        public HexCoordinate CurrentHex { get; private set; }
        public string CurrentHexId => CurrentHex.ToHexId();
        public float CurrentTimer { get; private set; }
        public bool IsCapturing { get; private set; }

        public event Action<string, string> OnZoneCaptured; // hexId, playerId
        public event Action<string, float, float> OnCaptureProgress; // hexId, progress01, remainingTime
        public event Action<string, string> OnZoneChanged; // oldHexId, newHexId

        private void Awake()
        {
            if (Instance != null && Instance != this)
            {
                Destroy(gameObject);
                return;
            }
            Instance = this;
        }

        private void Start()
        {
            if (GPSManager.Instance != null)
            {
                GPSManager.Instance.OnLocationUpdated += HandleLocationUpdated;
            }
        }

        private void OnDestroy()
        {
            if (GPSManager.Instance != null)
            {
                GPSManager.Instance.OnLocationUpdated -= HandleLocationUpdated;
            }
        }

        private void Update()
        {
            if (!GPSManager.Instance || !GPSManager.Instance.IsLocationReady)
            {
                return;
            }

            if (IsCapturing)
            {
                CurrentTimer += Time.deltaTime;
                float progress = Mathf.Clamp01(CurrentTimer / captureDurationSeconds);
                float remainingTime = Mathf.Max(0f, captureDurationSeconds - CurrentTimer);

                OnCaptureProgress?.Invoke(CurrentHexId, progress, remainingTime);

                if (CurrentTimer >= captureDurationSeconds)
                {
                    CompleteCapture();
                }
            }
        }

        private void HandleLocationUpdated(double lat, double lon)
        {
            HexCoordinate newHex = LatLonToHex(lat, lon, hexRadiusMeters);

            if (!newHex.Equals(CurrentHex) || !IsCapturing)
            {
                string oldHexId = CurrentHexId;
                CurrentHex = newHex;
                CurrentTimer = 0f;
                IsCapturing = true;

                Debug.Log($"[HexGridManager] Wabe gewechselt zu {CurrentHexId}. Eroberungstimer gestartet ({captureDurationSeconds}s).");
                OnZoneChanged?.Invoke(oldHexId, CurrentHexId);
            }
        }

        private void CompleteCapture()
        {
            IsCapturing = false;
            CurrentTimer = captureDurationSeconds;

            Debug.Log($"[HexGridManager] Wabe {CurrentHexId} erfolgreich von {currentPlayerId} erobert!");

            if (MockBackend.Instance != null)
            {
                MockBackend.Instance.CaptureWabe(CurrentHexId, currentPlayerId);
            }

            OnZoneCaptured?.Invoke(CurrentHexId, currentPlayerId);
        }

        /// <summary>
        /// Mathematische Projektion von WGS84 GPS-Koordinaten in ein axiales Hexagon-Gitter (Flat-topped Hexagon).
        /// </summary>
        public static HexCoordinate LatLonToHex(double latitude, double longitude, double hexSizeMeters)
        {
            // Umrechnung von GPS in metrische planar-Koordinaten (Mercator-Approximation)
            double latRad = latitude * (Math.PI / 180.0);
            double metersPerDegreeLat = 111320.0;
            double metersPerDegreeLon = 111320.0 * Math.Cos(latRad);

            double xMeters = longitude * metersPerDegreeLon;
            double yMeters = latitude * metersPerDegreeLat;

            // Flat-Topped Hexagon Matrix-Inversion
            // x = size * 3/2 * q
            // y = size * sqrt(3) * (r + q/2)
            double qFrac = (2.0 / 3.0 * xMeters) / hexSizeMeters;
            double rFrac = (-1.0 / 3.0 * xMeters + Math.Sqrt(3.0) / 3.0 * yMeters) / hexSizeMeters;

            return CubeRound(qFrac, rFrac);
        }

        private static HexCoordinate CubeRound(double qFrac, double rFrac)
        {
            double sFrac = -qFrac - rFrac;

            int q = (int)Math.Round(qFrac);
            int r = (int)Math.Round(rFrac);
            int s = (int)Math.Round(sFrac);

            double qDiff = Math.Abs(q - qFrac);
            double rDiff = Math.Abs(r - rFrac);
            double sDiff = Math.Abs(s - sFrac);

            if (qDiff > rDiff && qDiff > sDiff)
            {
                q = -r - s;
            }
            else if (rDiff > sDiff)
            {
                r = -q - s;
            }

            return new HexCoordinate(q, r);
        }

        public void SetPlayerId(string newPlayerId)
        {
            currentPlayerId = newPlayerId;
        }
    }
}
