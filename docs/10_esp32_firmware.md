# ESP32 Firmware — Device-Side Implementation

This document covers the architecture and key implementation details of the C++ firmware running on the ESP32 IoT devices within the DIBL ecosystem. It focuses specifically on the device-side logic required to interface with the OpenRemote backend and HawkBit OTA server securely.

---

## Table of Contents

- [Firmware Architecture Overview](#firmware-architecture-overview)
- [WiFi & Network Connectivity](#wifi--network-connectivity)
- [Secrets Management & Embedded Certificates](#secrets-management--embedded-certificates)
- [MQTT Client Setup with mTLS](#mqtt-client-setup-with-mtls)
- [Auto-Provisioning Request Flow](#auto-provisioning-request-flow)
- [Telemetry Data Transmission](#telemetry-data-transmission)
- [Relay & Valve Control](#relay--valve-control)
- [Local Rules Execution](#local-rules-execution)
- [OTA Update Client (HawkBit)](#ota-update-client-hawkbit)

---

## Firmware Architecture Overview

The ESP32 firmware is built using the Arduino core for ESP32 (often managed via PlatformIO). It is designed to be fully autonomous, resilient to network drops, and secure by default.

Key components of the firmware loop:
1. **Network Watchdog:** Ensures WiFi and MQTT remain connected.
2. **Sensor Polling:** Reads I2C, SPI, or analog sensors (depending on the hardware category).
3. **Rules Engine:** Evaluates local automation rules (downloaded from OpenRemote) against current sensor readings to control relays instantly without network dependency.
4. **Telemetry Publisher:** Batches and publishes sensor data and relay states to OpenRemote.
5. **OTA Client:** Periodically polls the HawkBit server for firmware updates.

---

## WiFi & Network Connectivity

The firmware typically utilizes a robust WiFi connection manager (like `WiFiManager` or a custom implementation like `ESPConfig-Designer`) to allow end-users to provision local network credentials via a captive portal.

Once provisioned, the device maintains a persistent connection to the local access point. The main loop constantly monitors `WiFi.status()` and triggers an exponential backoff reconnection strategy if the connection drops, ensuring the device doesn't overwhelm the router during outages.

---

## Secrets Management & Embedded Certificates

A core tenet of the DIBL security model is that **no shared secrets or passwords are used**. Instead, each device relies on Mutual TLS (mTLS) for authentication.

At compile time, specific cryptographic artifacts are embedded into the firmware as `PROGMEM` strings or via LittleFS/SPIFFS:

1. **Root CA Certificate:** The public root certificate (used to verify the OpenRemote and HawkBit servers).
2. **Device Client Certificate:** The unique X.509 certificate generated for this specific device, signed by its category-specific CA (e.g., `valve_CA`).
3. **Device Private Key:** The private key corresponding to the client certificate.

*Note: In production, these certificates can be flashed to a secure hardware element (like the ESP32-S3's eFuse/secure boot partition) or provisioned at the factory to prevent extraction.*

---

## MQTT Client Setup with mTLS

The device communicates with OpenRemote exclusively over MQTT with TLS (Port `8883`). The firmware uses the `WiFiClientSecure` library combined with an MQTT client (like `PubSubClient` or `AsyncMqttClient`).

**mTLS Configuration:**
Before connecting to the MQTT broker, the `WiFiClientSecure` object is configured with the embedded cryptographic materials:
```cpp
WiFiClientSecure espClient;
espClient.setCACert(root_ca);
espClient.setCertificate(device_cert);
espClient.setPrivateKey(device_key);
```

Because HAProxy is configured with `verify required`, the MQTT connection will only succeed if these certificates are mathematically valid and signed by a trusted CA.

---

## Auto-Provisioning Request Flow

Upon the first successful MQTT connection, the device must register itself with OpenRemote.

1. The device connects to MQTT.
2. It publishes a JSON payload to the provisioning topic: `provisioning/<MAC_ADDRESS>/request`.
3. The payload contains the literal string `"x509"` and its client certificate:
   ```json
   {
     "type": "x509",
     "cert": "-----BEGIN CERTIFICATE-----\nMIICrT... \n-----END CERTIFICATE-----\n"
   }
   ```
4. OpenRemote intercepts this, creates the asset, and the device is now fully authenticated. The device subscribes to `provisioning/<MAC_ADDRESS>/response` to confirm success before moving on to standard telemetry operations.

---

## Telemetry Data Transmission

Once provisioned, the ESP32 regularly publishes data to OpenRemote. OpenRemote uses specific topic structures for attribute updates.

**Publishing Data:**
To update an attribute (e.g., `EnvData`), the device publishes a JSON object to the master attribute topic:
`master/client/<CLIENT_ID>/asset/<ASSET_ID>/attribute/EnvData`

```json
{
  "temperature": 24.5,
  "humidity": 60.2,
  "timestamp": 1690000000000
}
```
The Custom UI backend then flattens and formats this data for the dashboard.

---

## Relay & Valve Control

To receive commands from the user (e.g., toggling a valve from the Custom UI), the device subscribes to attribute write topics.

**Subscribing to Commands:**
The ESP32 subscribes to:
`master/client/<CLIENT_ID>/asset/<ASSET_ID>/attribute/ValveState/write`

When the user clicks the toggle on the dashboard:
1. Custom UI API updates the `ValveState` attribute in OpenRemote.
2. OpenRemote publishes the new value (`true` or `false`) to the write topic.
3. The ESP32's MQTT callback fires, parses the JSON payload, and physically sets the GPIO pin HIGH or LOW.
4. The ESP32 then publishes the new state back to the standard attribute topic to confirm the action succeeded.

---

## Local Rules Execution

A critical feature of the DIBL IoT architecture is **offline reliability**. Automation rules (like "If soil moisture < 30%, turn on valve") must execute even if the internet connection to OpenRemote is down.

**How it works:**
1. The user defines rules in the Custom UI.
2. The UI compiles these into a structured string and saves it to the `RuleTargets` attribute in OpenRemote.
3. The ESP32 subscribes to changes on the `RuleTargets` attribute.
4. When `RuleTargets` is updated, the ESP32 parses the payload (e.g., `>:30:valve:1:Rule1`) and stores the logic in its local RAM/flash.
5. During the main firmware loop, the ESP32 constantly evaluates its live sensor readings against these local rules. If a condition is met, it triggers the relay immediately, without asking the server.

---

## OTA Update Client (HawkBit)

To receive firmware updates over the air, the ESP32 implements a polling client against the HawkBit Direct Device Integration (DDI) REST API.

1. **Polling:** Every X hours, the ESP32 makes an HTTPS GET request to `https://<SERVER>/ota/default/controller/v1/<ASSET_ID>`.
2. **Authentication:** The request uses the same mTLS client certificate configuration as the MQTT connection, ensuring HawkBit inherently trusts the device.
3. **Parsing:** If HawkBit indicates an update is available, the ESP32 parses the JSON response to extract the binary download URL and the MD5/SHA256 checksum.
4. **Flashing:** The device uses the `Update.h` library (or ESP-IDF OTA APIs) to stream the binary from the URL directly into the inactive OTA partition.
5. **Verification & Reboot:** Once downloaded, it verifies the checksum. If valid, it sets the boot partition to the new firmware and restarts.
6. **Confirmation:** Upon booting the new firmware, it sends a success status back to the HawkBit DDI API.
