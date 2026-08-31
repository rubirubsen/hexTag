using UnityEngine;
using UnityEngine.UI;

namespace HexTag.Core
{
    public class GameHUDController : MonoBehaviour
    {
        [Header("UI Text Referenzen (Unity UI / TextMeshPro)")]
        [SerializeField] private Text gpsText;
        [SerializeField] private Text hexInfoText;
        [SerializeField] private Text timerText;
        [SerializeField] private Slider captureProgressBar;
        [SerializeField] private Text statusNotificationText;

        private void Start()
        {
            if (GPSManager.Instance != null)
            {
                GPSManager.Instance.OnLocationUpdated += UpdateGPSDisplay;
            }

            if (HexGridManager.Instance != null)
            {
                HexGridManager.Instance.OnCaptureProgress += UpdateCaptureProgress;
                HexGridManager.Instance.OnZoneCaptured += HandleZoneCaptured;
                HexGridManager.Instance.OnZoneChanged += HandleZoneChanged;
            }

            if (MockBackend.Instance != null)
            {
                MockBackend.Instance.OnGraffitiAdded += HandleGraffitiAdded;
            }
        }

        private void OnDestroy()
        {
            if (GPSManager.Instance != null)
            {
                GPSManager.Instance.OnLocationUpdated -= UpdateGPSDisplay;
            }

            if (HexGridManager.Instance != null)
            {
                HexGridManager.Instance.OnCaptureProgress -= UpdateCaptureProgress;
                HexGridManager.Instance.OnZoneCaptured -= HandleZoneCaptured;
                HexGridManager.Instance.OnZoneChanged -= HandleZoneChanged;
            }

            if (MockBackend.Instance != null)
            {
                MockBackend.Instance.OnGraffitiAdded -= HandleGraffitiAdded;
            }
        }

        private void UpdateGPSDisplay(double lat, double lon)
        {
            if (gpsText != null)
            {
                gpsText.text = $"GPS: {lat:F5}, {lon:F5}";
            }
        }

        private void UpdateCaptureProgress(string hexId, float progress, float remainingTime)
        {
            if (hexInfoText != null)
            {
                hexInfoText.text = $"Wabe: {hexId}";
            }

            if (captureProgressBar != null)
            {
                captureProgressBar.value = progress;
            }

            if (timerText != null)
            {
                int minutes = Mathf.FloorToInt(remainingTime / 60F);
                int seconds = Mathf.FloorToInt(remainingTime - minutes * 60);
                timerText.text = $"{minutes:00}:{seconds:00}";
            }
        }

        private void HandleZoneChanged(string oldHex, string newHex)
        {
            if (statusNotificationText != null)
            {
                statusNotificationText.text = $"Neue Zone betreten: {newHex}";
            }
        }

        private void HandleZoneCaptured(string hexId, string playerId)
        {
            if (statusNotificationText != null)
            {
                statusNotificationText.text = $"Zone {hexId} erobert von {playerId}!";
            }
        }

        private void HandleGraffitiAdded(GraffitiData data)
        {
            if (statusNotificationText != null)
            {
                statusNotificationText.text = $"Graffiti {data.id} platziert!";
            }
        }
    }
}
