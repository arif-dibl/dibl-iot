# OpenRemote Server — Setup, Deployment & Overview

This document covers downloading, locally deploying, and exploring the OpenRemote IoT platform, with a focus on the core features utilized in the DIBL IoT project.

---

## Table of Contents
- [Prerequisites](#prerequisites)
- [Local Deployment](#local-deployment)
- [Navigating the Manager UI](#navigating-the-manager-ui)
- [Key Concepts for DIBL IoT](#key-concepts-for-dibl-iot)
- [Environment Variables](#environment-variables)
- [Troubleshooting](#troubleshooting)

---

## Prerequisites

Before deploying OpenRemote locally, ensure your system meets the following requirements:
- **Docker:** Installed and running (v18+ recommended).
- **Docker Compose:** Installed (often bundled with Docker Desktop).
- **System Resources:** At least 4GB of RAM allocated to Docker (OpenRemote runs multiple Java-based services and PostgreSQL).

---

## Local Deployment

The DIBL IoT project uses a tailored `docker-compose.yml` file to spin up the entire stack locally. 

### 1. Configure the Environment
Copy the example environment file to create your local `.env`:
```bash
cp .env.example .env
```
For local testing, the defaults in `.env.example` are usually sufficient. By default, OpenRemote will bind to `localhost` and use the default admin password `secret`.

### 2. Start the Stack
Navigate to the `DIBL_IOT` project root and start the containers in detached mode:
```bash
docker-compose up -d
```
Docker will pull the necessary images (Proxy, PostgreSQL, Keycloak, Manager, HawkBit, and the Custom UI) and start the services. This may take a few minutes on the first run.

### 3. Access the Manager UI
Once all services report as healthy, you can access the platform:
- **URL:** `https://localhost` (or `https://<OR_HOSTNAME>` if you changed it)
- **Warning:** You will see a browser warning about a self-signed certificate. This is expected for local development. Proceed past the warning.
- **Login Credentials:**
  - **Username:** `admin`
  - **Password:** `secret` (or whatever you set in `OR_ADMIN_PASSWORD`)

---

## Navigating the Manager UI

When you log into OpenRemote as the `admin`, you are placed in the **Manager UI**. Here are the primary sections you will interact with:

- **Realms:** OpenRemote is multi-tenant. By default, you operate in the `master` realm. 
- **Assets (Map/Grid View):** The core dashboard where you can see all provisioned devices, their current state, and their geographical location.
- **Rules:** The automation engine. You can create rules (e.g., "If Soil Moisture < 20%, turn on Water Valve") using a visual builder or Groovy scripts.
- **Provisioning:** (Found in the top-right menu for superusers). This is where X.509 certificate profiles are managed to allow devices to auto-register.
- **Users:** Management of both human users (Custom UI logins) and Service Users (automatically created for IoT devices).

---

## Key Concepts for DIBL IoT

To understand how the DIBL IoT platform is built on top of OpenRemote, you must grasp these core concepts:

### 1. Auto Provisioning (X.509)
We use OpenRemote's **X.509 Auto Provisioning**. Instead of manually creating assets in the UI, devices authenticate with a cryptographic certificate over MQTT. If the certificate is valid, OpenRemote automatically creates the device in the system. *(See [03_auto_provisioning.md](03_auto_provisioning.md) for details).*

### 2. Service Users vs. Real Users (Keycloak)
OpenRemote uses Keycloak for IAM (Identity and Access Management). 
- **Real Users:** People logging into the Custom UI.
- **Service Users:** When an IoT device auto-provisions, Keycloak creates a "Service User" for it. The device uses its certificate to authenticate as this Service User to publish telemetry data.

### 3. Asset Management
An **Asset** is the digital twin of a physical device. 
- **Types:** Assets have types (e.g., `Sensor`, `Actuator`). In DIBL IoT, we use custom types like `Valve` or `FarmHub`.
- **Attributes:** The actual data points of the asset (e.g., `temperature`, `relayStatus`). Attributes can be read-only (sensor data) or writeable (control commands).

### 4. Controls & Monitoring
- **Monitoring:** The Custom UI pulls attribute values from OpenRemote to display dashboards and charts.
- **Controls:** When a user toggles a switch in the Custom UI, it sends a REST API request to OpenRemote to update a writeable attribute. OpenRemote then pushes this state change down to the physical ESP32 device via MQTT.

---

## Environment Variables

The `.env` file controls the deployment. Key variables include:

| Variable | Description | Default |
| :--- | :--- | :--- |
| `OR_HOSTNAME` | The domain/IP used to access the platform. | `localhost` |
| `OR_ADMIN_PASSWORD` | The password for the master `admin` account. | `secret` |
| `OR_DEV_MODE` | Enables verbose logging and disables some caches. | `false` |
| `OR_SSL_PORT` | The port for HTTPS traffic. | `443` (often mapped as `-1` internally if using a proxy) |
| `OR_DATA_POINTS_MAX_AGE_DAYS` | How long historical telemetry data is kept in PostgreSQL. | `180` |

---

## Troubleshooting

- **Containers keep restarting:** Check if you have enough RAM allocated to Docker. OpenRemote is memory-intensive.
- **"Invalid parameter: redirect_uri" on login:** This usually means the `OR_HOSTNAME` does not match the URL you are using in your browser. If you are accessing it via an IP address (e.g., `192.168.1.100`), you must set `OR_HOSTNAME=192.168.1.100` and restart the stack.
- **Cannot connect to MQTT:** Ensure port `8883` is exposed and not blocked by a local firewall.
