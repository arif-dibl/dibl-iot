## 1. Web Framework & App Structure

### Framework
- **Framework**: FastAPI (Python)
- **ASGI Server**: Uvicorn (configured in main.py line 68-70: `uvicorn.run(app, host="0.0.0.0", port=5000)`)
- **Template Engine**: Jinja2 (referenced in routes/auth.py line 9, routes/dashboard.py line 8: `Jinja2Templates(directory="templates")`)
- **Static Files**: Mounted via `StaticFiles` from `static/` directory
- **Session Management**: `starlette.middleware.sessions.SessionMiddleware` with secret key "supersecretkey" (main.py line 19)
- **Proxy Headers**: `uvicorn.middleware.proxy_headers.ProxyHeadersMiddleware` with `trusted_hosts=["*"]` (main.py line 18)

### App Initialization (src/main.py lines 1-70)
```python
from fastapi import FastAPI, Request, APIRouter, Depends
from fastapi.staticfiles import StaticFiles
from starlette.middleware.sessions import SessionMiddleware
from routes import auth as auth_routes, dashboard as dashboard_routes
from api import assets as assets_api, rules as rules_api, user as user_api, debug as debug_api
from core.config import APP_PREFIX
from core.auth import verify_username_match, NotAuthenticatedException
from fastapi.responses import RedirectResponse
```

**API Docs Configuration:**
- `docs_url = f"{APP_PREFIX}/docs" if APP_PREFIX else "/docs"`
- `openapi_url = f"{APP_PREFIX}/openapi.json" if APP_PREFIX else "/openapi.json"`
- App title: "DIBL IoT Custom UI"

### Route Structure Architecture

**Two-Tier Routing:**
1. **PUBLIC ROUTES** - No prefix gatekeeper, mounted directly on app
2. **PROTECTED ROUTES** - Prefixed with `/{username}`, require `verify_username_match` dependency (gatekeeper)

### Public Routes
- **Auth routes**: `app.include_router(auth_routes.router, prefix=APP_PREFIX)` (line 23)
- **Public API endpoint**: `GET /{APP_PREFIX}/api/friendly-names` (or `/api/friendly-names`) - no auth, returns friendly names from config (lines 36-38)
- **Favicon**: `GET /{APP_PREFIX}/favicon.ico` (or `/favicon.ico`), serves `static/images/favicon.png` (lines 63-66)

### Protected Routes (User-prefixed)
User router configured at:
```python
user_router = APIRouter(
    prefix=f"{APP_PREFIX}/{{username}}" if APP_PREFIX else "/{username}",
    dependencies=[Depends(verify_username_match)]
)
```

**Backend API routers (mounted under user prefix):**
- `user_router.include_router(assets_api.router)` - assets API endpoints (see assets.py)
- `user_router.include_router(rules_api.router)` - rules API endpoints  
- `user_router.include_router(user_api.router)` - user API endpoints
- `user_router.include_router(debug_api.router)` - debug API endpoints

**HTML Page routers:**
- `user_router.include_router(dashboard_routes.router)` - dashboard/web pages

**APP_PREFIX behavior:**
- From config.py line 14: `APP_PREFIX = os.environ.get('APP_PREFIX', '')` (empty for local dev, '/customui' for prod)
- Helper `get_prefixed_path()` used to construct URLs consistently

### Middleware
1. **ProxyHeadersMiddleware** (line 18-19 in main.py): handles proxy headers, `trusted_hosts=["*"]`
2. **SessionMiddleware** (line 19): Starlette session middleware, secret key "supersecretkey"

### Exception Handling
- `@app.exception_handler(NotAuthenticatedException)` (main.py line 29-33): redirects to target URL with status 303

### Static Asset Serving
- Mounted at `f"{APP_PREFIX}/static"` or `/static` pointing to `static/` directory (line 41-42)

---

### Route Table - Auth Routes (src/routes/auth.py)

**Base router tags=["auth"]**, all routes prefixed by APP_PREFIX when included.

