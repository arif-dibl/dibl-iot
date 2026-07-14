# Custom UI Architecture — FastAPI + Jinja2 Frontend

This document details the architecture, directory structure, and design of the DIBL IoT Custom UI — a bespoke web application that replaces the default OpenRemote Manager UI with a simplified, mobile-friendly experience tailored for end-users.

---

## Table of Contents
- [Why a Custom UI?](#why-a-custom-ui)
- [Technology Stack](#technology-stack)
- [Directory Structure](#directory-structure)
- [Application Entrypoint & Routing](#application-entrypoint--routing)
- [Authentication Flow](#authentication-flow)
- [Pages & Templates](#pages--templates)
- [Dashboard Architecture](#dashboard-architecture)
- [Frontend JavaScript Modules](#frontend-javascript-modules)
- [Key Frontend Patterns](#key-frontend-patterns)
- [CSS & Styling](#css--styling)
- [API Proxy Layer](#api-proxy-layer)
- [Backend API Endpoints](#backend-api-endpoints)
- [Dockerfile & Containerization](#dockerfile--containerization)
- [Adding New Features](#adding-new-features)

---

## Why a Custom UI?

The native OpenRemote Manager UI is designed for system administrators. While it provides powerful features, it presents two major challenges for a multi-tenant end-user deployment:

1. **The Restricted User vs. Rules Dilemma:**  
   In OpenRemote, to hide other customers' devices from a user, you must use the "Restricted User" role (which only shows explicitly linked assets). However, Restricted Users cannot properly access or configure the native Rules engine. If you elevate them to a regular user to grant Rules access (`read:rules`, `read:assets`), they instantly gain visibility to *all* assets in the system.
2. **Complexity:** The native UI exposes raw JSON attributes, complex asset trees, and a steep learning curve for non-technical users (like farmers or site managers).

To solve this, the DIBL Custom UI was built to act as a secure, filtering middleware. It allows users to have regular Keycloak roles (enabling rule creation), but the Custom UI backend strictly filters their views so they only see their linked devices and their own namespaced rules (`u:{user_id}:...`).

Additionally, the Custom UI provides:
- A clean **Dashboard** with pinned sensor widgets and an overview panel (total devices, online/offline counts, active rules).
- **Toggle switches** for relays/valves instead of raw JSON editing, with an optimistic UI and a frosted-overlay lock to prevent double-toggling.
- A graphical **Timer configuration** page with wheel pickers, day selectors, and a local buffer with explicit SAVE.
- **Client-side rule builder** that writes structured `RuleTargets` JSON attributes, supporting cross-device sensor conditions.
- User **Signup, Login, and Profile management** without touching Keycloak directly.
- **Asset linking** via manual ID entry or QR code scanning (using the `Html5Qrcode` library).
- **Asset partner visibility** — users can see who else shares their linked devices.
- A **Data History** page with Chart.js graphs and CSV/ZIP exports.
- A responsive, mobile-friendly design with a clean, light-themed interface.

---

## Technology Stack

| Layer | Technology | Purpose |
| :--- | :--- | :--- |
| **Backend Framework** | FastAPI (Python 3.9) | Async HTTP server, session management, API routing |
| **Templating** | Jinja2 | Server-side HTML rendering with template inheritance |
| **Session Middleware** | Starlette `SessionMiddleware` | Signed cookie-based sessions (key: `supersecretkey`) |
| **Proxy Headers** | Uvicorn `ProxyHeadersMiddleware` | Trusts `X-Forwarded-For` from reverse proxy |
| **Frontend** | Vanilla JavaScript | No framework (React/Vue) — direct DOM manipulation |
| **Charting** | Chart.js (CDN) | Line graphs for historical telemetry data |
| **QR Scanning** | Html5Qrcode (CDN) | Camera-based QR code scanning for asset linking |
| **QR Generation** | QRCode.js (CDN) | Generates QR codes for asset IDs |
| **HTTP Client** | `requests` | Backend-to-OpenRemote/Keycloak/HawkBit API calls |
| **Auth Tokens** | `itsdangerous` | Secure session cookie signing |
| **Form Parsing** | `python-multipart` | HTML form POST body parsing |
| **ASGI Server** | Uvicorn | Production ASGI server on port 5000 |

---

## Directory Structure

```
src/
├── main.py                  # Application entrypoint, middleware, router assembly
├── requirements.txt         # Python dependencies
├── verify_datapoint_api.py  # Standalone CLI script for testing historical data fetching
├── verify_export_api.py     # Standalone CLI script for testing ZIP exports
├── core/                    # Shared business logic
│   ├── config.py            # Environment variables, realm, paths, role flags
│   ├── auth.py              # Keycloak auth, token management, role assignment, gatekeeper
│   ├── hawkbit.py           # OTA sync logic (OpenRemote → HawkBit)
│   └── utils.py             # Preferences I/O, friendly names loader
├── api/                     # JSON API endpoints (called by frontend JS)
│   ├── assets.py            # Asset CRUD, linking, pinning, widgets, background OTA sync
│   ├── rules.py             # Drools rule CRUD with user namespacing (u:{user_id}:...)
│   ├── user.py              # Profile fetch/update, password change, asset partners
│   └── debug.py             # Authenticated proxy to OpenRemote Manager API
├── routes/                  # HTML page routes (return rendered templates)
│   ├── auth.py              # Login, signup, logout pages
│   └── dashboard.py         # Dashboard, assets, timers, rules, settings, history pages
├── templates/               # Jinja2 HTML templates
│   ├── base.html            # Master layout (nav, header, footer, scripts)
│   ├── login.html           # Standalone login page (does NOT extend base.html)
│   ├── signup.html          # Standalone signup page (does NOT extend base.html)
│   ├── dashboard.html       # Pinned widgets home screen
│   ├── assets.html          # Device list view with link/unlink/edit/QR modals
│   ├── asset_detail.html    # Single device detail with grouped attributes
│   ├── link_asset.html      # Link a new device via ID or QR scan
│   ├── rules.html           # Client-side rule builder
│   ├── timers.html          # Timer/schedule configuration with wheel pickers
│   ├── datapoint_history.html # Historical data query and visualization
│   ├── user.html            # User profile, password change, and linked users
│   ├── test_api.html        # Admin-only API testing sandbox
│   ├── terms_and_conditions.html
│   └── device_id_instructions.html
├── static/
│   ├── css/                 # Stylesheets
│   │   ├── common.css       # CSS variables, resets, utility classes, tooltips, dropdown
│   │   ├── dashboard.css    # Dashboard widgets, cards, toggles, timers, responsive
│   │   ├── auth.css         # Login/signup form field styling
│   │   ├── split_auth.css   # Split-panel layout for login/signup pages
│   │   ├── rules.css        # Rules editor styling
│   │   ├── history_logs.css # Data history table and chart styling
│   │   ├── asset_detail.css # Asset detail page overrides
│   │   └── test_api.css     # API sandbox dark-themed output styling
│   ├── js/                  # Frontend JavaScript modules
│   │   ├── main.js          # Global utilities, friendly names with sessionStorage cache,
│   │   │                    #   sensor unit system, smart navbar hide-on-scroll
│   │   ├── dashboard.js     # Overview stats, switch/valve cards, widget rendering,
│   │   │                    #   auto-polling with setInterval
│   │   ├── assets.js        # Device list, link/unlink, QR scan, edit name, show ID + QR
│   │   ├── asset_detail.js  # Grouped attribute display, relay/valve toggles, inline timer
│   │   │                    #   editing, pin/unpin, wheel picker, day/output selectors
│   │   ├── timers.js        # Dedicated timer page with local buffer, dirty tracking,
│   │   │                    #   explicit SAVE per card, publish-all-on-expand
│   │   ├── rules.js         # Client-side rule builder writing RuleTargets attribute,
│   │   │                    #   cross-device sensor conditions, localStorage persistence
│   │   ├── datapoint_history.js # Chart.js graphs, table views, date range, CSV/ZIP export
│   │   ├── user_profile.js  # Profile form, password change, asset partner display
│   │   ├── auth.js          # Login/signup form toggling, password show/hide, terms modal
│   │   └── test_api.js      # Admin sandbox for testing raw API calls via debug proxy
│   └── images/              # Logo, favicon, icons
config/
├── friendly_names.json      # Attribute-level and key-level display name mappings
data/
└── user_preferences.json    # Pinned widgets and user-specific settings (keyed by user_id)
deploy/
└── Dockerfile               # Container build instructions
```

---

## Application Entrypoint & Routing

The application is assembled in `src/main.py`. It follows a two-tier routing model:

### Middleware Stack
1. **`ProxyHeadersMiddleware`** — Trusts `X-Forwarded-For` from the reverse proxy (HAProxy/Traefik).
2. **`SessionMiddleware`** — Stores session data in a signed cookie (secret key: `supersecretkey`).

### Public Routes (No Authentication)
Mounted directly on the app (or `APP_PREFIX`):
- `GET /` — Login page (redirects to dashboard if already authenticated)
- `POST /login` — Processes login form via the auto-login dance
- `GET /signup` — Registration page
- `POST /signup` — Creates Keycloak user, assigns client roles, sends verification email
- `GET /logout` — Clears session
- `GET /api/friendly-names` — Public config endpoint (no auth needed)
- `GET /favicon.ico` — Serves `static/images/favicon.png`

### Protected Routes (Gatekeeper)
All protected routes are mounted under `/{username}/` and pass through the `verify_username_match` dependency, which:
1. Checks that the session contains a valid `access_token`.
2. Ensures the URL `{username}` matches the session username (prevents user A from accessing user B's routes).
3. Calls `get_valid_token()` which automatically refreshes expired tokens (within 60 seconds of expiry) using the stored `refresh_token`.
4. On auth failure, raises `NotAuthenticatedException` which is caught by a global exception handler that redirects to the login page.

Protected routes include:
- `GET /{username}/dashboard` — Home screen with overview, switches, sensors, timers, and rules
- `GET /{username}/assets` — Device list with link/unlink/edit/QR modals
- `GET /{username}/asset/{name}` — Single device detail (resolves name → ID via OR API)
- `GET /{username}/rules` — Client-side rule builder
- `GET /{username}/timers` — Timer configuration with wheel pickers
- `GET /{username}/settings` — User profile, password change, and asset partner list
- `GET /{username}/history-logs` — Data history with Chart.js and export
- `GET /{username}/link` — Link a new device
- `GET /{username}/test` — Admin-only API sandbox (gated by HTTP Basic Auth: `arif` / `12345`)

### Protected API Endpoints
Also mounted under `/{username}/` with the same gatekeeper:
- `GET/POST /{username}/api/user/assets` — List linked assets / Link new asset
- `GET /{username}/api/asset/{id}` — Fetch single asset (flattened)
- `POST /{username}/api/asset/{id}/attribute/{name}` — Write attribute value
- `GET/POST /{username}/api/user/rules` — List/create Drools rules
- `DELETE /{username}/api/user/rules/{id}` — Delete a rule
- `GET/PUT /{username}/api/user/profile` — Fetch/update Keycloak profile
- `PUT /{username}/api/user/change-password` — Change password (verifies current first)
- `GET /{username}/api/user/asset-partners` — List users sharing the same assets
- `POST /{username}/api/debug/proxy` — Generic authenticated proxy to OpenRemote

### APP_PREFIX
The `APP_PREFIX` environment variable (default: empty string) allows the entire app to be served under a subpath (e.g., `/customui`) when behind a reverse proxy. All URLs, static file references, and API calls are dynamically prefixed using this value.

---

## Authentication Flow

### Signup
1. User submits the signup form.
2. Backend creates the user in Keycloak via admin API.
3. Client roles are assigned based on flags in `config.py` (all 15 read/write roles are enabled by default).
4. A verification email action (`VERIFY_EMAIL`) is triggered.
5. User must verify email before logging in.

### Login (The Auto-Login Dance)
The login flow in `core/auth.py` (`perform_auto_login_logic`) is non-trivial:
1. Backend initiates a `requests.Session()` and GETs the Keycloak authorization endpoint to obtain the OIDC login form.
2. It scrapes the form's `action` URL from the HTML response.
3. **URL rewriting:** The action URL (which points to the public domain) is rewritten to the internal Docker container address (`KEYCLOAK_URL`).
4. **Cookie security downgrade:** Keycloak sets `Secure` cookies, but since the backend communicates over internal HTTP, the `Secure` flag is stripped so `requests` will actually send them.
5. The credentials are POSTed. A `302` redirect indicates success.
6. On success, the backend fetches a user token (`get_user_token`) and stores `access_token`, `refresh_token`, `username`, `realm`, and `user_id` in the session.

### Token Refresh
`get_valid_token()` checks the JWT `exp` claim. If the token expires within 60 seconds, it uses the `refresh_token` to obtain new tokens transparently. If the refresh also fails and the token is fully expired, the session is cleared.

---

## Pages & Templates

### Template Inheritance
- **`base.html`** is the master layout used by all authenticated pages. It provides the top navigation bar (Dashboard, My IoT Devices, Rules, Timers), a collapsible "More" dropdown (Settings, History Logs, Test API, Logout), and injects global JS variables (`BASE_PREFIX`, `APP_PREFIX`).
- **`login.html` and `signup.html` are standalone** — they do NOT extend `base.html`. They use `split_auth.css` for a split-panel layout: a green info panel (60%) on the left with marketing copy, and the form panel (40%) on the right.

Each authenticated template uses Jinja2 blocks (`{% block title %}`, `{% block header %}`, `{% block content %}`, `{% block scripts %}`) to inject page-specific content.

---

## Dashboard Architecture

The dashboard (`dashboard.html` + `dashboard.js`) is divided into five sections:

1. **Overview** — Stat cards showing Total Devices, Online, Offline, and Active Rules. Each card links to its respective page.
2. **Switches** — Auto-rendered from `RelayData` and `ValveState` attributes. Each switch card shows toggle switches with a frosted-overlay lock animation (1.5s cooldown) to prevent rapid toggling. Switches can be renamed via `localStorage`.
3. **Sensors** — User-pinned `EnvData`, `MoistureData`, and `NPKData` widgets. NPK data renders in a zone-based layout.
4. **Timers** — User-pinned timer widgets showing status, start/end times, days, and outputs.
5. **Rules** — User-pinned `RuleTargets` widgets showing a human-readable "If sensor > threshold, Set switch to ON" representation with live ACTIVE/INACTIVE indicators.

The dashboard auto-refreshes every 5 seconds via `setInterval(loadDashboard, 5000)`.

---

## Frontend JavaScript Modules

Each page has a dedicated JS file. There is **no build step** — all JavaScript is vanilla ES5/ES6 loaded via `<script>` tags.

| File | Size | Responsibility |
| :--- | :--- | :--- |
| `main.js` | 10 KB | Friendly names loader with sessionStorage cache (5-min TTL), sensor unit system (`°C`, `%RH`, `µS/cm`, `mg/kg`), `timeAgo()`, `toast()`, boolean helpers, smart navbar hide-on-scroll (mobile), `pinWidget()` |
| `dashboard.js` | 34 KB | Overview stats, switch/valve cards with optimistic UI, sensor/timer/rule widget rendering, auto-refresh polling, widget rename/unpin |
| `asset_detail.js` | 44 KB | Grouped attribute display (Switches → Sensors → Timers → Nutritions → Rules → System → Device → Config), relay/valve toggles, inline timer cards with wheel picker, day/output bubble selectors, pin/unpin with rename prompt |
| `timers.js` | 26 KB | Dedicated timer page with local pending buffer (`pendingTimerData`), dirty tracking per card, explicit SAVE button, publish-all-timers-on-group-expand, valve/relay output detection |
| `rules.js` | 25 KB | Client-side rule builder that writes `RuleTargets` JSON attribute (NOT server-side Drools), cross-device sensor conditions, `localStorage` persistence, enable/disable toggle, rule recovery from device attribute |
| `datapoint_history.js` | 21 KB | Chart.js integration, table rendering, date range picker, CSV/ZIP export via debug proxy |
| `assets.js` | 9 KB | Device list cards, link (manual ID or QR scan), unlink with `localStorage` cleanup, edit name, show ID with QR code generation |
| `user_profile.js` | 7 KB | Profile form, password change (verifies current password first), asset partner list with colored avatar bubbles |
| `auth.js` | 2 KB | Login/signup form toggling, password show/hide toggle, terms & conditions modal |
| `test_api.js` | 2 KB | Admin sandbox: method/endpoint/body inputs, sends via debug proxy, displays JSON response |

---

## Key Frontend Patterns

### Optimistic UI with Cooldown
Toggle switches use a `recentToggles` map with a 5-second cooldown. After toggling, the new state is stored locally and the auto-refresh poll is prevented from reverting it for 5 seconds. Dashboard switch cards also use a frosted CSS overlay animation (1.5s lock) to visually indicate the operation is in progress.

### Friendly Names System
`main.js` loads `friendly_names.json` from the public `/api/friendly-names` endpoint and caches it in `sessionStorage` with a 5-minute TTL. The `getFriendlyLabel()` function performs case-insensitive lookup and falls back to regex-based expansion (`t1` → `Temperature1`, `r2` → `Switch2`). The `formatSensorValue()` function appends context-aware units.

### Local Persistence
- **Switch names:** `localStorage` key `switch_name_{assetId}_{key}`
- **Widget names:** `localStorage` key `widget_name_{widgetId}`
- **Rule definitions:** `localStorage` key `rules_{assetId}` (full JSON array)
- **Friendly names cache:** `sessionStorage` key `dibl_friendly_names`

### Rules Architecture
Rules in the Custom UI are **NOT** Drools rules. The `rules.js` module builds a structured JSON object and writes it to the `RuleTargets` attribute of the target asset. The format is: `{sensorKey}_rule_{id}` → `{operator}:{threshold}:{relayKey}:{0|1}:{ruleName}:{whenDeviceId}`. The ESP32 firmware reads this attribute and executes the rule logic locally.

The `rules.py` API module handles a separate feature: server-side Drools rules namespaced with `u:{user_id}:{name}` and managed via the OpenRemote Rules API using the admin token.

---

## CSS & Styling

The UI uses a light theme with CSS custom properties defined in `common.css`:

```css
--primary: #00af50;       /* DIBL green */
--primary-hover: #008f40;
--bg-light: #f8f9fa;
--text-dark: #333;
--text-muted: #6c757d;
--border: #e1e4e8;
--danger: #dc3545;
```

Key design decisions:
- **No CSS framework** (no Bootstrap, no Tailwind) — all styles are hand-written.
- **Inter font** loaded from Google Fonts as the primary typeface.
- `dashboard.css` (18 KB) is the largest stylesheet, covering device cards, toggle switches, sensor value grids, stat cards, widget cards, and responsive breakpoints.
- The login/signup pages use `auth.css` + `split_auth.css` for a split-panel layout (40/60 form/info split, info panel hidden on mobile < 900px).
- CSS tooltips via `[data-tooltip]` attribute, only shown on hover-capable devices (`@media (hover: hover)`).

---

## API Proxy Layer

The Custom UI backend acts as an authenticated middleware between the browser and the OpenRemote Manager. The browser never talks to OpenRemote directly.

### Why a Proxy?
1. **CORS avoidance:** OpenRemote Manager does not whitelist the Custom UI's origin.
2. **Token security:** The user's JWT `access_token` is stored server-side in the session, never exposed to JavaScript.
3. **Data transformation:** The backend flattens complex OpenRemote JSON structures (extracting `value` from `{value, timestamp, meta}` wrappers), injects `_timestamp` metadata into Timer attributes, and computes `lastActivityTimestamp` from `EnvData`/`SystemData` timestamps.
4. **Asset filtering:** The `GET /api/user/assets` endpoint only returns assets linked to the current user (via `asset/user/current` API), not all realm assets.
5. **Background OTA sync:** Every time assets are fetched, a daemon thread syncs them to HawkBit as targets, grouped by asset type.

### The Debug Proxy (`src/api/debug.py`)
For advanced operations (like fetching historical datapoints), the frontend uses a generic proxy endpoint:
```
POST /{username}/api/debug/proxy
Body: { "method": "POST", "endpoint": "/api/dibl-iot/asset/datapoint/...", "body": {...} }
```
The backend injects the user's `access_token`, forwards the request to OpenRemote, and returns the response. It also detects binary responses (ZIP files via magic bytes `PK\x03\x04`) and streams them directly back with `Content-Disposition` headers.

---

## Backend API Endpoints

### Assets API (`src/api/assets.py`)

| Endpoint | Method | Description |
| :--- | :--- | :--- |
| `/api/user/assets` | GET | List all linked assets (flattened, with activity timestamps) |
| `/api/user/assets` | POST | Link an asset to the user (uses admin token for `asset/user/link`) |
| `/api/user/assets/{id}` | PUT | Rename an asset |
| `/api/user/assets/{id}` | DELETE | Unlink an asset (also cleans up local pinned preferences) |
| `/api/asset/{id}` | GET | Fetch single asset detail (flattened) |
| `/api/asset/{id}/attribute/{name}` | POST | Write an attribute value to OpenRemote |
| `/api/user/preferences` | GET | Get user's pinned widget preferences |
| `/api/user/preferences/pin` | POST | Toggle pin/unpin (same endpoint, toggles state) |
| `/api/user/preferences/pin/rename` | POST | Rename a pinned widget's display name |
| `/api/user/dashboard/widgets` | GET | Get pinned widgets with live values (validates linked assets, cleans orphans) |
| `/api/friendly-names` | GET | Returns `config/friendly_names.json` (public, no auth) |

### User API (`src/api/user.py`)

| Endpoint | Method | Description |
| :--- | :--- | :--- |
| `/api/user/profile` | GET | Fetch Keycloak user profile |
| `/api/user/profile` | PUT | Update first/last name |
| `/api/user/change-password` | PUT | Change password (verifies current password via token grant first) |
| `/api/user/asset-partners` | GET | List other users sharing the same assets (admin token required) |

### Rules API (`src/api/rules.py`)

| Endpoint | Method | Description |
| :--- | :--- | :--- |
| `/api/user/rules` | GET | List Drools rules with `u:{user_id}:` prefix (strips prefix for display) |
| `/api/user/rules` | POST | Create a new Drools rule with namespaced name |
| `/api/user/rules/{id}` | DELETE | Delete a rule by ID |

---

## Dockerfile & Containerization

The Custom UI is containerized using a simple Python slim image:

```dockerfile
FROM python:3.9-slim
WORKDIR /app
COPY src/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY src/ /app/src/
COPY config/ /app/config/
COPY data/ /app/data/
WORKDIR /app/src
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "5000"]
```

Key points:
- The app runs on **port 5000** (not the default 8000), matching the HAProxy backend configuration.
- `config/` and `data/` are copied at build time but can be overridden with Docker volume mounts in production for persistence.
- In production (`docker-compose.coolify.yml`), `./data` and `./config` are mounted as volumes so that user preferences and friendly names survive container restarts.

---

## Adding New Features

To add a new page or feature to the Custom UI:

1. **Create the template:** Add a new `.html` file in `src/templates/` extending `base.html`.
2. **Create the route:** Add a new `@router.get()` endpoint in `src/routes/dashboard.py` that returns the template.
3. **Create the JS module:** Add a new `.js` file in `src/static/js/` for client-side logic.
4. **Create any API endpoints:** If the feature needs backend data, add endpoints in `src/api/`.
5. **Add navigation:** Update `base.html` to include a link to the new page in the nav bar or dropdown menu.
6. **Style it:** Add CSS rules to an existing stylesheet or create a new one in `src/static/css/`.
