# Certificate Setup — Multi-CA mTLS Infrastructure for IoT Auto-Provisioning

## Why X.509 Certificates? (OpenRemote Basics)

According to official OpenRemote documentation, **X.509 client certificates** provide a secure, zero-touch mechanism for IoT device auto-provisioning. Here is why this approach is highly recommended and how it fundamentally works:

1. **Strong Authentication (mTLS):** Instead of using easily compromised shared passwords or tokens, devices present a cryptographic certificate during the TLS handshake (Mutual TLS). This ensures that only trusted hardware can connect to the platform.
2. **Auto-Provisioning & Asset Creation:** When a device connects, OpenRemote verifies its certificate against a registered Certificate Authority (CA). If valid, OpenRemote automatically creates a service user and an asset (based on a template) for that device.
3. **Unique Device Identity (CN):** The certificate must contain a unique identifier within its **CN (Common Name)** attribute. OpenRemote uses this CN to uniquely identify the device and link it to the correct asset.

## The Single CA Approach (The Starting Point)

In a basic OpenRemote setup, or when first prototyping a project, the standard practice is to generate a **single Root Certificate Authority (CA)**. This single CA is then used to sign the client certificates for *all* your IoT devices, regardless of what type of device they are.

**Why start with a single CA?**
- **Simplicity & Speed:** You only have to manage one private key and one CA certificate.
- **Easy Configuration:** You only need to pass a single `ca.pem` file to your proxy/MQTT broker to verify incoming connections.
- **Unified Provisioning:** In OpenRemote Manager, you only need to create one X.509 provisioning profile. This is ideal if all your devices are of the exact same type (e.g., a fleet of identical temperature sensors).

However, as an IoT ecosystem grows to include many different *types* of devices, a single CA approach creates a bottleneck. Because OpenRemote's auto-provisioning maps a CA directly to a specific **Asset Template**, using one CA for everything means OpenRemote would try to provision a water valve and a moisture sensor using the exact same data model, which is incorrect.

## How DIBL IoT Adapts This (Multi-CA Architecture)

To solve the limitations of a single CA setup, the DIBL IoT project scales this concept into a **multi-CA architecture**. Instead of one master CA for everything, **each IoT device category has its own dedicated Certificate Authority (CA)**.

**Why this adaptation is crucial for this project:**
- **Isolated Trust Domains:** If the CA for moisture sensors (`smoist_CA`) is somehow compromised, it does not affect the security of the smart switches (`switch_CA`) or valves (`valve_CA`).
- **Granular Provisioning Control:** Each category's CA is mapped to a specific provisioning profile in OpenRemote Manager. This guarantees that a device presenting a "valve" certificate is strictly provisioned as a Valve asset, and cannot accidentally (or maliciously) be registered as a FarmHub.
- **Targeted Revocation:** We can revoke or cycle certificates for an entire category of devices without causing system-wide downtime.

