# OTA Updates — HawkBit Firmware Delivery

This document covers the Over-the-Air (OTA) firmware update system used in the DIBL IoT platform. The platform integrates **Eclipse HawkBit** alongside OpenRemote to manage, distribute, and track firmware rollouts to ESP32-based IoT devices.

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [HawkBit Deployment Services](#hawkbit-deployment-services)
- [Automatic Device Synchronization](#automatic-device-synchronization)
- [Managing Firmware (Rollout Process)](#managing-firmware-rollout-process)
- [Device-Side Implementation (ESP32)](#device-side-implementation-esp32)

---

## Architecture Overview

While OpenRemote excels at managing device data, telemetry, and control, it is not a dedicated firmware delivery platform. Therefore, the DIBL IoT stack runs **Eclipse HawkBit** to handle OTA updates.

```
┌──────────────────────┐                ┌──────────────────────┐
│  DIBL Custom UI      │── Asset Sync ─▶│  Eclipse HawkBit     │
│  (Python/FastAPI)    │   (REST API)   │  (OTA Update Server) │
└──────────────────────┘                └──────────┬───────────┘
                                                   │
                                                   │ DDI API (Poll)
                                                   ▼
                                        ┌──────────────────────┐
                                        │  IoT Device (ESP32)  │
                                        │  • Checks for update │
                                        │  • Downloads binary  │
                                        │  • Flashes & reboots │
                                        └──────────────────────┘
```

1. **Asset Creation:** Devices auto-provision in OpenRemote via X.509 certificates.
2. **Target Sync:** The DIBL Custom UI detects new assets and automatically mirrors them as **Targets** in HawkBit.
3. **Firmware Management:** Administrators upload new firmware binaries to HawkBit and assign them to device groups.
4. **Device Polling:** ESP32 devices periodically poll the HawkBit Direct Device Integration (DDI) API to check for updates.

---

## HawkBit Deployment Services

HawkBit is deployed as part of the unified `docker-compose.coolify.yml` stack. It consists of three primary services:

### 1. `hawkbitdb`
A dedicated PostgreSQL database isolated from OpenRemote's main database. It stores targets, distribution sets, software modules, and rollout rules.
- **Volume:** `hawkbit-data`

### 2. `hawkbit` (Update Server)
The core backend API handling device connections (DDI API) and management integrations (Management API). 
- **Internal Port:** 8080
- **Volume:** `hawkbit-artifact-data` (stores uploaded firmware binaries locally)
- **Keycloak Integration:** Configured to use the OpenRemote Keycloak instance for OIDC authentication.

### 3. `hawkbit-simple-ui`
A simplified management dashboard for administrators to upload firmware and create rollout campaigns.
- **Internal Port:** 8088
- **Access Route:** Traefik routes `/ota/ui` to this interface.

---

## Automatic Device Synchronization

To ensure HawkBit is aware of all devices managed by OpenRemote, a background synchronization process runs in the DIBL Custom UI (`src/core/hawkbit.py`).

### How the Sync Works
The `sync_assets_to_hawkbit()` function is idempotent and performs a batch synchronization via the HawkBit Management REST API (v1).

| OpenRemote Concept | Maps To | HawkBit Concept | Description |
| :--- | :---: | :--- | :--- |
| **Asset ID** (e.g., `5f3a...`) | ➔ | **Controller ID (Target)** | The unique identifier the device uses to authenticate with HawkBit. |
| **Asset Type** (e.g., `valve`) | ➔ | **Target Filter (Group)** | Devices are grouped by their OpenRemote asset type, allowing you to deploy firmware specifically to all "valves" or all "sensors". |

**Sync Process:**
1. **Fetch state:** Pulls existing targets and filters from HawkBit.
2. **Filter mapping:** Automatically creates Target Filters based on OpenRemote Asset Types (using a FIQL query like `name==*valve*`).
3. **Target creation:** Creates missing targets in HawkBit, naming them `<AssetType>_<AssetID>` for easy identification in the UI.

---

## Managing Firmware (Rollout Process)

Administrators manage updates using the HawkBit Simple UI.

1. **Upload Software Module:** Upload the compiled `.bin` file from PlatformIO/Arduino IDE.
2. **Create Distribution Set:** Group the Software Module(s) into a release version (e.g., `v1.2.0`).
3. **Assign to Targets:**
   - **Direct Assignment:** Assign the Distribution Set to a specific `Controller ID` (for testing).
   - **Rollout Campaign:** Assign the Distribution Set to a Target Filter (e.g., all `valves`), configuring rules like phased rollout percentages or error thresholds.

---

## Device-Side Implementation (ESP32)

IoT devices in the DIBL network must implement a HawkBit client to fetch updates. 

### DDI API Flow
The device uses the Direct Device Integration (DDI) API over HTTPS:
1. **Poll:** Device sends a GET request to `https://<OR_HOSTNAME>/ota/default/controller/v1/<ASSET_ID>`.
2. **Check:** The server responds with JSON indicating if an update is pending.
3. **Download:** If pending, the device parses the download URL from the JSON payload.
4. **Flash:** The device streams the binary over HTTPS to the ESP32's OTA partition.
5. **Acknowledge:** After rebooting, the device sends a success/failure message back to HawkBit.

*(For detailed ESP32 C++ implementation specifics, refer to the [ESP32 Firmware documentation](10_esp32_firmware.md).)*
