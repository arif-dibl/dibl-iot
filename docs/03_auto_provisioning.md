# Auto Provisioning — X.509 Device Onboarding

This document details the fully automated X.509 device provisioning workflow used to onboard IoT devices into the DIBL IoT platform via MQTT + mTLS. It covers the Multi-CA (Certificate Authority) trust architecture, the HAProxy termination configuration, and the device-side provisioning payload.

---

## Table of Contents
1. [What is Auto Provisioning?](#what-is-auto-provisioning)
2. [Multi-CA Trust Architecture](#multi-ca-trust-architecture)
3. [X.509 Provisioning Flow (Device → OpenRemote)](#x509-provisioning-flow-device--openremote)
4. [Device-Side Provisioning Payload](#device-side-provisioning-payload)
5. [Provisioning Configuration in Manager UI](#provisioning-configuration-in-manager-ui)
6. [Service User & Asset Auto-Creation](#service-user--asset-auto-creation)

---

## What is Auto Provisioning?

Auto provisioning allows IoT devices to register themselves securely with the DIBL IoT platform without requiring manual intervention from a system administrator. 

Instead of an admin manually creating an asset in the OpenRemote Manager and hardcoding credentials (client ID, username, password) into the device's firmware, the device connects securely using an **X.509 Client Certificate**. If the certificate is trusted, the platform automatically:
1. Creates a corresponding **Asset** of the correct type (e.g., `valve`, `sensor`, `farmhub`).
2. Creates a restricted **Service User** for the device.
3. Links the asset to the service user and associates the certificate for future authentication.

---

## Multi-CA Trust Architecture

To ensure strict security and limit the "blast radius" if a certificate authority is compromised, the DIBL IoT infrastructure uses a **Multi-CA Architecture** to isolate device trust domains.

### Category-Specific CAs
Instead of using a single Root CA for all devices, unique CAs are generated for each device category. These are stored locally in the `/secrets/` directory and synchronized with the production server:
- `farmhub_CA` (for FarmHub master controllers)
- `valve_CA` (for solenoid valves)
- `sens_CA` (for generic sensors)
- `slevel_CA`, `slite_CA`, `smoist_CA`, `snpk_CA` (for specific sensor variants)
- `flite_CA`, `switch_CA` (for switches and lite controllers)

### HAProxy Termination (`docker-compose.coolify.yml`)
At the edge of the network, the HAProxy container terminates the MQTT TLS connections (Port `8883`). 

All individual category CAs are bundled together into a single file (`mqtt-ca-cert` block in the docker-compose file). HAProxy is configured to enforce Mutual TLS (mTLS) against this bundle:
```haproxy
frontend mqtt
    bind *:8883 ssl crt /certs/mqtt-server-combined.pem ca-file /certs/ca.pem verify required
    mode tcp
    default_backend mqtt_backend
```
Because of the `verify required` directive, a device **cannot** even establish a TCP connection to the MQTT broker unless it presents a valid client certificate signed by one of the CAs in the bundle.

---

## X.509 Provisioning Flow (Device → OpenRemote)

The provisioning sequence occurs during the device's first boot or when it lacks existing MQTT credentials.

1. **mTLS Handshake:** The device initiates a TLS connection to `<SERVER_IP>:8883`, verifying the server's certificate and presenting its own category-specific client certificate. HAProxy validates the certificate against the bundled CAs.
2. **Anonymous MQTT Connect:** The device connects to the MQTT broker. At this stage, it does not have a formal Service User, so it connects using the designated provisioning endpoint.
3. **Provisioning Request:** The device publishes a specific JSON payload (containing its certificate) to the provisioning request topic.
4. **Validation & Creation:** OpenRemote intercepts the request. It extracts the certificate's **Issuer** (e.g., `CN=valve_CA`) and matches it to a predefined Provisioning Profile. The profile dictates the Asset Type to create.
5. **Provisioning Response:** OpenRemote publishes a success response to the device, confirming the asset creation and providing the auto-generated Client ID.
6. **Reconnect & Telemetry:** The device disconnects and reconnects using its new Client ID (still using the certificate for authentication) and begins publishing telemetry data.

---

## Device-Side Provisioning Payload

When requesting provisioning, the ESP32 firmware publishes a JSON payload to the following MQTT topic:

**Topic:** `provisioning/<UNIQUE_ID>/request`
*(Note: `<UNIQUE_ID>` is typically the ESP32's MAC address or a generated serial number, ensuring responses are routed correctly).*

**Payload Structure:**
```json
{
  "type": "x509",
  "cert": "-----BEGIN CERTIFICATE-----\nMIICrTCCAZWgAwIBAgIU... \n-----END CERTIFICATE-----\n"
}
```
- **`type`**: Must strictly be `"x509"`. This tells OpenRemote to authenticate the device using the provided certificate rather than a shared secret.
- **`cert`**: The raw PEM-formatted string of the device's client certificate (including newline `\n` characters). This certificate must correspond to the one used during the mTLS handshake.

**Response Topic:** `provisioning/<UNIQUE_ID>/response`

---

## Provisioning Configuration in Manager UI

For the auto-provisioning flow to work, the backend must be configured to map incoming CAs to asset types. This is done in the **OpenRemote Manager UI** under the **Auto Provisioning** section (Realm Settings).

1. **Create a Provisioning Profile:** For each device category, a profile is created.
2. **Assign CA matching:** The profile is configured to look for X.509 requests. The critical linking step is matching the certificate's **Issuer CN** (e.g., `valve_CA`) to the profile.
3. **Define Asset Configuration:** The profile defines:
   - The Asset Type to create (e.g., `dibl-iot:asset:cdvalve`).
   - Any default attributes (e.g., initial `ValveState = false`, default timers).
   - Parent/Child relationships (if applicable).

Whenever a certificate signed by `valve_CA` makes a request, OpenRemote knows unequivocally to provision it as a `cdvalve` asset.

---

## Service User & Asset Auto-Creation

Upon successful validation of the provisioning request:

1. **Service User Creation:** OpenRemote automatically generates a unique "Service User" in Keycloak. This user is highly restricted—it only has access to the specific asset it represents.
2. **Certificate Association:** The device's X.509 certificate is permanently bound to this Service User. Future MQTT connections from this certificate are automatically authenticated as this user.
3. **Asset Creation:** The new asset is instantiated in the realm. 
4. **HawkBit Target Sync:** As soon as the asset appears in OpenRemote, the DIBL Custom UI's background process (`src/core/hawkbit.py`) detects it and automatically provisions a corresponding **Target** in the HawkBit OTA server.

The device is now fully onboarded, secured, and ready for end-user linking via the Custom UI.
