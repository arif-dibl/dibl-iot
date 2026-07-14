# Asset Management — Types, Attributes & Data Model

This document details how physical IoT devices are modeled as digital assets within the OpenRemote platform, and how the DIBL IoT Custom UI interacts with this data model.

---

## Table of Contents
- [OpenRemote Asset Basics](#openremote-asset-basics)
- [Asset Hierarchy & Relationships](#asset-hierarchy--relationships)
- [DIBL IoT Attribute Structure](#dibl-iot-attribute-structure)
- [Friendly Names Mapping](#friendly-names-mapping)
- [Custom UI API Integration](#custom-ui-api-integration)

---

## OpenRemote Asset Basics

In OpenRemote, an **Asset** represents the digital twin of a physical device. Based on official OpenRemote architecture, asset management relies on three core concepts:

1. **Asset Types:** These act as schemas or templates. When a device auto-provisions, it is assigned an Asset Type (e.g., `Valve`, `Sensor`, `FarmHub`). This ensures that all devices of that type share the same data structure.
2. **Attributes:** The actual data points of the asset. They hold the "live" state. Attributes can be read-only (telemetry like temperature) or writeable (control commands like a relay toggle).
3. **Meta-items:** Metadata attached to attributes that control their behavior. For example, the `agentLink` meta-item connects an attribute to an MQTT agent so that when a device publishes to a specific topic, the attribute updates automatically.

---

## Asset Hierarchy & Relationships

OpenRemote supports a hierarchical tree structure for assets (Parent/Child relationships). 
- **Root Assets:** A FarmHub or a main controller might be placed at the root level.
- **Child Assets:** Individual sensors or valves connected to that FarmHub can be structured as children. 

### Linking Assets to Users
OpenRemote manages access control by explicitly linking Assets to Users (or Roles). 
If an asset is not linked to a user, that user cannot see or control it. The DIBL Custom UI provides specific endpoints (`POST /api/user/assets`) to link a device to the currently logged-in user, which internally calls the OpenRemote `asset/user/link` API using an admin token.

---

## DIBL IoT Attribute Structure

IoT devices in this project publish JSON payloads that OpenRemote maps into specific JSON object attributes. The primary data attributes used across devices include:

- **`EnvData`**: Environment telemetry containing keys like `t1` (temperature), `h1` (humidity), and light intensity.
- **`MoistureData`**: Soil moisture readings containing keys like `m1`, `m2`.
- **`NPKData`**: Advanced soil sensor data (Nitrogen `n`, Phosphorus `p`, Potassium `k`, pH, and EC).
- **`RelayData`** / **`ValveState`**: The current on/off state of physical switches (`r1`, `r2`) or water valves.
- **`Timer01` - `Timer12`**: JSON objects representing scheduling rules (start time, end time, target output, and active days).

---

## Friendly Names Mapping

Because devices send compact, bandwidth-optimized JSON keys (e.g., `t1`, `r1`), the Custom UI uses a mapping file (`config/friendly_names.json`) to translate these into human-readable labels for the dashboard.

**Example from `friendly_names.json`:**
```json
{
    "attributes": {
        "EnvData": "Environment Data",
        "ValveState": "Valve Control"
    },
    "keys": {
        "t1": "Temperature Port 1",
        "h1": "Humidity Port 1",
        "r1": "Switch 1"
    }
}
```
When the UI encounters the attribute `EnvData` with a key `t1`, it renders it as **"Temperature Port 1"** under the **"Environment Data"** section.

---

## Custom UI API Integration

The DIBL Custom UI Python backend (`src/api/assets.py`) acts as a middleware between the frontend dashboard and the OpenRemote Manager API. It handles data fetching, flattening, and activity tracking.

### Data Fetching & Flattening
When the frontend requests assets (`GET /api/user/assets`), the backend:
1. Fetches the user's linked assets from OpenRemote (`/api/{realm}/asset/user/current`).
2. Iterates through the complex OpenRemote attribute structure (which nests values under a `value` key).
3. **Flattens** the JSON to make it easily consumable by the frontend.
4. Extracts the geographical `location` array (if present).

### Activity Detection (Online/Offline Status)
The Custom UI determines if a device is "online" by inspecting the `timestamp` metadata attached to incoming data.
- The backend looks specifically at the `EnvData` or `SystemData` attributes.
- If the attribute contains valid data (not just placeholder `--` strings), it extracts the timestamp.
- This timestamp is returned to the frontend as `lastActivityTimestamp`, which is used to calculate if the device has gone offline.

### Modifying Attributes (Control)
To toggle a relay or update a timer, the UI sends a request to `POST /api/asset/{asset_id}/attribute/{attr_name}`. 
The backend authenticates the user and forwards an HTTP `PUT` request directly to the OpenRemote REST API, which then dispatches the command via MQTT to the physical ESP32 device.
