using System.Collections.Generic;
using UnityEngine;
using UnityEngine.XR.ARFoundation;
using UnityEngine.XR.ARSubsystems;

namespace HexTag.Core
{
    [RequireComponent(typeof(ARRaycastManager))]
    public class ARPlacementManager : MonoBehaviour
    {
        public static ARPlacementManager Instance { get; private set; }

        [Header("AR Core Components")]
        [SerializeField] private ARRaycastManager arRaycastManager;
        [SerializeField] private ARAnchorManager arAnchorManager;
        [SerializeField] private Camera arCamera;

        [Header("Graffiti Prefab & Visuals")]
        [Tooltip("Prefab fuer das AR-Graffiti (z.B. Quad mit Unlit/Transparent Material).")]
        [SerializeField] private GameObject graffitiPrefab;
        [SerializeField] private Texture2D defaultGraffitiTexture;

        private readonly List<ARRaycastHit> _raycastHits = new List<ARRaycastHit>();

        private void Awake()
        {
            if (Instance != null && Instance != this)
            {
                Destroy(gameObject);
                return;
            }
            Instance = this;

            if (arRaycastManager == null)
            {
                arRaycastManager = GetComponent<ARRaycastManager>();
            }

            if (arCamera == null)
            {
                arCamera = Camera.main;
            }
        }

        private void Update()
        {
            // Touch-Input fuer mobile AR-Platzierung
            if (Input.touchCount > 0)
            {
                Touch touch = Input.GetTouch(0);

                if (touch.phase == TouchPhase.Began)
                {
                    TryPlaceGraffitiAtScreenPoint(touch.position, defaultGraffitiTexture);
                }
            }

#if UNITY_EDITOR
            // Maus-Klick Fallback fuer Testen im Editor
            if (Input.GetMouseButtonDown(0))
            {
                TryPlaceGraffitiAtScreenPoint(Input.mousePosition, defaultGraffitiTexture);
            }
#endif
        }

        /// <summary>
        /// Platziert ein Graffiti an der angetippten Stelle im Raum und synchronisiert es mit GPS & MockBackend.
        /// </summary>
        public bool TryPlaceGraffitiAtScreenPoint(Vector2 screenPoint, Texture2D graffitiTexture)
        {
            Texture2D textureToApply = graffitiTexture != null ? graffitiTexture : defaultGraffitiTexture;

            // 1. AR Foundation Raycast gegen erkannte Flaechen (Planes)
            if (arRaycastManager != null && arRaycastManager.Raycast(screenPoint, _raycastHits, TrackableType.PlaneWithinPolygon | TrackableType.PlaneEstimated))
            {
                Pose hitPose = _raycastHits[0].pose;
                ARAnchor anchor = null;

                if (arAnchorManager != null)
                {
                    // Erstelle ARCore Anchor fuer ortsfeste AR-Positionierung
                    GameObject anchorObj = new GameObject("AR_Graffiti_Anchor");
                    anchorObj.transform.SetPositionAndRotation(hitPose.position, hitPose.rotation);
                    anchor = anchorObj.AddComponent<ARAnchor>();
                }

                Transform parentTransform = anchor != null ? anchor.transform : null;
                SpawnAndRegisterGraffiti(hitPose.position, hitPose.rotation, parentTransform, textureToApply);
                return true;
            }

#if UNITY_EDITOR
            // 2. Editor Fallback: Platziere 1.5m vor der Kamera
            if (arCamera != null)
            {
                Vector3 editorPosition = arCamera.transform.position + arCamera.transform.forward * 1.5f;
                Quaternion editorRotation = Quaternion.LookRotation(-arCamera.transform.forward, Vector3.up);

                SpawnAndRegisterGraffiti(editorPosition, editorRotation, null, textureToApply);
                Debug.Log("[ARPlacementManager] Graffiti im Editor-Modus platziert.");
                return true;
            }
#endif

            return false;
        }

        private void SpawnAndRegisterGraffiti(Vector3 position, Quaternion rotation, Transform parent, Texture2D texture)
        {
            GameObject spawnedGraffiti;

            if (graffitiPrefab != null)
            {
                spawnedGraffiti = Instantiate(graffitiPrefab, position, rotation, parent);
            }
            else
            {
                // Fallback: Erzeuge Standard-Quad, falls kein Prefab zugewiesen ist
                spawnedGraffiti = GameObject.CreatePrimitive(PrimitiveType.Quad);
                spawnedGraffiti.name = "Graffiti_Quad_Fallback";
                spawnedGraffiti.transform.position = position;
                spawnedGraffiti.transform.rotation = rotation;
                spawnedGraffiti.transform.localScale = new Vector3(0.8f, 0.8f, 1f);

                if (parent != null)
                {
                    spawnedGraffiti.transform.SetParent(parent, true);
                }
            }

            // Textur auf MeshRenderer anwenden
            if (texture != null)
            {
                Renderer renderer = spawnedGraffiti.GetComponentInChildren<Renderer>();
                if (renderer != null)
                {
                    renderer.material.mainTexture = texture;
                }
            }

            // GPS- und Waben-Daten ermitteln
            double lat = GPSManager.Instance != null ? GPSManager.Instance.CurrentLatitude : 0.0;
            double lon = GPSManager.Instance != null ? GPSManager.Instance.CurrentLongitude : 0.0;
            float alt = GPSManager.Instance != null ? GPSManager.Instance.CurrentAltitude : 0f;
            string hexId = HexGridManager.Instance != null ? HexGridManager.Instance.CurrentHexId : "hex_unknown";

            // In Mock-Backend abspeichern
            GraffitiData graffitiData = new GraffitiData
            {
                id = "graffiti_" + System.Guid.NewGuid().ToString().Substring(0, 8),
                latitude = lat,
                longitude = lon,
                altitude = alt,
                localAnchorPosition = position,
                localAnchorRotation = rotation,
                imageBase64 = texture != null ? TextureToBase64(texture) : string.Empty,
                authorPlayerId = "Local_Player",
                hexId = hexId
            };

            if (MockBackend.Instance != null)
            {
                MockBackend.Instance.SaveGraffiti(graffitiData);
            }
        }

        private string TextureToBase64(Texture2D tex)
        {
            try
            {
                byte[] bytes = tex.EncodeToPNG();
                return System.Convert.ToBase64String(bytes);
            }
            catch
            {
                return string.Empty;
            }
        }
    }
}
