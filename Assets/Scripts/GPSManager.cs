using System;
using System.Collections;
using UnityEngine;

namespace HexTag.Core
{
    public class GPSManager : MonoBehaviour
    {
        public static GPSManager Instance { get; private set; }

        [Header("GPS Settings")]
        [SerializeField] private float desiredAccuracyInMeters = 5f;
        [SerializeField] private float updateDistanceInMeters = 1f;
        [SerializeField] private float locationServiceTimeout = 20f;

        [Header("Editor / Debug Simulation")]
        [SerializeField] private bool enableEditorSimulation = true;
        [SerializeField] private double simulatedLatitude = 52.520008; // Example: Berlin Lat
        [SerializeField] private double simulatedLongitude = 13.404954; // Example: Berlin Lon
        [SerializeField] private float simulatedAltitude = 34f;

        public double CurrentLatitude { get; private set; }
        public double CurrentLongitude { get; private set; }
        public float CurrentAltitude { get; private set; }
        public bool IsLocationReady { get; private set; }

        public event Action<double, double> OnLocationUpdated;

        private const double EarthRadiusKm = 6371.0;

        private void Awake()
        {
            if (Instance != null && Instance != this)
            {
                Destroy(gameObject);
                return;
            }
            Instance = this;
            DontDestroyOnLoad(gameObject);
        }

        private IEnumerator Start()
        {
#if UNITY_EDITOR
            if (enableEditorSimulation)
            {
                CurrentLatitude = simulatedLatitude;
                CurrentLongitude = simulatedLongitude;
                CurrentAltitude = simulatedAltitude;
                IsLocationReady = true;
                Debug.Log($"[GPSManager] Unity Editor Simulation aktiv. Lat: {CurrentLatitude}, Lon: {CurrentLongitude}");
                OnLocationUpdated?.Invoke(CurrentLatitude, CurrentLongitude);
                yield break;
            }
#endif

            if (!Input.location.isEnabledByUser)
            {
                Debug.LogWarning("[GPSManager] GPS/Standortdienste sind auf dem Geraet deaktiviert.");
            }

            Input.location.Start(desiredAccuracyInMeters, updateDistanceInMeters);

            float timer = 0f;
            while (Input.location.status == LocationServiceStatus.Initializing && timer < locationServiceTimeout)
            {
                yield return new WaitForSeconds(1f);
                timer += 1f;
            }

            if (timer >= locationServiceTimeout)
            {
                Debug.LogError("[GPSManager] Standort-Initialisierung: Timeout ueberschritten.");
                yield break;
            }

            if (Input.location.status == LocationServiceStatus.Failed)
            {
                Debug.LogError("[GPSManager] GPS-Standort konnte nicht ermittelt werden.");
                yield break;
            }

            IsLocationReady = true;
            Debug.Log("[GPSManager] GPS-Tracking erfolgreich gestartet.");

            while (enabled)
            {
                if (Input.location.status == LocationServiceStatus.Running)
                {
                    CurrentLatitude = Input.location.lastData.latitude;
                    CurrentLongitude = Input.location.lastData.longitude;
                    CurrentAltitude = Input.location.lastData.altitude;

                    OnLocationUpdated?.Invoke(CurrentLatitude, CurrentLongitude);
                }
                yield return new WaitForSeconds(1f);
            }
        }

        private void OnDisable()
        {
            if (Input.location.status == LocationServiceStatus.Running)
            {
                Input.location.Stop();
            }
        }

        /// <summary>
        /// Berechnet die exakte Distanz zwischen zwei GPS-Koordinaten in Metern mittels Haversine-Formel.
        /// </summary>
        public static double CalculateHaversineDistanceInMeters(double lat1, double lon1, double lat2, double lon2)
        {
            double dLat = DegreesToRadians(lat2 - lat1);
            double dLon = DegreesToRadians(lon2 - lon1);

            double lat1Rad = DegreesToRadians(lat1);
            double lat2Rad = DegreesToRadians(lat2);

            double a = Math.Sin(dLat / 2.0) * Math.Sin(dLat / 2.0) +
                       Math.Cos(lat1Rad) * Math.Cos(lat2Rad) *
                       Math.Sin(dLon / 2.0) * Math.Sin(dLon / 2.0);

            double c = 2.0 * Math.Atan2(Math.Sqrt(a), Math.Sqrt(1.0 - a));
            double distanceKm = EarthRadiusKm * c;

            return distanceKm * 1000.0;
        }

        private static double DegreesToRadians(double degrees)
        {
            return degrees * (Math.PI / 180.0);
        }

        public void SetSimulatedCoordinates(double lat, double lon)
        {
            simulatedLatitude = lat;
            simulatedLongitude = lon;
            CurrentLatitude = lat;
            CurrentLongitude = lon;
            OnLocationUpdated?.Invoke(CurrentLatitude, CurrentLongitude);
        }
    }
}
