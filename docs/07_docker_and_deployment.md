# Docker & Deployment — Local and Production Stacks

This document details the Docker Compose configurations for both local development and Coolify-based production deployment. All information is derived directly from `docker-compose.yml` (local) and `docker-compose.coolify.yml` (production).

---

## Table of Contents
- [Why is a Proxy Inside Docker Compose?](#why-is-a-proxy-inside-docker-compose)
- [Hosting Options & Reducing Complexity](#hosting-options--reducing-complexity)
- [Stack Comparison: Local vs. Production](#stack-comparison-local-vs-production)
- [Service Architecture](#service-architecture)
- [Local Deployment (`docker-compose.yml`)](#local-deployment-docker-composeyml)
- [Production Deployment (`docker-compose.coolify.yml`)](#production-deployment-docker-composecoolifyyml)
- [Volumes & Data Persistence](#volumes--data-persistence)
- [Environment Variable Reference](#environment-variable-reference)
- [HAProxy Routing Logic](#haproxy-routing-logic)
- [Troubleshooting](#troubleshooting)

---

## Why is a Proxy Inside Docker Compose?

At first glance, having a dedicated `proxy` (HAProxy) service running *inside* Docker Compose alongside the application services seems redundant — especially when the server itself or a platform like Coolify already has an external reverse proxy (Traefik). The reason comes down to a fundamental limitation: **MQTT is not HTTP**.

### The Core Problem: Two Different Protocols on One Server

The DIBL IoT stack needs to serve two completely different protocols simultaneously:
- **HTTPS (port 443):** Web traffic for the Manager UI, Keycloak, Custom UI, and HawkBit — standard HTTP that Traefik or any generic reverse proxy handles well.
- **MQTT over TLS (port 8883):** Raw TCP traffic from IoT devices — a binary protocol that standard HTTP reverse proxies cannot inspect, route, or secure.

Generic reverse proxies like Traefik (used by Coolify) are built for HTTP/HTTPS. They understand HTTP headers, path-based routing, and virtual hosts. They have no concept of MQTT. If an ESP32 device connects to port 8883 and sends an MQTT CONNECT packet, Traefik would drop or mishandle it.

**HAProxy solves this** because it natively operates at the TCP layer and can handle arbitrary protocols — routing raw TCP streams from port 8883 through to the internal MQTT broker (`manager:1883`) without needing to understand MQTT itself.

### Why HAProxy Specifically (Not Nginx or Others)?

| Capability | HAProxy | Nginx | Traefik |
| :--- | :---: | :---: | :---: |
| HTTP/HTTPS routing | ✅ | ✅ | ✅ |
| MQTT TCP passthrough | ✅ | ✅ (limited) | ❌ |
| **mTLS client certificate verification** | ✅ Full support | ⚠️ Partial | ❌ |
| `verify required` (reject uncertified clients) | ✅ | ❌ | ❌ |
| Let's Encrypt automation | ✅ (via image) | ✅ (via plugin) | ✅ (built-in) |

The critical differentiator for this project is **mTLS `verify required`**. On port 8883, HAProxy checks that every connecting ESP32 presents a valid X.509 certificate signed by a trusted CA before forwarding the connection. This is not possible with Traefik and only partially achievable with Nginx.

### What the Internal Proxy Handles That External Proxies Cannot

1. **mTLS enforcement:** `bind *:8883 ssl crt /certs/mqtt-server-combined.pem ca-file /certs/ca.pem verify required` — this line demands a client certificate and rejects anything that doesn't present one. No Traefik plugin can replicate this for MQTT.
2. **Centralized certificate management:** All TLS for the stack (HTTPS + MQTT) is managed in one place — the proxy container. The OpenRemote `manager` and `keycloak` services run on plain HTTP internally, completely isolated from TLS complexity.
3. **Performance offloading:** TLS handshakes are CPU-intensive. HAProxy absorbs this overhead so the manager and MQTT broker can focus on processing messages, not managing encryption sessions.
4. **Health-check gateway:** The `/docker-health` endpoint is handled entirely by HAProxy, keeping health checks from consuming application resources.

> **In short:** The internal HAProxy proxy exists because Coolify's Traefik handles HTTP very well but **cannot enforce MQTT mTLS at all**. The two proxies complement each other — Traefik handles web routing, HAProxy handles secure IoT device connections.

---

## Hosting Options & Reducing Complexity

The current dual-proxy architecture (Traefik → HAProxy) exists specifically because the project is hosted on **Coolify**, which imposes Traefik as its proxy layer. Understanding your hosting choice directly determines how complex this setup needs to be.

### Option 1: Coolify (Current Setup) — Moderate Complexity

Coolify is a self-hosted PaaS that wraps Docker Compose with a GUI, automated SSL via Let's Encrypt, and Traefik for routing. It is excellent for managing multiple projects from a single dashboard and is the current production approach.

**Adds complexity because:**
- Traefik is mandatory and always running as Coolify's own proxy layer.
- HTTP traffic must pass through **two layers**: Traefik (external) → HAProxy (internal) → service.
- Custom TCP ports like 8883 must be manually declared to bypass Traefik's HTTP-only routing.
- Certificate injection for HAProxy must use Docker `configs` instead of simple volume mounts.

**Reduces complexity because:**
- Let's Encrypt SSL for HTTPS is fully automatic — no manual cert renewal.
- Git-push deployments are supported out of the box.
- Dashboard gives a visual overview of all running containers and their health.

### Option 2: Bare VPS with Direct Docker Compose — Lowest Complexity

On a bare VPS (no Coolify, no Traefik), you run `docker-compose up -d` directly. There is only **one proxy layer** — the HAProxy container itself — which handles both HTTPS and MQTT in one place. This eliminates the Traefik intermediary entirely.

```
# With bare VPS — single proxy layer
Internet → HAProxy (port 443, 8883) → internal services

# With Coolify — two proxy layers  
Internet → Traefik (port 443) → HAProxy (port 8883) → internal services
```

In this mode, HAProxy also handles Let's Encrypt certificate generation natively using the `LE_EMAIL` and `DOMAINNAME` environment variables already present in `docker-compose.yml` — no Traefik needed at all.

**Best VPS Providers for This Stack:**

| Provider | Best For | Min Recommended | Price Estimate |
| :--- | :--- | :--- | :--- |
| **Hetzner Cloud** | Best price-to-performance (EU) | CX22: 4GB RAM, 2 vCPU | ~€4–6/month |
| **DigitalOcean** | Ease of use, tutorials, global | Basic 4GB Droplet | ~$24/month |
| **Vultr** | Global coverage, Asia/Pacific | 4GB regular instance | ~$24/month |
| **OVHcloud** | Budget EU hosting | VPS Value: 4GB RAM | ~€5–8/month |

> **Minimum requirement for this stack:** **4 GB RAM**. The full stack (PostgreSQL × 2, Keycloak, Manager, HAProxy, HawkBit, Custom UI) consumes approximately 2.5–3.5 GB at rest. Less than 4 GB risks OOM kills.

### Option 3: Direct Cloud VM (AWS/GCP/Azure) — Most Control, Highest Cost

For enterprise deployments, cloud VMs offer the highest reliability and SLAs. However, they are significantly more expensive for equivalent specs compared to Hetzner or Vultr. If using these, the bare Docker Compose approach (Option 2) still applies — just provision an EC2/GCE/Azure VM and SSH in.

### Decision Guide

```
Do you want a management dashboard and auto-SSL with minimal CLI work?
  YES → Use Coolify (accept the dual-proxy complexity)
  NO  → Are you cost-sensitive and comfortable with SSH?
          YES → Hetzner + bare Docker Compose (simplest architecture)
          NO  → DigitalOcean/Vultr + bare Docker Compose (more expensive but easier docs)
```

---

## Stack Comparison: Local vs. Production

| Feature | Local (`docker-compose.yml`) | Production (`docker-compose.coolify.yml`) |
| :--- | :--- | :--- |
| **SSL/TLS** | Self-signed cert via Let's Encrypt or `localhost` | Managed by Coolify's Traefik reverse proxy |
| **HTTP Entry** | Proxy handles port 80 and 443 directly | Traefik handles HTTP/HTTPS; proxy handles only MQTT (8883) |
| **MQTT (8883)** | Exposed directly from `proxy` container | Exposed directly from `proxy` container |
| **HAProxy Config** | Built-in default config in `openremote/proxy` image | Injected via Docker `configs` (custom `haproxy-config`) |
| **Certificates** | Volume-mounted from `secrets/` | Injected via Docker `configs` (`mqtt-server-cert`, `mqtt-ca-cert`) |
| **Custom UI Access** | Direct on port `5000` | Routed by Traefik via `OR_CUSTOMUI_HOSTNAME` |
| **HawkBit UI Access** | Direct on port `8088` | Routed by HAProxy via `/ota/ui` path prefix |
| **HawkBit Auth** | Static admin user (`{noop}secret`) | OIDC via Keycloak (`master` realm) |

---

## Service Architecture

All services run on an internal Docker bridge network and communicate using their service names as hostnames. The only ports exposed to the host are those explicitly declared.

```
                    ┌─────────────────────────────────────────────┐
                    │             Docker Network                   │
                    │                                             │
Internet            │  ┌──────────┐    ┌──────────┐              │
──── :80/:443 ─────▶│  │  Traefik │───▶│  proxy   │──▶ manager  │
──── :8883 ─────────│  │(Coolify) │    │ (HAProxy)│──▶ keycloak  │
                    │  └──────────┘    └──────────┘──▶ hawkbit   │
                    │                               ──▶ hawkbit-  │
                    │  ┌──────────────────────────┐    simple-ui  │
                    │  │ postgresql  | hawkbitdb   │              │
                    │  │ (OR data)   | (OTA data)  │              │
                    │  └──────────────────────────┘              │
                    │  ┌──────────┐  ┌──────────┐                │
                    │  │ keycloak │  │ custom-ui│                 │
                    │  └──────────┘  └──────────┘                │
                    └─────────────────────────────────────────────┘
```

---

## Local Deployment (`docker-compose.yml`)

This compose file is for development and testing. It uses standard port bindings so each service is directly accessible.

### Services

#### `proxy`
- **Image:** `openremote/proxy:latest`
- **Ports:** `80:80`, `443:443`, `8883:8883`, `127.0.0.1:8404:8404` (metrics)
- **Role:** HAProxy-based reverse proxy. Handles HTTPS termination and MQTT mTLS termination (port 8883). In local mode, uses the default built-in HAProxy configuration from the image.
- **Depends on:** `manager` (healthy)

#### `postgresql`
- **Image:** `openremote/postgresql:latest`
- **Role:** Main database for OpenRemote Manager (assets, rules, users, provisioning data).
- **Volumes:** `postgresql-data:/var/lib/postgresql/data`, `manager-data:/storage`

#### `keycloak`
- **Image:** `openremote/keycloak:latest`
- **Role:** Identity and Access Management (IAM). Handles user logins, service user creation for devices, and JWT token issuance.
- **Depends on:** `postgresql` (healthy)

#### `manager`
- **Image:** `openremote/manager:latest`
- **Ports:** `127.0.0.1:8405:8405` (metrics — localhost only)
- **Role:** The OpenRemote core. Manages assets, rules, provisioning profiles, MQTT broker (port 1883 internally), and the REST API.
- **Depends on:** `keycloak` (healthy)

#### `custom-ui`
- **Build:** `deploy/Dockerfile` (builds from source in this repo)
- **Port:** `5000:5000` (directly accessible on the host)
- **Role:** The DIBL FastAPI/Python web application providing the user-facing dashboard.
- **Depends on:** `keycloak` (healthy)

#### `hawkbitdb`
- **Image:** `openremote/postgresql:latest`
- **Role:** **Isolated** PostgreSQL instance for HawkBit. Completely separate from the OpenRemote database.
- **Volume:** `hawkbit-data:/var/lib/postgresql/data`

#### `hawkbit`
- **Image:** `openremote/hawkbit-update-server:latest`
- **Port:** `8090:8080` (directly accessible for local development)
- **Role:** Eclipse HawkBit OTA update server. In local mode, uses a static admin user (`admin` / `secret` — note `{noop}` prefix strips bcrypt). Disables RabbitMQ (`HAWKBIT_DMF_RABBITMQ_ENABLED: "false"`).
- **Volume:** `hawkbit-artifact-data:/opt/hawkbit/artifactrepo`
- **Depends on:** `hawkbitdb` (healthy), `keycloak` (healthy)

#### `hawkbit-simple-ui`
- **Image:** `hawkbit/hawkbit-simple-ui:latest`
- **Port:** `8088:8088` (directly accessible for local development)
- **Role:** Web dashboard for HawkBit management. Points to the `hawkbit` service via internal Docker hostname.

---

## Production Deployment (`docker-compose.coolify.yml`)

The production stack is designed for **Coolify**, a self-hosted PaaS that provides Traefik as a managed reverse proxy. Key differences from local:

### Coolify / Traefik Integration

- HTTP/HTTPS traffic enters via Coolify's **Traefik** instance, which handles SSL certificates (Let's Encrypt) and routes traffic to the correct service by hostname and path.
- The `proxy` service still handles **MQTT on port 8883** directly (Traefik does not handle raw TCP MQTT). It only exposes port `8883:8883`.
- Services use Traefik `labels` to declare their routing rules:
  - `openremote/proxy` is routed by `Host(OR_HOSTNAME)` with priority 1.
  - `custom-ui` is routed by `Host(OR_CUSTOMUI_HOSTNAME)` — a **separate subdomain** for the dashboard.

### Certificate Injection via Docker `configs`

Instead of volume-mounting files, production certificates are embedded directly into the compose file as Docker `configs`. This is the Coolify-compatible method for injecting secrets.

```yaml
configs:
  haproxy-config:   # Full custom HAProxy configuration (HAProxy routing logic)
  mqtt-server-cert: # Combined MQTT server cert + private key (PEM)
  mqtt-ca-cert:     # All 11 CA certificates concatenated (CA bundle for mTLS)
```

These configs are mounted into the `proxy` service at startup:
```yaml
proxy:
  configs:
    - source: haproxy-config
      target: /data/proxy/haproxy.cfg
    - source: mqtt-server-cert
      target: /certs/mqtt-server-combined.pem
    - source: mqtt-ca-cert
      target: /certs/ca.pem
  environment:
    HAPROXY_CONFIG: '/data/proxy/haproxy.cfg'
```

### Production HawkBit: OIDC Instead of Static Auth

In production, HawkBit is configured to use Keycloak OIDC for authentication instead of a static admin user:
```yaml
SPRING_SECURITY_OAUTH2_CLIENT_PROVIDER_OIDC_ISSUER_URI: https://${OR_HOSTNAME}/auth/realms/master
```
The HawkBit Simple UI also receives a production-facing management URL:
```yaml
HAWKBIT_SERVER_MGMTURL: https://${OR_HOSTNAME}/ota
```

### `extra_hosts: host-gateway`

Services that need to call back to the production hostname (e.g., HawkBit resolving Keycloak via HTTPS) use `extra_hosts`:
```yaml
extra_hosts:
  - "${OR_HOSTNAME}:host-gateway"
```
This maps the external hostname to the Docker host's IP, so internal containers can resolve the public domain without leaving the host.

---

## Volumes & Data Persistence

| Volume | Used By | Contains |
| :--- | :--- | :--- |
| `proxy-data` | `proxy` | HAProxy state and certificates (local mode) |
| `manager-data` | `postgresql`, `manager` | OpenRemote Manager storage and asset data |
| `postgresql-data` | `postgresql` | OpenRemote PostgreSQL database files |
| `hawkbit-data` | `hawkbitdb` | HawkBit PostgreSQL database files |
| `hawkbit-artifact-data` | `hawkbit` | Uploaded firmware binary files |

> **Important:** Never delete `postgresql-data` or `hawkbit-data` in production — this will erase all assets, provisioning profiles, and OTA firmware history.

---

## Environment Variable Reference

Set these in your `.env` file (local) or in the Coolify environment panel (production).

| Variable | Required | Description | Default |
| :--- | :--- | :--- | :--- |
| `OR_HOSTNAME` | ✅ | The public domain name of the platform | `localhost` |
| `OR_ADMIN_PASSWORD` | ✅ | Master `admin` account password | `secret` |
| `OR_CUSTOMUI_HOSTNAME` | ✅ (production) | Separate subdomain for the Custom UI | — |
| `OR_SSL_PORT` | — | HTTPS port; `-1` means no explicit port in redirects | `443` |
| `OR_DEV_MODE` | — | Enables verbose logging | `false` |
| `OR_METRICS_ENABLED` | — | Prometheus metrics endpoint | `true` |
| `OR_DATA_POINTS_MAX_AGE_DAYS` | — | Days to retain historical telemetry | `180` |
| `PROXY_VERSION` | — | Docker image tag for the proxy | `latest` |
| `MANAGER_VERSION` | — | Docker image tag for the manager | `latest` |
| `KEYCLOAK_VERSION` | — | Docker image tag for Keycloak | `latest` |
| `POSTGRESQL_VERSION` | — | Docker image tag for PostgreSQL | `latest` |
| `HAWKBIT_VERSION` | — | Docker image tag for HawkBit | `latest` |
| `HAWKBIT_DB_USER` | — | HawkBit database username | `postgres` |
| `HAWKBIT_DB_PASSWORD` | — | HawkBit database password | `postgres` |
| `HAWKBIT_OIDC_CLIENT_ID` | — | Keycloak client ID for HawkBit | `hawkbit` |
| `HAWKBIT_OIDC_CLIENT_SECRET` | — | Keycloak client secret for HawkBit | — |

---

## HAProxy Routing Logic

In production, the custom HAProxy configuration (`haproxy-config` Docker config) defines the following routing:

| Request | Routed To |
| :--- | :--- |
| `GET /docker-health` | Returns HTTP 200 (health check endpoint) |
| `path_beg /auth` | `keycloak:8080` |
| `path_beg /realms` | `keycloak:8080` |
| `path_beg /resources` | `keycloak:8080` |
| `path_beg /ota/ui` | `hawkbit-simple-ui:8088` |
| `path_beg /ota` | `hawkbit:8080` |
| Everything else | `manager:8080` |
| **TCP port 8883** | `manager:1883` (MQTT with mTLS — `verify required`) |

---

## Troubleshooting

- **`keycloak` fails healthcheck on startup:** It depends on `postgresql`. Check if `postgresql` started correctly first with `docker logs <project>-postgresql-1`.
- **`manager` fails to start:** Usually caused by a Keycloak connection issue. Ensure `KC_HOSTNAME` matches `OR_HOSTNAME` exactly and Keycloak is healthy.
- **`invalid parameter: redirect_uri` on login:** The `OR_HOSTNAME` in your `.env` does not match what you're accessing in the browser. They must be identical.
- **Updating certificates in production:** You must update the `mqtt-server-cert` and `mqtt-ca-cert` content in `docker-compose.coolify.yml`, then trigger a redeploy of the `proxy` service in Coolify.
- **HawkBit UI shows authentication error:** In production, ensure the `hawkbit` Keycloak client exists in the `master` realm with the correct `HAWKBIT_OIDC_CLIENT_SECRET`.