This document covers the complete infrastructure required to manage this multi-CA mTLS setup.

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Certificate Hierarchy](#certificate-hierarchy)
- [Directory Structure](#directory-structure)
- [Prerequisites](#prerequisites)
- [Step 1: Create the Root CA (Server Identity)](#step-1-create-the-root-ca-server-identity)
- [Step 2: Create the MQTT Server Certificate](#step-2-create-the-mqtt-server-certificate)
- [Step 3: Create Per-Category Device CAs](#step-3-create-per-category-device-cas)
- [Step 4: Sign Device Certificates](#step-4-sign-device-certificates)
- [Step 5: Build the CA Bundle for HAProxy](#step-5-build-the-ca-bundle-for-haproxy)
- [Step 6: Configure HAProxy for mTLS](#step-6-configure-haproxy-for-mtls)
- [Step 7: Register CAs in OpenRemote Manager](#step-7-register-cas-in-openremote-manager)
- [Current Certificate Inventory](#current-certificate-inventory)
- [Certificate Lifecycle & Renewal](#certificate-lifecycle--renewal)
- [Security Best Practices](#security-best-practices)
- [Troubleshooting](#troubleshooting)

---

## Architecture Overview

The DIBL IoT platform uses **mutual TLS (mTLS)** to authenticate IoT devices connecting via MQTT. The architecture consists of:

```
┌─────────────────────────────────────────────────────────────────┐
│                      DIBL IoT mTLS Architecture                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   IoT Device (ESP32)              HAProxy (Proxy Service)       │
│   ┌──────────────┐               ┌──────────────────────┐       │
│   │ Device Cert  │──MQTT:8883───▶│ mTLS Termination     │       │
│   │ (signed by   │   TLS         │ • Server cert        │       │
│   │  category CA)│◀──────────────│ • CA bundle (verify) │       │
│   └──────────────┘               └──────────┬───────────┘       │
│                                             │                   │
│                                             ▼                   │
│                               ┌──────────────────────┐          │
│                               │ OpenRemote Manager   │          │
│                               │ • Provisioning config│          │
│                               │ • Per-CA profile     │          │
│                               │ • Auto-create asset  │          │
│                               └──────────────────────┘          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Key design decision:** Each device category (valve, sensor, switch, etc.) has its **own independent Root CA**. This means:
- Compromising one category's CA does not affect other categories
- Each CA maps to a separate provisioning profile in OpenRemote
- Device certificates can be revoked per-category without system-wide impact

---

## Certificate Hierarchy

The project uses a **flat multi-CA model** (not a hierarchical Root → Intermediate model). Each category CA is self-signed and independently trusted.

```
RootCA (Server Identity — signs MQTT server cert only)
├── mqtt-server cert (master.senspanel.com)
│
valve_CA ──────── signs valve device certs
sens_CA ───────── signs sensor device certs
switch_CA ─────── signs switch device certs
farmhub_CA ────── signs farmhub device certs
flite_CA ──────── signs flite device certs
slite_CA ──────── signs slite device certs
snpk_CA ───────── signs NPK sensor device certs
smoist_CA ─────── signs moisture sensor device certs
slevel_CA ─────── signs water level sensor device certs
squality_CA ───── signs water quality sensor device certs
```

> **Important:** The `RootCA` in `secrets/certs/` is used **only** for signing the MQTT server certificate. It is **not** the trust anchor for device certificates. Each device category has its own CA under `secrets/<category>/`.

---

## Directory Structure

The certificate files are organized under the `secrets/` directory (excluded from git via `.gitignore`):

```
secrets/
├── certs/                          # Server identity certificates
│   ├── ca.key                      # RootCA private key (4096-bit RSA)
│   ├── ca.pem                      # RootCA certificate (self-signed)
│   ├── ca.srl                      # Serial number tracker
│   ├── mqtt-server.key             # MQTT server private key
│   ├── mqtt-server.csr             # MQTT server CSR
│   ├── mqtt-server.pem             # MQTT server certificate
│   ├── mqtt-server-combined.pem    # Server cert + key combined (for HAProxy)
│   ├── mqtt-server-ext.cnf         # SAN extension config
│   ├── device01.{key,csr,pem}      # Legacy device certs (signed by RootCA)
│   ├── device02.{key,csr,pem}
│   └── device03.{key,csr,pem}
│
├── valve/                          # Valve device category CA
│   ├── ca.key                      # valve_CA private key
│   └── ca.pem                      # valve_CA certificate
│
├── sens/                           # Environment sensor category CA
│   ├── ca.key
│   └── ca.pem
│
├── switch/                         # Smart switch category CA
│   ├── ca.key
│   └── ca.pem
│
├── farmhub/                        # FarmHub category CA
│   ├── ca.key
│   └── ca.pem
│
├── flite/                          # Flite category CA
│   ├── ca.key
│   └── ca.pem
│
├── slite/                          # Slite category CA
│   ├── ca.key
│   └── ca.pem
│
├── snpk/                           # NPK sensor category CA
│   ├── ca.key
│   └── ca.pem
│
├── smoist/                         # Moisture sensor category CA
│   ├── ca.key
│   └── ca.pem
│
├── slevel/                         # Water level sensor category CA
│   ├── ca.key
│   └── ca.pem
│
└── squality/                       # Water quality sensor category CA
    ├── ca.key
    └── ca.pem
```

---

## Prerequisites

- **OpenSSL** (v1.1.1+ or v3.x) installed on the machine generating certificates
- A Linux/macOS terminal (or WSL on Windows)
- The `secrets/` directory must exist in your project root

```bash
# Verify OpenSSL version
openssl version

# Create the secrets directory structure
mkdir -p secrets/certs
```

---

## Step 1: Create the Root CA (Server Identity)

The Root CA is used **exclusively** to sign the MQTT server certificate. It establishes the server's identity that IoT devices can trust.

### 1.1 Generate the Root CA Private Key

```bash
openssl genrsa -out secrets/certs/ca.key 4096
```

> **Security:** This generates a 4096-bit RSA key. Keep this file secure — it can sign arbitrary certificates for your server identity.

### 1.2 Generate the Self-Signed Root CA Certificate

```bash
openssl req -new -x509 -days 730 -key secrets/certs/ca.key \
  -out secrets/certs/ca.pem \
  -subj "/C=BD/ST=Dhaka/L=Dhaka/O=DripIrrigation/OU=IoT/CN=RootCA"
```

| Field | Value | Description |
|-------|-------|-------------|
| `C`   | `BD`  | Country (Bangladesh) |
| `ST`  | `Dhaka` | State/Province |
| `L`   | `Dhaka` | Locality |
| `O`   | `DripIrrigation` | Organization |
| `OU`  | `IoT` | Organizational Unit |
| `CN`  | `RootCA` | Common Name — identifies this as the root |

> **Note:** The current Root CA was created on **2025-11-09** and expires on **2027-11-09** (730 days). Plan renewal accordingly.

### 1.3 Verify the Root CA

```bash
openssl x509 -in secrets/certs/ca.pem -noout -subject -issuer -dates
```

Expected output:
```
subject=C=BD, ST=Dhaka, L=Dhaka, O=DripIrrigation, OU=IoT, CN=RootCA
issuer=C=BD, ST=Dhaka, L=Dhaka, O=DripIrrigation, OU=IoT, CN=RootCA
notBefore=Nov  9 05:45:40 2025 GMT
notAfter=Nov  9 05:45:40 2027 GMT
```

---

## Step 2: Create the MQTT Server Certificate

The MQTT server certificate is presented to IoT devices during TLS handshake. It must contain a **Subject Alternative Name (SAN)** matching your server's hostname.

### 2.1 Create the SAN Extension Configuration

```bash
cat > secrets/certs/mqtt-server-ext.cnf << 'EOF'
subjectAltName = DNS:master.senspanel.com
extendedKeyUsage = serverAuth
EOF
```

> **Evidence:** This matches the existing file at `secrets/certs/mqtt-server-ext.cnf` in the project. Replace `master.senspanel.com` with your actual `OR_HOSTNAME` if different.

### 2.2 Generate the Server Private Key

```bash
openssl genrsa -out secrets/certs/mqtt-server.key 4096
```

### 2.3 Generate the Server CSR

```bash
openssl req -new -key secrets/certs/mqtt-server.key \
  -out secrets/certs/mqtt-server.csr \
  -subj "/C=BD/ST=Dhaka/L=Dhaka/O=DripIrrigation/OU=IoT/CN=master.senspanel.com"
```

### 2.4 Sign the Server Certificate with the Root CA

```bash
openssl x509 -req -days 730 \
  -in secrets/certs/mqtt-server.csr \
  -CA secrets/certs/ca.pem \
  -CAkey secrets/certs/ca.key \
  -CAcreateserial \
  -out secrets/certs/mqtt-server.pem \
  -extfile secrets/certs/mqtt-server-ext.cnf
```

### 2.5 Create the Combined PEM (for HAProxy)

HAProxy requires the server certificate and private key in a single file:

```bash
cat secrets/certs/mqtt-server.pem secrets/certs/mqtt-server.key \
  > secrets/certs/mqtt-server-combined.pem
```

### 2.6 Verify the Server Certificate

```bash
openssl x509 -in secrets/certs/mqtt-server.pem -noout -subject -issuer -dates -ext subjectAltName
```

Expected output:
```
subject=C=BD, ST=Dhaka, L=Dhaka, O=DripIrrigation, OU=IoT, CN=master.senspanel.com
issuer=C=BD, ST=Dhaka, L=Dhaka, O=DripIrrigation, OU=IoT, CN=RootCA
notBefore=Jul 30 03:29:31 2026 GMT
notAfter=Jul 27 03:29:31 2036 GMT
X509v3 Subject Alternative Name:
    DNS:master.senspanel.com
```

---

## Step 3: Create Per-Category Device CAs

Each IoT device category gets its own self-signed CA. This is the core of the multi-CA isolation strategy.

### 3.1 Generic Script for Creating a Category CA

Replace `<CATEGORY>` with the device category name (e.g., `valve`, `sens`, `switch`):

```bash
# Set the category name
CATEGORY="valve"

# Create the directory
mkdir -p secrets/${CATEGORY}

# Generate the CA private key (4096-bit RSA)
openssl genrsa -out secrets/${CATEGORY}/ca.key 4096

# Generate the self-signed CA certificate (10-year validity)
openssl req -new -x509 -days 3650 \
  -key secrets/${CATEGORY}/ca.key \
  -out secrets/${CATEGORY}/ca.pem \
  -subj "/C=BD/ST=Dhaka/L=Dhaka/O=DripIrrigation/OU=IoT/CN=${CATEGORY}_CA"
```

### 3.2 Batch Script for All Categories

To create CAs for all 10 device categories at once:

```bash
#!/bin/bash
# create_all_cas.sh — Generate a CA for each device category

CATEGORIES=("valve" "sens" "switch" "farmhub" "flite" "slite" "snpk" "smoist" "slevel" "squality")

for CATEGORY in "${CATEGORIES[@]}"; do
  echo "Creating CA for: ${CATEGORY}"
  mkdir -p secrets/${CATEGORY}

  # Generate private key
  openssl genrsa -out secrets/${CATEGORY}/ca.key 4096

  # Generate self-signed certificate (10 years)
  openssl req -new -x509 -days 3650 \
    -key secrets/${CATEGORY}/ca.key \
    -out secrets/${CATEGORY}/ca.pem \
    -subj "/C=BD/ST=Dhaka/L=Dhaka/O=DripIrrigation/OU=IoT/CN=${CATEGORY}_CA"

  # Restrict key file permissions
  chmod 600 secrets/${CATEGORY}/ca.key

  echo "  ✓ Created secrets/${CATEGORY}/ca.{key,pem}"
done

echo ""
echo "All CAs created successfully."
```

### 3.3 Verify All Category CAs

```bash
for dir in secrets/valve secrets/sens secrets/switch secrets/farmhub \
           secrets/flite secrets/slite secrets/snpk secrets/smoist \
           secrets/slevel secrets/squality; do
  echo "=== $(basename $dir) ==="
  openssl x509 -in "$dir/ca.pem" -noout -subject -dates
  echo ""
done
```

---

## Step 4: Sign Device Certificates

When provisioning a specific IoT device, you sign its certificate with the **category-specific CA** (not the Root CA).

### 4.1 Generate a Device Key and CSR

```bash
CATEGORY="valve"
DEVICE_ID="device01"

# Generate device private key
openssl genrsa -out secrets/${CATEGORY}/${DEVICE_ID}.key 4096

# Generate CSR with unique CN (device identifier)
openssl req -new \
  -key secrets/${CATEGORY}/${DEVICE_ID}.key \
  -out secrets/${CATEGORY}/${DEVICE_ID}.csr \
  -subj "/C=BD/ST=Dhaka/O=DripIrrigation/CN=${DEVICE_ID}"
```

> **Critical:** The `CN` (Common Name) **must be unique** for each device. OpenRemote uses this CN as the device's unique identifier during auto-provisioning.

### 4.2 Sign the Device Certificate

```bash
openssl x509 -req -days 500 \
  -in secrets/${CATEGORY}/${DEVICE_ID}.csr \
  -CA secrets/${CATEGORY}/ca.pem \
  -CAkey secrets/${CATEGORY}/ca.key \
  -CAcreateserial \
  -out secrets/${CATEGORY}/${DEVICE_ID}.pem
```

### 4.3 Verify the Device Certificate Chain

```bash
# Verify the cert was signed by the category CA
openssl verify -CAfile secrets/${CATEGORY}/ca.pem \
  secrets/${CATEGORY}/${DEVICE_ID}.pem

# Inspect the cert
openssl x509 -in secrets/${CATEGORY}/${DEVICE_ID}.pem \
  -noout -subject -issuer -dates
```

Expected output:
```
secrets/valve/device01.pem: OK
subject=C=BD, ST=Dhaka, O=DripIrrigation, CN=device01
issuer=C=BD, ST=Dhaka, L=Dhaka, O=DripIrrigation, OU=IoT, CN=valve_CA
```

> **Note:** Legacy device certs in `secrets/certs/device0{1,2,3}.pem` were signed by the original `RootCA` before the multi-CA architecture was adopted. New device certs should always be signed by the appropriate category CA.

---

## Step 5: Build the CA Bundle for HAProxy

HAProxy needs a single PEM file containing **all trusted CA certificates** to verify incoming device client certificates during mTLS handshake.

### 5.1 Concatenate All Category CAs

```bash
cat \
  secrets/certs/ca.pem \
  secrets/farmhub/ca.pem \
  secrets/flite/ca.pem \
  secrets/sens/ca.pem \
  secrets/slevel/ca.pem \
  secrets/slite/ca.pem \
  secrets/smoist/ca.pem \
  secrets/snpk/ca.pem \
  secrets/squality/ca.pem \
  secrets/switch/ca.pem \
  secrets/valve/ca.pem \
  > secrets/ca-bundle.pem
```

> **Important:** The order of certificates does not matter for HAProxy, but keeping a consistent order makes debugging easier. The original `RootCA` is included for backward compatibility with legacy `device01/02/03` certs.

### 5.2 Verify the Bundle

```bash
# Count certificates in the bundle (should match number of CAs)
grep -c "BEGIN CERTIFICATE" secrets/ca-bundle.pem
# Expected: 11 (1 RootCA + 10 category CAs)
```

---

## Step 6: Configure HAProxy for mTLS

The HAProxy configuration in `docker-compose.coolify.yml` enables mTLS on the MQTT frontend (port 8883).

### 6.1 HAProxy MQTT Frontend Configuration

This is the relevant section from the production `docker-compose.coolify.yml`:

```haproxy
frontend mqtt
    bind *:8883 ssl crt /certs/mqtt-server-combined.pem ca-file /certs/ca.pem verify required
    mode tcp
    default_backend mqtt_backend

backend mqtt_backend
    mode tcp
    timeout tunnel 300s
    option clitcpka
    server manager manager:1883 resolvers docker_resolver init-addr none
```

| Directive | Purpose |
|-----------|---------|
| `crt /certs/mqtt-server-combined.pem` | Server cert + key presented to clients |
| `ca-file /certs/ca.pem` | CA bundle used to verify client certificates |
| `verify required` | Enforces client certificate validation (mTLS) |
| `mode tcp` | Raw TCP passthrough for MQTT protocol |
| `timeout tunnel 300s` | Keep-alive timeout for persistent MQTT connections |

### 6.2 Docker Configs (Coolify Deployment)

In the Coolify deployment, certificates are injected via Docker `configs`:

```yaml
configs:
  mqtt-server-cert:
    content: |
      -----BEGIN CERTIFICATE-----
      ... (server cert + key) ...
      -----END PRIVATE KEY-----

  mqtt-ca-cert:
    content: |
      -----BEGIN CERTIFICATE-----
      ... (RootCA) ...
      -----END CERTIFICATE-----
      -----BEGIN CERTIFICATE-----
      ... (farmhub_CA) ...
      -----END CERTIFICATE-----
      # ... all other category CAs concatenated ...

services:
  proxy:
    configs:
      - source: mqtt-server-cert
        target: /certs/mqtt-server-combined.pem
      - source: mqtt-ca-cert
        target: /certs/ca.pem
```

> **Evidence:** The current `docker-compose.coolify.yml` contains **all 11 CA certificates** (RootCA + 10 category CAs) concatenated in the `mqtt-ca-cert` config, and the combined server cert+key in `mqtt-server-cert`.

### 6.3 Local Development (`docker-compose.yml`)

For local development, mount the certificate files as volumes instead:

```yaml
proxy:
  volumes:
    - ./secrets/certs/mqtt-server-combined.pem:/certs/mqtt-server-combined.pem:ro
    - ./secrets/ca-bundle.pem:/certs/ca.pem:ro
  environment:
    HAPROXY_CONFIG: '/data/proxy/haproxy.cfg'
```

---

## Step 7: Register CAs in OpenRemote Manager

Each category CA must be registered as a separate **X.509 provisioning profile** in the OpenRemote Manager UI.

### 7.1 Steps per Category

1. Log in to OpenRemote Manager at `https://<OR_HOSTNAME>/manager`
2. Navigate to **Provisioning** in the left sidebar
3. Click **+ Add provisioning configuration**
4. Select **X.509** as the type
5. Paste the **CA certificate PEM** content from `secrets/<category>/ca.pem`
6. Configure the asset type and realm mapping
7. Save the configuration

### 7.2 Mapping Table

| Category | CA CN | Provisioning Profile | Asset Type |
|----------|-------|---------------------|------------|
| valve | `valve_CA` | Valve Provisioning | Custom valve asset |
| sens | `sens_CA` | Sensor Provisioning | Environment sensor asset |
| switch | `switch_CA` | Switch Provisioning | Smart switch asset |
| farmhub | `farmhub_CA` | FarmHub Provisioning | FarmHub asset |
| flite | `flite_CA` | Flite Provisioning | Flite asset |
| slite | `slite_CA` | Slite Provisioning | Slite asset |
| snpk | `snpk_CA` | NPK Provisioning | NPK sensor asset |
| smoist | `smoist_CA` | Moisture Provisioning | Moisture sensor asset |
| slevel | `slevel_CA` | Level Provisioning | Water level sensor asset |
| squality | `squality_CA` | Quality Provisioning | Water quality sensor asset |

---

## Current Certificate Inventory

Based on actual inspection of the project's `secrets/` directory:

### Server Identity

| File | Subject | Issuer | Valid From | Valid Until | Key Size |
|------|---------|--------|-----------|-------------|----------|
| `certs/ca.pem` | `CN=RootCA` | Self-signed | 2025-11-09 | 2027-11-09 | 4096-bit |
| `certs/mqtt-server.pem` | `CN=master.senspanel.com` | `CN=RootCA` | 2026-07-30 | 2036-07-27 | 4096-bit |

### Category CAs

| Directory | CA CN | Valid From | Valid Until | Has Device Certs |
|-----------|-------|-----------|-------------|------------------|
| `valve/` | `valve_CA` | 2026-06-18 | 2036-06-15 | No (CA only) |
| `sens/` | `sens_CA` | 2026-06-18 | 2036-06-15 | No (CA only) |
| `switch/` | `switch_CA` | 2026-06-18 | 2036-06-15 | No (CA only) |
| `farmhub/` | `farmhub_CA` | 2026-06-18 | 2036-06-15 | No (CA only) |
| `flite/` | `flite_CA` | 2026-06-18 | 2036-06-15 | No (CA only) |
| `slite/` | `slite_CA` | 2026-06-18 | 2036-06-15 | No (CA only) |
| `snpk/` | `snpk_CA` | 2026-06-18 | 2036-06-15 | No (CA only) |
| `smoist/` | `smoist_CA` | 2026-06-18 | 2036-06-15 | No (CA only) |
| `slevel/` | `slevel_CA` | 2026-06-18 | 2036-06-15 | No (CA only) |
| `squality/` | `squality_CA` | 2026-06-18 | 2036-06-15 | No (CA only) |

### Legacy Device Certificates (in `certs/`)

| File | Subject CN | Issuer | Valid From | Valid Until |
|------|-----------|--------|-----------|-------------|
| `device01.pem` | `device01` | `CN=RootCA` | 2025-11-09 | 2027-03-24 |
| `device02.pem` | `device02` | `CN=RootCA` | 2025-11-09 | 2027-03-24 |
| `device03.pem` | `device03` | `CN=RootCA` | 2025-11-09 | 2027-03-24 |

> **Note:** These legacy certs were created before the multi-CA migration. They are signed by `RootCA` (not a category CA) and may still be in use on existing devices.

---

## Certificate Lifecycle & Renewal

### Expiration Timeline

```
2027-03-24  ◄── Legacy device certs (device01-03) expire
2027-11-09  ◄── RootCA expires (affects MQTT server identity chain)
2036-06-15  ◄── All 10 category CAs expire (10-year validity)
2036-07-27  ◄── MQTT server cert expires (10-year validity)
```

### Renewal Process

#### Renewing the MQTT Server Certificate

```bash
# 1. Generate a new CSR (reuse existing key or generate new)
openssl req -new -key secrets/certs/mqtt-server.key \
  -out secrets/certs/mqtt-server.csr \
  -subj "/C=BD/ST=Dhaka/L=Dhaka/O=DripIrrigation/OU=IoT/CN=master.senspanel.com"

# 2. Sign with Root CA
openssl x509 -req -days 730 \
  -in secrets/certs/mqtt-server.csr \
  -CA secrets/certs/ca.pem \
  -CAkey secrets/certs/ca.key \
  -CAcreateserial \
  -out secrets/certs/mqtt-server.pem \
  -extfile secrets/certs/mqtt-server-ext.cnf

# 3. Recreate combined PEM
cat secrets/certs/mqtt-server.pem secrets/certs/mqtt-server.key \
  > secrets/certs/mqtt-server-combined.pem

# 4. Update docker-compose.coolify.yml with new cert content
# 5. Redeploy the proxy service
```

#### Renewing a Category CA

> **Warning:** Renewing a category CA will invalidate **all existing device certificates** signed by that CA. Plan device re-provisioning accordingly.

```bash
CATEGORY="valve"

# Generate new CA key and cert
openssl genrsa -out secrets/${CATEGORY}/ca.key 4096
openssl req -new -x509 -days 3650 \
  -key secrets/${CATEGORY}/ca.key \
  -out secrets/${CATEGORY}/ca.pem \
  -subj "/C=BD/ST=Dhaka/L=Dhaka/O=DripIrrigation/OU=IoT/CN=${CATEGORY}_CA"

# Rebuild the CA bundle
# Update the mqtt-ca-cert config in docker-compose.coolify.yml
# Update the provisioning profile in OpenRemote Manager
# Re-sign all device certs for this category
```

---

## Security Best Practices

1. **Private key protection:** All `.key` files should have `chmod 600` permissions. They are excluded from git via `.gitignore` (`*.key`, `*.pem`, `*.crt`, `*.csr`, and the entire `secrets/` directory).

2. **Never commit certificates to git:** The `.gitignore` already excludes all certificate-related files and the `secrets/` directory entirely.

3. **Use unique CNs for devices:** Each device certificate's `CN` must be globally unique across all categories — OpenRemote uses it as the device identifier.

4. **Key size:** All keys in this project use **4096-bit RSA**, providing strong security for IoT applications.

5. **CA key storage:** In production, consider storing category CA private keys offline or in a hardware security module (HSM). Only bring them online when signing new device certificates.

6. **Certificate rotation:** Monitor expiration dates. The RootCA and MQTT server cert expire in 2027/2028 — set calendar reminders.

---

## Troubleshooting

### "Certificate invalid" during provisioning

- Verify the device cert was signed by the correct category CA:
  ```bash
  openssl verify -CAfile secrets/<category>/ca.pem secrets/<category>/<device>.pem
  ```
- Ensure the CA certificate is included in the HAProxy CA bundle
- Confirm the CA PEM is registered in the corresponding OpenRemote provisioning profile

### "SSL handshake failure" on MQTT connection

- Check that `mqtt-server-combined.pem` contains both the certificate AND private key
- Verify the SAN matches the hostname the device is connecting to:
  ```bash
  openssl x509 -in secrets/certs/mqtt-server.pem -noout -ext subjectAltName
  ```
- Ensure HAProxy port 8883 is exposed in docker-compose

### Device connects but provisioning doesn't trigger

- Verify the device's provisioning request JSON payload includes the full certificate chain (device cert + CA cert) in PEM format
- The PEM chain must be formatted as a single-line JSON string (newlines replaced with `\n`)
- Check OpenRemote Manager logs for provisioning errors

### Adding a new device category

1. Create the CA: `openssl genrsa` + `openssl req -new -x509`
2. Add the CA to the bundle (rebuild `ca-bundle.pem`)
3. Add the CA PEM content to `mqtt-ca-cert` config in `docker-compose.coolify.yml`
4. Create a new provisioning profile in OpenRemote Manager
5. Redeploy the proxy service

---

*Document created: 2026-07-05 | Based on analysis of project files and certificate inspection*