| HTTP Method | URL Rule | Endpoint Function | Auth Required? | Purpose | Request Params | Response Shape |
|-------------|----------|-------------------|----------------|---------|----------------|----------------|
| GET | `/` | index_page | No | Root login page. If logged in with token, redirects to `/{username}/dashboard` | None (uses session) | HTML (login.html) or RedirectResponse (303) |
| GET | `/login` | login_get | No | Redirects to `/` | None | RedirectResponse to `/` |
| POST | `/login` | login_post | No | Email-based login flow. Looks up username by email via Keycloak Admin API, then performs auto-login dance. | Form: `email` (str), `password` (str) | HTML (login.html with error/success context) or RedirectResponse to `/{username}/dashboard` (303) |
| GET | `/signup` | signup_get | No | Signup page | None | HTML (signup.html) |
| POST | `/signup` | signup_post | No | Register new user in Keycloak, assign roles, generate OTP, send verification email. | Form: `username`, `email`, `password`, `terms` ("on" if accepted) | Redirect to `/verify-email?email={email}` (303) or HTML with error |
| GET | `/forgot-password` | forgot_password_get | No | Forgot password page | None | HTML (forgot_password.html) |
| POST | `/forgot-password` | forgot_password_post | No | Generate reset OTP if user exists (always redirects to reset page for security - doesn't reveal existence) | Form: `email` | Redirect to `/reset-password?email={email}` (303) |
| GET | `/verify-email` | verify_email_get | No | Email verification page | Query: `email` (str, optional) | HTML (verify_email.html) |
| POST | `/verify-email` | verify_email_post | No | Verify OTP for email verification, mark emailVerified in Keycloak | Form: `email`, `otp` | HTML (login.html with success) or verify_email.html with error |
| GET | `/reset-password` | reset_password_get | No | Password reset page | Query: `email` (str, optional) | HTML (reset_password.html) |
| POST | `/reset-password` | reset_password_post | No | Verify OTP and reset password via Keycloak Admin API | Form: `email`, `otp`, `password` | HTML (login.html with success) or reset_password.html with error |
| GET | `/logout` | logout | No | Clear session and redirect to root | None | RedirectResponse to `/` (302) |

---

### Route Table - Dashboard Routes (src/routes/dashboard.py)

**Base router tags=["pages"]**, mounted under `/{username}` prefix with `verify_username_match` dependency.

| HTTP Method | URL Rule | Endpoint Function | Auth Required? | Purpose | Request Params | Response Shape |
|-------------|----------|-------------------|----------------|---------|----------------|----------------|
| GET | `/{username}/dashboard` | dashboard_page | Yes (gatekeeper) | Main dashboard page | Path: `username` (str) | HTML (dashboard.html) with context: realm, page="dashboard", prefix, username |
| GET | `/{username}/assets` | assets_page | Yes | Assets list page | Path: `username` | HTML (assets.html) with page="assets" |
| GET | `/{username}/asset/{asset_name}` | asset_detail_page | Yes | Asset detail page. Resolves asset name/ID to actual asset ID by fetching user's assets. | Path: `username`, `asset_name` (str, URL-encoded name or ID) | HTML (asset_detail.html) with asset_id, asset_name (resolved), page="assets" |
| GET | `/{username}/rules` | rules_page | Yes | Rules management page | Path: `username` | HTML (rules.html) with page="rules" |
| GET | `/{username}/timers` | timers_page | Yes | Timers management page | Path: `username` | HTML (timers.html) with page="timers" |
| GET | `/{username}/settings` | user_page | Yes | User settings/profile page | Path: `username` | HTML (user.html) with page="settings" |
| GET | `/{username}/link` | link_asset_page | Yes | Link asset page | Path: `username` | HTML (link_asset.html) with page="assets" |
| GET | `/{username}/test` | test_page | Yes + Basic Auth gate (`Depends(auth_test_api)`) | Test API page (separate auth layer - Basic Auth for user 'arif'/'12345') | Path: `username` | HTML (test_api.html) with host, page="test" |
| GET | `/{username}/history-logs` | history_logs_page | Yes | Datapoint history/logs page | Path: `username` | HTML (datapoint_history.html) with page="history_logs" |

---

### Template Layout & Inheritance

Templates are in `templates/` directory (referenced as "templates"). Based on routes, the following templates exist:
- login.html, signup.html, forgot_password.html, verify_email.html, reset_password.html (auth pages)
- dashboard.html, assets.html, asset_detail.html, rules.html, timers.html, user.html, link_asset.html, test_api.html, datapoint_history.html (protected pages)

All pages receive `request`, `prefix`, `username` (for protected), `realm`, `page` etc. in context. Base template inheritance is implied by typical Jinja2 structure - though not fully visible from code, the pattern suggests a base layout with navigation (page parameter used for active nav state).

---

### Static Assets

Mounted at `/{APP_PREFIX}/static` → directory `static/` (main.py line 42). Favicon served from `static/images/favicon.png`.

---
## 2. src/core/config.py - Complete Configuration

Every constant from config.py with env var, default, and purpose.

| Constant | Type | Environment Variable | Default Value | Purpose/Controls |
|---|---|---|---|---|
| `OR_HOSTNAME` | str | `OR_HOSTNAME` | `"localhost"` | OpenRemote/Keycloak hostname used in various contexts (auth headers "Host", redirect URIs) |
| `OR_ADMIN_PASSWORD` | str | `OR_ADMIN_PASSWORD` | `"secret"` | Admin password for Keycloak master realm login (used by get_admin_token) |
| `OR_MANAGER_URL` | str | `OR_MANAGER_URL` | `"http://manager:8080"` | OpenRemote Manager API base URL. All OR API calls go to this endpoint |
| `KEYCLOAK_URL` | str | `KEYCLOAK_URL` | `"http://keycloak:8080/auth"` | Keycloak auth server base URL (includes /auth path) |
| `APP_PREFIX` | str | `APP_PREFIX` | `""` (empty string) | Application URL prefix for reverse proxy subpath routing. Empty for local dev, '/customui' for production. Affects all route prefixes, static mounts, docs URLs. |
| `BASE_DIR` | str | N/A (computed) | `os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))` | Project root directory. For src/core/config.py, goes up 3 levels from src/core to DIBL_IOT root. |
| `CONFIG_DIR` | str | N/A | `os.path.join(BASE_DIR, "config")` | Path to config/ directory containing templates, friendly_names.json etc. |
| `DATA_DIR` | str | N/A | `os.path.join(BASE_DIR, "data")` | Path to data/ directory for user preferences storage |
| `DEFAULT_REALM` | str | N/A (hardcoded) | `"dibl-iot"` | Default Keycloak/OpenRemote realm for user operations |
| `PREFS_FILE` | str | N/A | `os.path.join(DATA_DIR, "user_preferences.json")` | File path for user preferences storage (pins, highlights) |
| `FRIENDLY_NAMES_FILE` | str | N/A | `os.path.join(CONFIG_DIR, "friendly_names.json")` | File path for attribute/datapoint friendly name mappings |

### Role Assignment Flags (Boolean, all True by default)

These control which OpenRemote client roles are assigned to newly registered users via `assign_roles_to_user()`.

| Flag | Controls Role | Purpose |
|---|---|---|
| `ASSIGN_ROLE_READ_ALARMS` | `read:alarms` | Assign read alarms permission |
| `ASSIGN_ROLE_READ_ASSETS` | `read:assets` | Assign read assets permission |
| `ASSIGN_ROLE_READ_INSIGHTS` | `read:insights` | Assign read insights permission |
| `ASSIGN_ROLE_READ_LOGS` | `read:logs` | Assign read logs permission |
| `ASSIGN_ROLE_READ_RULES` | `read:rules` | Assign read rules permission |
| `ASSIGN_ROLE_READ_SERVICES` | `read:services` | Assign read services permission |
| `ASSIGN_ROLE_READ_USERS` | `read:users` | Assign read users permission |
| `ASSIGN_ROLE_WRITE_ALARMS` | `write:alarms` | Assign write alarms permission |
| `ASSIGN_ROLE_WRITE_ASSETS` | `write:assets` | Assign write assets permission |
| `ASSIGN_ROLE_WRITE_ATTRIBUTES` | `write:attributes` | Assign write attributes permission |
| `ASSIGN_ROLE_WRITE_INSIGHTS` | `write:insights` | Assign write insights permission |
| `ASSIGN_ROLE_WRITE_LOGS` | `write:logs` | Assign write logs permission |
| `ASSIGN_ROLE_WRITE_RULES` | `write:rules` | Assign write rules permission |
| `ASSIGN_ROLE_WRITE_SERVICES` | `write:services` | Assign write services permission |
| `ASSIGN_ROLE_WRITE_USER` | `write:user` | Assign write user permission |

---
## 3. src/core/auth.py (342 lines) - Complete Authentication Scheme

### Exception Classes
```python
class NotAuthenticatedException(Exception):
    def __init__(self, redirect_url: str):
        self.redirect_url = redirect_url
```
- Raised when authentication/gatekeeper fails; caught by FastAPI exception handler (main.py) which returns RedirectResponse with status 303

### Basic Auth for Test API
```python
security = HTTPBasic()
def auth_test_api(credentials: HTTPBasicCredentials = Depends(security)):
    correct_username = secrets.compare_digest(credentials.username.encode("utf8"), b"arif")
    correct_password = secrets.compare_digest(credentials.password.encode("utf8"), b"12345")
    ...
```
- Hardcoded credentials: username `arif`, password `12345` (lines 18-31)
- Used as dependency on `/test` route (dashboard.py line 92)
- Returns 401 with `WWW-Authenticate: Basic` on failure

### Password Hashing Algorithm
- **No local password hashing** - authentication delegated to Keycloak/OpenID Connect
- Passwords stored/hashed in Keycloak (not in this app). The app uses Keycloak token endpoint for auth.
- Uses `secrets.compare_digest` for constant-time comparison of Basic Auth credentials (test API only)

### Session/Cookie Handling
- Sessions managed by Starlette SessionMiddleware (main.py line 19): `secret_key="supersecretkey"`
- Session stores: `username`, `realm`, `access_token`, `refresh_token`, `user_id` (set during login flow)
- Session cookies handled; in auto-login logic, cookies from Keycloak requests may have `Secure` flag stripped for internal HTTP (line 312-315 in auth.py)
- Session cleared on logout (auth.py logout route sets `request.session.clear()`)

### Token Generation & Management

#### `get_admin_token(realm)` (lines 63-79)
- **Purpose**: Fetch admin token from Keycloak Master realm
- **URL**: `f"{KEYCLOAK_URL}/realms/master/protocol/openid-connect/token"`
- **Method**: POST
- **Payload**:
```python
{
  "grant_type": "password",
  "client_id": "openremote", 
  "username": "admin",
  "password": OR_ADMIN_PASSWORD
}
```
- **Headers**: `{"Host": OR_HOSTNAME}`
- **Returns**: access token string or `None` on error
- **Usage**: Admin operations (create user, assign roles, get user IDs, etc.)

#### `get_user_token(realm, username, password)` (lines 188-203)
- **Purpose**: Get user access/refresh tokens from Keycloak via Resource Owner Password Credentials
- **URL**: `f"{KEYCLOAK_URL}/realms/{realm}/protocol/openid-connect/token"`
- **Method**: POST
- **Payload**:
```python
{
  "client_id": "openremote",
  "username": username,
  "password": password,
  "grant_type": "password"
}
```
- **Headers**: `{"Host": OR_HOSTNAME}`
- **Verify**: `verify=False` (line 198)
- **Returns**: full token response dict (with access_token, refresh_token, etc.) or `None`

#### `refresh_user_token(realm, refresh_token)` (lines 205-219)
- **Purpose**: Refresh access token using refresh token
- **URL**: Same token endpoint
- **Payload**:
```python
{
  "client_id": "openremote",
  "grant_type": "refresh_token",
  "refresh_token": refresh_token
}
```
- **Headers**: `{"Host": OR_HOSTNAME}`, `verify=False`
- **Returns**: new token dict or `None`

#### `get_valid_token(request: Request)` (lines 221-252)
- **Purpose**: Validate access token, auto-refresh if expiring (< 60s), clear session if expired
- **Logic**:
1. Get `access_token`, `refresh_token`, `realm` from session
2. If no access token → return None
3. Decode JWT payload (base64url decode of token part[1]) to extract `exp` (unix timestamp)
4. If `exp - current_time < 60` (expiring soon), attempt refresh:
   - Call `refresh_user_token()` if refresh_token exists
   - Update session with new access_token and refresh_token if returned
   - Return new access token
5. If `exp < current_time` (expired), clear session and return None
6. Otherwise return existing access token
- **Error handling**: Catches exceptions, prints error, returns None

### Role/Permission Model

#### `assign_roles_to_user(realm, user_id, admin_token)` (lines 81-129)
- **Purpose**: Assign client roles to user on Keycloak client "openremote"
- **Steps**:
1. Get client UUID: `GET {KEYCLOAK_URL}/admin/realms/{realm}/clients?clientId=openremote` (line 88)
2. Get all client roles: `GET {KEYCLOAK_URL}/admin/realms/{realm}/clients/{client_uuid}/roles` (line 94)
3. Build role map from boolean flags (lines 100-116):
```python
role_map = [
    (ASSIGN_ROLE_READ_ALARMS, "read:alarms"),
    (ASSIGN_ROLE_READ_ASSETS, "read:assets"),
    (ASSIGN_ROLE_READ_INSIGHTS, "read:insights"),
    (ASSIGN_ROLE_READ_LOGS, "read:logs"),
    (ASSIGN_ROLE_READ_RULES, "read:rules"),
    (ASSIGN_ROLE_READ_SERVICES, "read:services"),
    (ASSIGN_ROLE_READ_USERS, "read:users"),
    (ASSIGN_ROLE_WRITE_ALARMS, "write:alarms"),
    (ASSIGN_ROLE_WRITE_ASSETS, "write:assets"),
    (ASSIGN_ROLE_WRITE_ATTRIBUTES, "write:attributes"),
    (ASSIGN_ROLE_WRITE_INSIGHTS, "write:insights"),
    (ASSIGN_ROLE_WRITE_LOGS, "write:logs"),
    (ASSIGN_ROLE_WRITE_RULES, "write:rules"),
    (ASSIGN_ROLE_WRITE_SERVICES, "write:services"),
    (ASSIGN_ROLE_WRITE_USER, "write:user"),
]
```
4. Collect wanted roles where flag is True
5. Assign via POST to: `{KEYCLOAK_URL}/admin/realms/{realm}/users/{user_id}/role-mappings/clients/{client_uuid}` with roles array
6. Returns True if status 200 or 204

#### `assign_realm_roles(realm, user_id, role_names, admin_token)` (lines 167-186)
- **Purpose**: Assign realm-level roles
- **Flow**: GET realm roles → filter by name → POST to realm role-mappings endpoint
- **Endpoint**: `{KEYCLOAK_URL}/admin/realms/{realm}/users/{user_id}/role-mappings/realm`

### User Lookup Functions

- `get_user_id_by_username(realm, username, admin_token)` (lines 131-141): GET users with exact username match → returns first user's 'id' or None
- `get_user_id_by_email(realm, email, admin_token)` (lines 143-153): GET users with exact email match → returns user ID or None  
- `get_username_by_email(realm, email, admin_token)` (lines 155-165): GET users with exact email match → returns username or None

### Gatekeeper/Authorization
```python
async def verify_username_match(username: str, request: Request):
    logged_in_user = request.session.get("username")
    if not logged_in_user or username != logged_in_user:
        if logged_in_user:
            raise NotAuthenticatedException(redirect_url=f"/{logged_in_user}/dashboard")
        raise NotAuthenticatedException(redirect_url="/")
    # Also validate token early
    if not get_valid_token(request):
        raise NotAuthenticatedException(redirect_url="/")
    return username
```
- Dependency used on protected user router
- Ensures URL username matches session username (prevents accessing other user's space)
- Also validates token and triggers refresh/clear if needed

### OpenRemote Keycloak Token Integration & Auto-Login Flow

#### `perform_auto_login_logic(request: Request, realm: str, username: str, password: str)` (lines 254-342)
**Returns**: `(success, response_or_error_msg)`

This implements a complex browser-like OAuth2 Authorization Code flow with Keycloak form submission to establish session cookies, plus direct token acquisition.

**Detailed flow:**

1. **Create requests.Session()** (line 260)
2. **Initiate auth code flow**:
- URL: `{KEYCLOAK_URL}/realms/{realm}/protocol/openid-connect/auth`
- Params: `client_id="openremote"`, `redirect_uri=f"https://{OR_HOSTNAME}/manager/"`, `response_type="code"`, `scope="openid"`
- Headers: `{"Host": OR_HOSTNAME}`
- GET request with `verify=False`
- Stores cookies in session (line 269)

3. **Extract login form action** (line 272-276):
- Parse HTML response for `action="([^"]+)"`
- If not found → return (False, "Could not find login form action")

4. **Robust URL Rewriting** (lines 278-306):
- Keycloak may return absolute URL (with scheme/host) or relative
- Must rewrite to internal container URL (`KEYCLOAK_URL`) so cookies work on internal network
- For absolute URLs: extract path after `https?://[^/]+` and handle potential double `/auth/auth` (strip `/auth` if KEYCLOAK_URL ends with `/auth` and path starts with `/auth/`)
- For relative URLs: similar path normalization
- Builds `target_url = KEYCLOAK_URL.rstrip('/') + path`

5. **Downgrade Secure cookies for internal HTTP** (lines 312-315):
```python
for cookie in session.cookies:
    if cookie.secure:
        cookie.secure = False
```
Critical fix - prevents dropping Secure cookies when sending to internal http://keycloak:8080

6. **Submit login form** (lines 317-319):
- POST to `target_url` with payload: `{"username": username, "password": password, "credentialId": ""}`
- Headers include Host, `allow_redirects=False`, `verify=False`
- Returns `post_resp`

7. **Handle login result** (lines 321-339):
- If status is 302 (redirect on success): 
  - Store `realm`, `username` in session
  - Call `get_user_token(realm, username, password)` to get access/refresh tokens → store in session
  - Call `get_admin_token(realm)` to get admin token, then `get_user_id_by_username()` → store `user_id` in session
  - Return (True, session.cookies)
- If status is 200:
  - Check response text for specific messages:
    - "verify your email" → return (False, "Please verify your email address...")
    - "update account information" → return (False, "Keycloak requires you to update account information...")
  - Otherwise return generic invalid credentials message
- Other statuses → return error with status and preview

**Password Reset Flow** (not in auth.py core, but in routes/auth.py): 
- Uses OTP via `core.otp` module. Generates OTP for "reset" intent, sends email, verifies OTP, then uses Keycloak Admin API to reset password: `PUT {KEYCLOAK_URL}/admin/realms/{realm}/users/{user_id}/reset-password` with `{"type":"password","value":password,"temporary":False}`

**Email Verification Flow**:
- Generates OTP for "verify" intent, sends email. On verification, sets `emailVerified: True` via Keycloak Admin API: `PUT {KEYCLOAK_URL}/admin/realms/{realm}/users/{user_id}` with body containing `emailVerified: True`

---
## 4. src/core/otp.py - OTP Generation, Delivery, Expiry, Verification

### In-Memory Storage
```python
otp_store: Dict[str, Tuple[str, float, str]] = {}
```
- Key: email address (str)
- Value: Tuple of (otp, expiry_time, intent) where:
  - otp: the 6-digit code (str)
  - expiry_time: unix timestamp when expires (float)
  - intent: purpose - "verify" or "reset" (str)
- **Note**: In-memory only. Not persisted across restarts. Comment indicates Redis/DB should be used in production.

### Constants
- `OTP_EXPIRY_SECONDS = 300` (5 minutes) - line 14

### SMTP Configuration (env vars)
- `SMTP_HOST = os.getenv("SMTP_HOST", "")`
- `SMTP_PORT = int(os.getenv("SMTP_PORT", 587))`
- `SMTP_USER = os.getenv("SMTP_USER", "")`
- `SMTP_PASS = os.getenv("SMTP_PASS", "")`

### Functions

#### `generate_otp(email: str, intent: str) -> str` (lines 22-27)
- Generates random 6-digit OTP: `''.join(random.choices(string.digits, k=6))`
- Calculates expiry: `time.time() + OTP_EXPIRY_SECONDS`
- Stores in `otp_store[email] = (otp, expiry, intent)`
- Returns the generated OTP

#### `verify_otp(email: str, otp: str, intent: str) -> bool` (lines 29-36)
- Checks if email exists in store
- Retrieves (stored_otp, expiry, stored_intent)
- Validates:
  1. `time.time() < expiry` (not expired)
  2. `stored_otp == otp` (matches)
  3. `stored_intent == intent` (matches the intended purpose - verify/reset)
- On successful verification: **deletes** the OTP from store (`del otp_store[email]`) - one-time use
- Returns True only if all conditions met

#### `send_otp_email(email: str, otp: str, subject: str)` (lines 38-72)
- Composes email body with OTP and expiry notice
- If SMTP not configured (empty host/user/pass): 
  - Prints mock email to console with formatting (lines 52-57) - fallback for local testing
- If SMTP configured:
  - Creates MIMEMultipart message
  - Sets From, To, Subject
  - Attaches plain text body
  - Connects via `smtplib.SMTP(SMTP_HOST, SMTP_PORT)`
  - Calls `starttls()` for secure connection
  - Logs in with SMTP_USER/PASS
  - Sends message and quits
- Catches and prints exceptions on failure

### Usage in Routes
- Signup: generates OTP with intent "verify", sends with subject "Verify your DIBL IOT Account" (auth.py line 82-85)
- Forgot password: generates OTP with intent "reset", sends with subject "Reset your DIBL IOT Password" (auth.py line 110-114)

---

## 5. src/core/hawkbit.py (200 lines) - Eclipse hawkBit DDI Client

### Configuration
- `HAWKBIT_URL = os.getenv("HAWKBIT_URL", "http://hawkbit:8080/ota")` (line 20)
- `HAWKBIT_USER = os.getenv("HAWKBIT_USER", "admin")` (line 21)  
- `HAWKBIT_PASSWORD = os.getenv("HAWKBIT_PASSWORD", "admin")` (line 22)

### Helper Functions

#### `_hawkbit_auth()` (lines 25-27)
- Returns HTTP Basic Auth tuple: `(HAWKBIT_USER, HAWKBIT_PASSWORD)`

#### `_hawkbit_headers()` (lines 30-32)
- Returns `{"Content-Type": "application/json", "Accept": "application/json"}`

#### `_get_existing_targets()` (lines 35-51)
- **Purpose**: Fetch all existing targets from HawkBit
- **URL**: `f"{HAWKBIT_URL}/rest/v1/targets?limit=500"`
- **Method**: GET with Basic Auth
- **Returns**: Set of `controllerId` strings for fast lookup
- **Handles**: 200 response extracts `data.get("content", [])` and builds set of `t["controllerId"]`
- **Error handling**: Logs warnings on non-200, errors on exceptions; returns empty set on failure

#### `_get_existing_filters()` (lines 54-70)
- **Purpose**: Fetch all existing target filters
- **URL**: `f"{HAWKBIT_URL}/rest/v1/targetfilters?limit=500"`
- **Method**: GET
- **Returns**: Dict mapping `filter name -> filter id`
- **Extraction**: `{f["name"]: f["id"] for f in filters}`

#### `_create_target(controller_id, name, description="Auto-provisioned via Custom UI")` (lines 73-96)
- **Purpose**: Create a single target
- **URL**: `f"{HAWKBIT_URL}/rest/v1/targets"`
- **Method**: POST
- **Payload**: Array with single target object:
```python
[{
  "controllerId": controller_id,
  "name": name,
  "description": description
}]
```
- **Returns**: True on 200/201, False otherwise
- **Logging**: Info on success, warning on failure, error on exception

#### `_create_target_filter(name, query)` (lines 99-120)
- **Purpose**: Create target filter (group)
- **URL**: `f"{HAWKBIT_URL}/rest/v1/targetfilters"`
- **Method**: POST
- **Payload**:
```python
{
  "name": name,
  "query": query
}
```
- **Returns**: filter ID on success (200/201), None on failure
- **Query format**: FIQL (Feed Item Query Language). Example: `name==*{asset_type}*`

### Main Sync Function

#### `sync_assets_to_hawkbit(assets)` (lines 123-200)
**Purpose**: Idempotent sync of OpenRemote assets to HawkBit. Maps Asset ID → HawkBit Target (controllerId), Asset Type → HawkBit Target Filter (group).

**Args**: `assets` - list of dicts, each with at least `"id"` (str) and `"type"` (str)

**Idempotent behavior**: Existing targets not recreated; existing filters not recreated.

**Execution flow:**

1. **Early return** if no assets (line 137-138)
2. **Fetch current state** (batch, not per-asset) - lines 141-143:
   - `existing_targets = _get_existing_targets()`
   - `existing_filters = _get_existing_filters()`

3. **Determine what needs to be created** (lines 146-165):
   - Track `asset_types_needed = set()`
   - Track `targets_to_create = []` (list of target dicts)
   - For each asset:
     - Skip if no `asset_id`
     - Add `asset_type` to `asset_types_needed` set
     - If `asset_id` not in `existing_targets`, append target dict:
       ```python
       {
         "controllerId": asset_id,
         "name": f"{asset_type}_{asset_id}",
         "description": f"Auto-provisioned from OpenRemote ({asset_type})"
       }
       ```

4. **Create missing target filters (groups)** (lines 168-173):
   - For each `asset_type` in `asset_types_needed`:
     - If not in `existing_filters`, create filter with query `f"name==*{asset_type}*"` (FIQL pattern matching targets whose name contains asset type)

5. **Create missing targets (batch preferred, fallback to individual)** (lines 176-192):
   - If `targets_to_create` not empty:
     - Try **batch create**: POST to `{HAWKBIT_URL}/rest/v1/targets` with full list (array) - timeout 15s
     - If batch succeeds (200/201): log success with count
     - If batch fails: log warning and fall back to individual creation via `_create_target()` for each
     - On batch exception: log error and fall back to individual

6. **Logging summary** (lines 194-198):
   - Calculate `total_new = len(targets_to_create)`, `total_skipped = len(assets) - total_new`
   - Log if any new targets created

**Integration points** (from assets.py):
- Called in background thread after fetching user assets (line 271-276 in get_user_assets)
- Called in background thread after linking asset to user (line 372-391 in link_user_asset_api)
- Called in background thread after provisioning device (line 522-531)

---
## 6. src/api/assets.py (542 lines) - OpenRemote Asset Model & Endpoints

**Router**: `APIRouter(prefix="/api", tags=["assets"])` - mounted under `/{username}/api` in protected router

### User Preferences (Local JSON)

#### `get_preferences(username: str, request: Request)` (lines 14-19)
- GET `/api/user/preferences`
- Reads `user_id` from session; if missing returns `{}`
- Loads preferences from `load_preferences()` (reads PREFS_FILE)
- Returns `prefs.get(user_id, {})`

#### `pin_attribute(username: str, request: Request, payload: dict)` (lines 33-64)
- POST `/api/user/preferences/pin`
- Payload fields: `assetId`, `attributeName`, `key` (optional), `displayName` (optional)
- Validates required fields
- Toggles pin: if pin exists (matching assetId, attributeName, key), removes it; else adds new pin
- Saves preferences via `save_preferences()`
- Returns `{"status": "success", "pinned": true/false}`

#### `rename_pin(username: str, request: Request, payload: dict)` (lines 66-90)
- POST `/api/user/preferences/pin/rename`
- Payload: `assetId`, `attributeName`, `key`, `displayName` (optional)
- Finds matching pin and updates displayName (strips whitespace; if empty after strip, deletes displayName key)
- Returns success/error

#### `toggle_highlight(username: str, request: Request, payload: dict)` (lines 92-116)
- POST `/api/user/preferences/highlight`
- Toggles highlighted state for a pinned timer. Key format: `{asset_id}__{attr_name}`
- Stores in `prefs[user_id]["highlighted_timers"]` list
- Returns `{"status": "success", "highlighted": bool}`

#### `get_highlights(username: str, request: Request)` (lines 118-124)
- GET `/api/user/preferences/highlights`
- Returns list of highlighted timer keys

### Friendly Names
- `get_friendly_names_api(username: str)` (lines 21-31): reads FRIENDLY_NAMES_FILE, returns dict or empty default

### Dashboard Widgets
#### `get_dashboard_widgets(username: str, request: Request)` (lines 126-189)
- GET `/api/user/dashboard/widgets`
- Requires `user_id` and valid token
- Gets pinned items for user; filters to only assets linked to current user (fetches linked assets via `GET {OR_MANAGER_URL}/api/{realm}/asset/user/current`)
- Cleans up orphaned pins if any filtered out
- For each valid pinned item, fetches full asset details (`GET {OR_MANAGER_URL}/api/{realm}/asset/{aid}`)
- Extracts value from asset.attributes[aname].value; if target_key specified and value is dict, drills down to that key
- Builds widget objects with assetId, assetName, attributeName, key, displayName, value
- Returns list of widgets

### User Assets

#### `get_user_assets(username: str, request: Request)` (lines 191-281)
**GET `/api/user/assets`**

**Flow:**
1. Get access token, decode JWT to extract `user_uuid` from `sub` claim (lines 200-207)
2. Fetch linked assets: `GET {OR_MANAGER_URL}/api/{realm}/asset/user/current` with auth token (line 209-211)
3. Process each asset to flatten attributes:
- For each k,v in a["attributes"]: if dict with "value", extract `val = v["value"]`, `ts = v.get("timestamp")`
- **Special handling for Timer attributes** (k.startswith("Timer")): if val is string, try JSON.parse to dict; if val is dict and ts exists, inject `_timestamp = ts` into the dict (lines 225-236)
- Set `flat_attrs[k] = val`
- **Activity detection** (lines 239-254): for attributes "EnvData" or "SystemData", check if they contain real data (any subvalue not in [None, "", "--"]). If has real data and ts > last_activity_ts, update last_activity_ts
4. Extract location (lat/lng): if location is dict with coordinates [lng, lat], convert to [lat, lng] for map (lines 257-261)
5. Build final asset object with id, name, type, attributes (flat), location, lastActivityTimestamp
6. **Background sync to HawkBit**: if final_assets non-empty, spawn daemon thread calling `sync_assets_to_hawkbit(final_assets)` (non-blocking) (lines 271-276)
7. Return `{"assets": final_assets}`

#### `get_single_asset(username: str, request: Request, id: str)` (lines 283-340)
**GET `/api/asset/{id}`**
- Fetches single asset: `GET {OR_MANAGER_URL}/api/{realm}/asset/{id}`
- Same flattening logic as above (Timer timestamp injection, activity detection for EnvData/SystemData)
- Returns asset dict or empty `{}` on error

#### `update_asset_attribute_api(username: str, request: Request, asset_id: str, attr_name: str, payload: dict)` (lines 342-355)
**POST `/api/asset/{asset_id}/attribute/{attr_name}`**
- Payload: `{"value": ...}`
- Updates attribute: `PUT {OR_MANAGER_URL}/api/{realm}/asset/{asset_id}/attribute/{attr_name}` with JSON body = value (raw value, not wrapped)
- Returns success/error

### Asset Linking/Management

#### `link_user_asset_api(username: str, request: Request, payload: dict)` (lines 357-395)
**POST `/api/user/assets`**
- Payload: `{"assetId": ...}`
- Links asset to user: `POST {OR_MANAGER_URL}/api/master/asset/user/link` with body `[{"id": {"realm": realm, "userId": user_id, "assetId": asset_id}}]` (uses admin token)
- On success (200/204): spawns background thread to sync linked asset to HawkBit - fetches asset details first, then calls `sync_assets_to_hawkbit([{"id": a["id"], "type": a.get("type","Asset")}])`
- Returns status

#### `update_user_asset_api(username: str, request: Request, asset_id: str, payload: dict)` (lines 397-411)
**PUT `/api/user/assets/{asset_id}`**
- Fetches asset first (`GET /asset/{asset_id}`), updates name if provided, then PUTs full asset back
- Uses verify=False on PUT (line 408)

#### `unlink_user_asset_api(username: str, request: Request, asset_id: str)` (lines 413-434)
**DELETE `/api/user/assets/{asset_id}`**
- Unlinks via admin API: `DELETE {OR_MANAGER_URL}/api/master/asset/user/link/{realm}/{user_id}/{asset_id}`
- Also cleans up local preferences: removes any pinned items for this asset_id
- Saves preferences if changed

#### `provision_device(username: str, request: Request, payload: dict)` (lines 436-542)
**POST `/api/user/provision-device`**
- **Purpose**: BLE-based device provisioning. Creates asset in OpenRemote and links to user.
- **Payload fields**: `name` (default "DIBL Device"), `type` (device type code, default "sens"), `id` (device ID/bleId, required), `wifi_ssid`, `wifi_password`, `firmware` (optional)
- **Validation**: returns error if device_id missing

**Flow:**
1. Get admin token (line 459-466)
2. Map device type code to OpenRemote asset type (line 468-478):
```python
asset_type_map = {
  "farmhub": "FarmHub",
  "flite": "Flite", 
  "sens": "Sensor",
  "slevel": "SoilLevel",
  "slite": "SoilLite",
  "smoist": "SoilMoisture",
  "valve": "ValveController",
  "switch": "Switch"
}
or_asset_type = asset_type_map.get(device_type, "Sensor")
```
3. Build initial attributes (lines 480-494):
```python
attributes = {
  "EnvData": {},
  "RelayData": {},
  "SystemData": {
    "firmware": payload.get("firmware", "1.0.0"),
    "bleId": device_id,
    "provisionedVia": "ble",
    "provisionedAt": int(time.time() * 1000)  # epoch ms
  }
}
if wifi_ssid:
  attributes["SystemData"]["wifiSsid"] = wifi_ssid
```
4. Create asset: `POST {OR_MANAGER_URL}/api/{realm}/asset` with `{"name": device_name, "type": or_asset_type, "attributes": attributes}` (lines 501-511)
5. Link asset to user: `POST {OR_MANAGER_URL}/api/master/asset/user/link` (lines 514-520)
6. Sync to HawkBit in background thread (lines 522-531)
7. Return success with assetId, name, message

---
## 7. src/api/rules.py - Rules Engine

**Router**: `APIRouter(prefix="/api/user/rules", tags=["rules"])` - mounted under protected user prefix

### Model & Schema

**Rule naming convention**: User rules are stored in OpenRemote with names prefixed by `u:{user_id}:` (lines 26, 47). The API strips this prefix when returning to UI.

**OpenRemote Rule structure** (as created):
```python
{
  "name": f"u:{user_id}:{clean_name}",
  "description": "Custom User Rule",
  "status": "ACTIVE",
  "content": drools-like rule content (string)
}
```

**Default rule content template** (lines 53-64):
```python
package rules
import org.openremote.model.asset.*
import org.openremote.model.rules.*

rule "{full_name}"
when
    Icon(assets: assets)
then
    System.out.println("User Rule Triggered");
end
```

### Endpoints

#### `get_user_rules(username: str, request: Request)` (lines 8-35)
- **GET** `/api/user/rules` (relative to router prefix)
- Uses **admin token** to fetch all rules: `GET {OR_MANAGER_URL}/api/{realm}/rules` (line 19)
- Filters rules where `r["name"].startswith(prefix=f"u:{user_id}:")`
- Transforms to UI-friendly shape:
```python
{
  "id": r["id"],
  "name": r["name"].replace(prefix, ""),
  "desc": r.get("description", "User Rule"),
  "active": r.get("status") == "ACTIVE"
}
```
- Returns list of user rules

#### `create_rule(username: str, request: Request, rule: dict)` (lines 37-74)
- **POST** `/api/user/rules`
- Payload expected as `rule` dict (FastAPI parses body as rule param)
- Extracts `rule.get("name", "Rule")`
- Creates full name with user prefix
- Posts to OpenRemote rules API with admin token: `POST {OR_MANAGER_URL}/api/{realm}/rules` (line 68)
- Returns `{"status":"success"}` on 200/201, else `{"status":"error"}`

#### `delete_rule(username: str, request: Request, id: str)` (lines 76-87)
- **DELETE** `/api/user/rules/{id}`
- Deletes specific rule by ID: `DELETE {OR_MANAGER_URL}/api/{realm}/rules/{id}` (line 84)
- Uses admin token
- Returns success/error

---

## 8. src/api/user.py & src/api/debug.py

### src/api/user.py (173 lines) - User Profile & Asset Partners
**Router**: `APIRouter(prefix="/api/user", tags=["user"])`

#### `get_user_profile(username: str, request: Request)` (lines 8-24)
- **GET** `/api/user/profile`
- Fetches current user profile from OpenRemote: `GET {OR_MANAGER_URL}/api/{realm}/user/user` with access token
- Returns profile JSON or error

#### `update_user_profile(username: str, request: Request)` (lines 26-46)
- **PUT** `/api/user/profile`
- Reads JSON body from request
- Updates profile: `PUT {OR_MANAGER_URL}/api/{realm}/user/update` with body
- Returns success/error

#### `change_user_password(username: str, request: Request)` (lines 48-86)
- **PUT** `/api/user/change-password`
- Body: `currentPassword`, `password` (new)
- **Verification step**: Validates current password by attempting token fetch for current username with current password via Keycloak token endpoint (lines 64-73). Returns error if fails.
- If verified, resets password via OpenRemote API: `PUT {OR_MANAGER_URL}/api/{realm}/user/reset-password` with `{"password": new_password}` (line 80)
- Uses access token for OR API call

#### `get_asset_partners(username: str, request: Request)` (lines 88-173)
- **GET** `/api/user/asset-partners`
- **Purpose**: Find other users who are also linked to the same assets as current user (asset sharing/partnerships)
- **Flow**:
1. Get current user's assets: `GET {OR_MANAGER_URL}/api/{realm}/asset/user/current` → build map `asset_id -> asset_name` (lines 97-101)
2. If no assets, return empty
3. Get all asset-user links (admin): `GET {OR_MANAGER_URL}/api/master/asset/user/link?realm={realm}` with admin token (line 110)
4. Filter links where realm matches, asset_id in current user's assets, and linked user != current user. Build `partners_map[asset_id] = set(user_ids)` and try to cache names from link if available (lines 113-130)
5. If no partners, return empty
6. Resolve user names for all partner user IDs not cached: for each, `GET {OR_MANAGER_URL}/api/{realm}/user/user/{pid}` with admin token. Construct full name from firstName/lastName/username (lines 134-151)
7. Build result list: for each asset with valid names, include assetId, assetName, users (list of names). Skip if no valid names.
8. Return result

### src/api/debug.py (72 lines) - Debug Proxy
**Router**: `APIRouter(prefix="/api/debug", tags=["debug"])`

#### `debug_proxy(username: str, request: Request, payload: dict)` (lines 8-72)
- **POST** `/api/debug/proxy`
- **Purpose**: Proxy requests to OpenRemote Manager API (debugging utility)
- **Payload**: `endpoint` (str, required), `method` (str, default "GET"), `body` (optional)
- **Auth**: requires valid access token in session
- Normalizes endpoint to start with `/`
- Constructs URL: `f"{OR_MANAGER_URL}{endpoint}"`
- Sets headers: `Authorization: Bearer {access_token}`, `Content-Type: application/json`, `Host: OR_HOSTNAME`
- Handles methods: GET, POST, PUT, DELETE
- **Binary content detection** (lines 46-63):
  - Checks `Content-Type` header OR magic bytes: if content starts with `b'PK\x03\x04'` (ZIP signature)
  - If detected as binary/ZIP: returns FastAPI `Response` with appropriate media type and `Content-Disposition` header (extracts filename from header if present, defaults to "export.zip")
- For non-binary: tries to parse as JSON, falls back to text
- Returns `{"status": res.status_code, "data": data}`

---

## 9. config/asset_template.json - Complete Asset Model

**File**: config/asset_template.json (376 lines, version 4)  
**Asset Type**: `Thing`  
**Realm**: `dibl-iot`  
**Name template**: `Dibl-iot %UNIQUE_ID%`  
**accessPublicRead**: false

### Complete Attribute Schema

All attributes are of type `textMap` except as noted. Each has `name`, `type`, `value` (default), and `meta` with permissions/flags.

| Attribute | Type | Default Value Structure | storeDataPoints | showOnDashboard | ruleState | readOnly | accessRestrictedRead | accessRestrictedWrite | Notes |
|---|---|---|---|---|---|---|---|---|---|
| `EnvData` | textMap | `{"light":"--","t0":"--","h0":"--","t1":"--","h1":"--","t2":"--","h2":"--","t3":"--","h3":"--","t4":"--","h4":"--"}` | true | true | true | false | true | true | Environmental sensors (light, temps/humidities on ports 0-4) |
| `MoistureData` | textMap | `{"m1":"--","m2":"--","m3":"--","m4":"--"}` | true | true | true | false | true | true | Soil moisture readings for ports 1-4 |
| `NPKData` | textMap | 32 keys for 4 ports (m,t,ec,ph,n,p,k for each 01-04) all defaulting to "--" | true | true | true | false | true | true | NPK sensor data across 4 ports |
| `RelayData` | textMap | `{"r1":"--","r2":"--","r3":"--","r4":"--"}` | true | true | true | false | true | true | Relay/switch states |
| `RuleTargets` | textMap | `{}` (empty object) | false | true | true | false | true | true | Rule destinations/config |
| `Timer01` | textMap | `{"Status":"OFF","Days":"NONE","Outputs":"","OnHour":"00","OnMinute":"00","OffHour":"00","OffMinute":"00"}` | false | true | true | false | true | true | Timer 1 config |
| `Timer02` | textMap | Same structure as Timer01 | false | true | true | false | true | true | Timer 2 |
| `Timer03` | textMap | Same | false | true | true | false | true | true | Timer 3 |
| `Timer04` | textMap | Same | false | true | true | false | true | true | Timer 4 |
| `Timer05` | textMap | Same | false | true | true | false | true | true | Timer 5 |
| `Timer06` | textMap | Same | false | true | true | false | true | true | Timer 6 |
| `Timer07` | textMap | Same | false | true | true | false | true | true | Timer 7 |
| `Timer08` | textMap | Same | false | true | true | false | true | true | Timer 8 |
| `Timer09` | textMap | Same | false | true | true | false | true | true | Timer 9 |
| `Timer10` | textMap | Same | false | true | true | false | true | true | Timer 10 |
| `Timer11` | textMap | Same | false | true | true | false | true | true | Timer 11 |
| `Timer12` | textMap | Same | false | true | true | false | true | true | Timer 12 |

**Note**: All Timer attributes share identical schema. Each stores scheduling state.

---

## 10. config/friendly_names.json - Datapoint Mappings

**Structure**: `{"attributes": {...}, "keys": {...}}`

### attributes mapping (attribute-level friendly names)
Maps OpenRemote attribute names to human-readable names for display in UI.

| Key (Attribute Name) | Friendly Name |
|---|---|
| ValveState | "Valve Control" |
| EnvData | "Environment Data" |
| MoistureData | "Moisture Levels" |
| RelayData | "Switches & Relays" |
| RuleTargets | "Rule Destinations" |
| NPK_Moisture01 | "Soil Moisture 1" |
| NPK_Temperature01 | "Soil Temp 1" |
| NPK_EC01 | "Soil EC 1" |
| NPK_PH01 | "Soil pH 1" |
| NPK_Nitrogen01 | "Nitrogen 1" |
| NPK_Phosphorus01 | "Phosphorus 1" |
| NPK_Potassium01 | "Potassium 1" |
| NPK_Moisture02 | "Soil Moisture 2" |
| NPK_Temperature02 | "Soil Temp 2" |
| NPK_EC02 | "Soil EC 2" |
| NPK_PH02 | "Soil pH 2" |
| NPK_Nitrogen02 | "Nitrogen 2" |
| NPK_Phosphorus02 | "Phosphorus 2" |
| NPK_Potassium02 | "Potassium 2" |
| NPK_Moisture03 | "Soil Moisture 3" |
| NPK_Temperature03 | "Soil Temp 3" |
| NPK_EC03 | "Soil EC 3" |
| NPK_PH03 | "Soil pH 3" |
| NPK_Nitrogen03 | "Nitrogen 3" |
| NPK_Phosphorus03 | "Phosphorus 3" |
| NPK_Potassium03 | "Potassium 3" |
| NPK_Moisture04 | "Soil Moisture 4" |
| NPK_Temperature04 | "Soil Temp 4" |
| NPK_EC04 | "Soil EC 4" |
| NPK_PH04 | "Soil pH 4" |
| NPK_Nitrogen04 | "Nitrogen 4" |
| NPK_Phosphorus04 | "Phosphorus 4" |
| NPK_Potassium04 | "Potassium 4" |
| NPKData | "NPK Sensor Data" |
| Timer01..Timer12 | "Timer 1".."Timer 12" |

### keys mapping (datapoint/key-level friendly names inside textMap values)
Maps individual keys in textMap attributes to human-readable names.

**EnvData/Moisture/Relay keys:**
- valve → "Valve"
- t0,h0 (board), t1-h4/t? ports, h1-h4, m1-m4, r1-r4, light

**Timer keys:**
- Status → "Run Status"
- Days → "Schedule"
- Outputs → "Target Switches"
- OnHour/OnMinute/OffHour/OffMinute → time fields

**NPKData keys (per-port):** m01,t01,ec01,ph01,n01,p01,k01 through m04..k04 mapped to descriptive names including port numbers

---

## 11. openremote_api_gui.py - Standalone GUI Tool

**File**: openremote_api_gui.py (407 lines) - Tkinter-based desktop GUI for OpenRemote API operations

### Purpose
Standalone GUI tool for managing OpenRemote provisioning rules and asset templates, with CA/cert generation utilities. Connects to OpenRemote Manager via HTTPS API.

### OpenRemoteAPI Class (lines 11-73)
```python
OpenRemoteAPI(host, username, password, realm="master")
```
- Stores credentials, token, SSL context (unverified: `ssl._create_unverified_context()`)
- Uses `http.client.HTTPSConnection` (not requests)

**Methods:**
- `authenticate()`: POST to `/{realm}/protocol/openid-connect/token` with form data (client_id=openremote, grant_type=password). Returns (True, "Success") with token set, or (False, error)
- `get_provisioning_rules()`: GET `/api/master/provisioning` with Bearer token. Returns (success, data)
- `update_provisioning_rule(rule_id, rule_data)`: PUT `/api/master/provisioning/{rule_id}` with JSON body. Returns (success, msg)

### GUI Windows

#### AutoProvisioningWindow (lines 75-173) - "Auto-Provisioning CA Manager"
- **Purpose**: View provisioning rules and update CA certificates
- **UI**: Left panel rule listbox, right panel rule details + "Update CA Certificate (PEM)" button
- **Workflow**:
  1. Load rules via API in background thread
  2. Display rule name in list; on select show name, ID, asset type (parsed from assetTemplate), whether CA configured (checks rule.data.CACertPEM)
  3. "Update CA Certificate" opens file dialog for .pem, reads file, prompts confirmation, updates rule.data.CACertPEM via API, refreshes list

#### AssetTemplateEditorWindow (lines 175-268) - "Asset Template Editor"
- **Purpose**: View and edit asset template JSON for provisioning rules
- **UI**: Left rule list, right JSON editor (monospace font), Format JSON and Save buttons
- **Workflow**:
  1. Load rules, on select parse and pretty-print assetTemplate JSON in editor
  2. Format button validates and re-formats with indent=4
  3. Save button validates JSON, sets rule['assetTemplate'] = new_json, calls update_provisioning_rule, shows result

#### CertGeneratorWindow (lines 270-311) - "Certificate Generator"
- **Purpose**: Generate CA certificates using openssl (shell commands)
- **UI**: Device type input, Generate button, log output
- **Workflow**:
  - Takes device type (e.g., "sensor", "flite")
  - Runs shell command to:
    1. Create `secrets/{dev_type}/` directory
    2. Create temporary v3_ca_tmp.ext with `basicConstraints = critical, CA:TRUE`
    3. Generate CA key: `openssl genrsa -out secrets/{dev_type}/ca.key 4096`
    4. Generate CSR with CN `{dev_type}_CA`
    5. Sign CA with `secrets/farmhub/ca.pem` and `secrets/farmhub/ca.key` (creates ca.pem valid 3650 days)
    6. Clean up temp ext file
- Runs with `subprocess.run(cmd, shell=True, check=True, cwd=os.getcwd())`

#### DashboardWindow (lines 313-348)
- Main dashboard after login, provides access to the three tools above
- Hides main login window on open, restores on close

#### OpenRemoteLoginApp (lines 350-407)
- Login window with fields: Host, Realm, Username, Password (defaults: master.senspanel.com, master, admin, secret)
- On login, creates OpenRemoteAPI and authenticates in background thread
- On success, opens DashboardWindow

### Overall Workflow
1. User logs in to OpenRemote Manager (Keycloak auth via API class)
2. Can browse provisioning rules, update CA certs in rules' data.CACertPEM
3. Can edit assetTemplate JSON for each rule
4. Can generate new device-type CAs signed by farmhub CA

---

## 12. requirements.txt - Dependencies

Exact dependency list with versions (no pinned versions specified):

```
fastapi
uvicorn
requests
jinja2
python-multipart
itsdangerous
```

**Notes:**
- `fastapi` - Web framework
- `uvicorn` - ASGI server
- `requests` - HTTP client for API calls to OpenRemote/Keycloak/HawkBit
- `jinja2` - Template engine
- `python-multipart` - Form data parsing (for login/signup forms)
- `itsdangerous` - Required by Starlette SessionMiddleware for signing sessions

---

## Additional Files (Referenced)

### manager_config.json
`deploy/manager/app/manager_config.json` (11 lines):
```json
{
  "realms": {
    "default": {
      "apptitle": "Drip Irrigation IoT Manager",
      "styles": ":host > * {--or-app-color2: #00af4f; --or-app-color4: #000000; }",
      "logo": "images/logo.png",
      "logoMobile": "images/logo_mobile.png",
      "favicon": "images/favicon.png"
    }
  }
}
```
OpenRemote Manager UI theming/config (not part of this Flask app, but deployment config).

### Verification Scripts
- `src/verify_datapoint_api.py` (243 lines): Test script for datapoint history API, role checking, asset creation
- `src/verify_export_api.py` (105 lines): Test script for datapoint export API (ZIP export)

### Templates directory
Referenced by routes - contains HTML templates (login.html, dashboard.html, etc.) for Jinja2 rendering.

---

## Summary

This is a FastAPI-based web application that acts as a custom UI/frontend for OpenRemote IoT platform. It integrates with:
- **Keycloak** (auth, user management, roles)
- **OpenRemote Manager API** (assets, rules, users, attributes)
- **Eclipse hawkBit** (OTA target management via DDI API)
- **SMTP** (OTP emails)

Key architectural patterns:
- Username-prefixed protected routes with session-based auth + token validation/refresh
- Admin token usage for privileged operations (user linking, rule management)
- Background threads for non-blocking HawkBit sync
- Local JSON storage for user preferences
- OTP-based email verification and password reset
