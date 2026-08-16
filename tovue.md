# Vue.js Frontend Migration Plan

## Status: read-only analysis complete
All non-secret source files read (main.py, routes/, api/, core/, templates/, static/js/, static/css/, requirements.txt, Dockerfile, compose files, config JSONs, verify_*.py, README). Verified against `tree` (36 dirs, 225 files).

## Current architecture (verified by tree)

```
DIBL_IOT/
├── src/main.py              # FastAPI app; SessionMiddleware(secret_key="supersecretkey")
├── src/core/                # auth.py (verify_username_match gatekeeper, token refresh), config.py, hawkbit.py, otp.py, utils.py
├── src/routes/{auth,dashboard}.py   # auth pages + 9 Jinja2 page routes under /{username}/
├── src/api/{assets,rules,user,debug}.py   # JSON APIs under /{username}/api/...
├── src/templates/*.html     # 16 Jinja2 templates; base.html injects BASE_PREFIX & APP_PREFIX globals
├── src/static/{js,css,images}
├── src/{verify_datapoint_api.py,verify_export_api.py}   # CLI test scripts
├── config/{friendly_names.json,asset_template.json,...}
├── deploy/Dockerfile        # copies src/,config/,data/ -> /app/src; runs uvicorn on :5000
├── docker-compose.yml / docker-compose.coolify.yml
└── data/maps/*              # mbtiles (app-state, not app-code)
```

**Key architectural facts (from source):**
- `main.py:46-60` — `user_router` mounts 4 API routers + the page router under prefix `{APP_PREFIX}/{username}` with `Depends(verify_username_match)`.
- `auth.py:33-52` — gatekeeper requires `username` URL segment == `request.session["username"]`. **Every protected API call is `{APP_PREFIX}/{username}/api/...`**.
- `main.py:19` — sessions are signed cookies; the OpenRemote access token is stored **server-side** only (`auth.py:324`). The browser never holds the token → it injects it server-side in each proxied API call.
- `base.html:16-18` — `BASE_PREFIX="{{ prefix }}"` (APP_PREFIX) and `APP_PREFIX="{{ prefix }}/{{ username }}"`; every JS file uses `APP_PREFIX + "/api/..."`.
- Auth flow: login form POSTs `email` to `/login` (`routes/auth.py:27`), server resolves username via Keycloak, 303 → `/{username}/dashboard`. Signup 303 → `/verify-email?email=...`. Logout clears session → 302 → `/`.
- `test_api.html` page uses Basic Auth `arif/12345` (`auth_test_api` dependency, `auth.py:18-31`).
- `APP_PREFIX` env defaults to `""` in compose (production serves at domain root); `datapoint_history.html` injects `window.USER_REALM="{{ realm }}"` (default realm `dibl-iot`).
- JS dependencies: `chart.js` (CDN, datapoint_history), `html5-qrcode` (CDN, assets/link), `qrcodejs` (CDN, asset_detail/assets) — all CDN, no npm.

## What needs to change

### A. New Vue 3 + Vite frontend (greenfield, lives in repo)

Add `frontend/` (Vite + Vue 3 + Vue Router + Pinia + TypeScript) built from:

```
frontend/
├── package.json            # vite, vue@3, vue-router, pinia, axios (or fetch wrapper), chart.js, html5-qrcode, qrcode
├── vite.config.ts          # base path = APP_PREFIX (empty in prod, '/customui' in dev)
├── src/
│   ├── main.ts             # app bootstrap
│   ├── router/index.ts     # /{username}/dashboard, /assets, /asset/:id, /rules, /timers, /settings, /history, /test
│   ├── stores/             # session (username/realm from URL), friendlyNames, preferences
│   ├── services/api.ts     # fetch wrapper -> `${BASE}/${username}/api/...` (replaces APP_PREFIX global)
│   ├── components/         # Widget, SwitchCard, RelayToggle, WheelPicker, Modal, QrReader
│   └── views/
│       ├── Dashboard.vue   # <- main.js + dashboard.js (43KB)
│       ├── Assets.vue      # <- assets.js + QR link modal
│       ├── AssetDetail.vue # <- asset_detail.js (44KB) + wheel picker + QR ID modal
│       ├── Rules.vue       # <- rules.js
│       ├── Timers.vue      # <- timers.js (44KB) + wheel picker
│       ├── Settings.vue    # <- user_profile.js
│       ├── History.vue     # <- datapoint_history.js (Chart.js)
│       └── TestApi.vue     # <- test_api.js (needs Basic auth header)
├── public/favicon.png
└── dist/                   # build output -> copied into Docker image

auth views:
├── views/auth/Login.vue, Signup.vue, VerifyEmail.vue, ResetPassword.vue, ForgotPassword.vue
```

**Map of logic to migrate (verified against each JS file read):**

| JS file | Lines | Vue target | Key logic to port |
|---|---|---|---|
| main.js | 425 | stores/api.ts | friendlyNames cache (`loadFriendlyNames`), `getFriendlyName`, `toast`, `clearDiblCache`, `pollAssets`, `updateOnlineStatus` |
| dashboard.js | ~1300 | Dashboard.vue | stat cards (assets count, online/offline), switches (RelayData), pinned sensor widgets, timer highlights + device groups (calls `/api/user/preferences/highlights`, `/api/user/dashboard/widgets`), rules pin list |
| assets.js | ~1200 | Assets.vue | grid render, link modal + QR (`html5-qrcode`), edit modal, ID/QR modal, call `/api/user/assets`, `/user/assets/{id}` (PUT), `/user/assets` DELETE, `/user/provision-device` |
| asset_detail.js | ~1900 | AssetDetail.vue | groups render, relay toggles, wheel picker (`confirmWheelSelection`), ID modal w/ QR (`qrcodejs`), `/api/asset/{id}`, `/asset/{id}/attribute/{name}` (POST) |
| rules.js | ~900 | Rules.vue | asset select -> `loadAsset`, pin rules, add rule (name only; content is a Groovy stub), delete rule, `/api/user/rules` |
| timers.js | ~1400 | Timers.vue | per-device wheel picker, confirm, pin highlight, `/api/asset/{id}/attribute/TimerXX` POST |
| user_profile.js | 160 | Settings.vue | load profile, save (PUT `/api/user/profile`), change password (PUT `/api/user/change-password` → logout), asset-partners list |
| datapoint_history.js | 600 | History.vue | asset/attribute selects, time range, fetch via `/api/debug/proxy` to `/api/{realm}/asset/datapoint/{id}/{attr}`, table/graph/json views, chart.js, export (zip blob) |
| test_api.js | 58 | TestApi.vue | request builder proxying through `/api/debug/proxy` |
| auth.js | 64 | Login/Signup/Verify/Reset.vue | toggle forms, terms modal, password show/hide |

### B. Backend — small additive changes (keep all existing endpoints)

1. **`main.py`** — mount the built SPA:
   - `app.mount(f"{APP_PREFIX}/assets", StaticFiles(directory="static/app/dist/assets"), ...)` 
   - serve `index.html` from a tiny route.
2. **Auth flows** — two sub-options:
   - **(B1) Recommended: keep username-in-URL.** Replace the 9 `TemplateResponse` page routes in `routes/dashboard.py` with a single catch-all `/{username}/{path:path}` that (a) passes through `verify_username_match` and (b) returns the SPA shell (a minimal Jinja2/HTML file that sets `BASE_PREFIX` and `APP_PREFIX`, or just injects no global because the Vue app reads `username` from the URL). All JSON APIs unchanged.
   - Keep auth pages (login/signup/verify/reset) as server-rendered Jinja2 — they render without the app shell and already work; login 303 redirects are fine for full-page navigation. Vue auth pages are optional polish.
3. **Auth routes** (`routes/auth.py`) — **no change** required. Login still POSTs `email`, resolves to `username`, 303 → `/{username}/dashboard`. The `username` ends up in the URL for the SPA.
4. **`api/debug.py` proxy** — **unchanged** (still handles JSON + binary zip). Just document it for the Vue service layer.
5. **`test_api` Basic Auth** — for `TestApi.vue`: the SPA can only send Basic auth via JS if it holds `arif:12345` (hardcoded). **Issue:** putting credentials in client JS exposes them. **Recommendation:** drop the test-api page for the SPA, or gate it differently server-side.

### C. Deployment / Docker

- Extend `deploy/Dockerfile` with a `node:20` build stage: `npm --prefix frontend ci && npm run build` → copy `frontend/dist/` into `/app/src/static/app/`, then set WORKDIR and run exactly as today (port 5000). No nginx; FastAPI serves static + SPA shell.
- `docker-compose.coolify.yml` `custom-ui` service — unchanged ports; may add `BASE_PREFIX` env passed to Vite build via `--mode`.
- Delete `src/templates/*.html` and `src/static/js/*.js` + `src/static/css/*.css` **post-migration** (optional, can keep during transition).

## What this will improve

1. **Dev ergonomics** — component-based, TypeScript, npm deps (no CDN/version drift), hot-reload dev server, proper state management (Pinia) replacing global mutable JS state.
2. **Maintainability** — the 10 vanilla JS files (esp. `dashboard.js` 43KB and `asset_detail.js`/ `timers.js` 44KB each) have tangled global state (`currentAssetId`, `currentAttribute`, `friendlyNames`, `chartInstance` globals in `datapoint_history.js`, etc.). Component state + reactivity eliminates these globals.
3. **No auth regression risk** — the entire auth/proxy architecture (session cookie + server-side token injection + username gatekeeper + debug proxy) is untouched. The SPA only swaps the templating/transport layer.
4. **Testability** — unit-testable stores/components; currently no test coverage (`tests/fixtures/` only has cookie/HTML mocks).
5. **UX polish** — proper routing/transitions, typed store eliminates `window.USER_REALM` global injection per page, consolidated toasts, consistent error handling.

## What this will (or may) cause — risks & issues

1. **Big rewrite effort** — ~5,600 lines of JS across 10 files; `dashboard.js` + `asset_detail.js` + `timers.js` alone are ~8,400 lines combined. This is the dominant cost. Risk of logic loss/bugs if ported naively.
2. **Wheel picker / QR libraries** — `asset_detail.js` and `timers.js` include custom circular wheel pickers + `html5-qrcode`/`qrcodejs` integration in the templates. These must be ported to Vue wrappers.
3. **`APP_PREFIX` global → env** — `base.html:18` sets `APP_PREFIX = prefix + "/" + username`. The Vue app must reconstruct this. **Cleanest fix:** keep username in the URL (option B1), read from `route.params.username`. If you instead want a `/app` root, you need a new `/api/session` endpoint to hand the username to the SPA (since the session cookie is server-side and unreadable by JS).
4. **Inline template JS** — `asset_detail.html:74` (`ASSET_ID` global), `datapoint_history.html:133` (`USER_REALM`), `device_id_instructions.html` modal JS, `link_asset.html` QR script. All must be moved into components; the `ASSET_ID`/realm come from the URL/route in the SPA.
5. **Test API page credentials** — `TestApi.vue` needs Basic auth `arif:12345`. Exposing in JS is an information leak. (Recommendation: hide behind the existing BasicAuth server dependency by proxying through a logged-in-only check, or remove.)
6. **`asset/{asset_name}` name→id resolution** — currently done server-side in `dashboard.py:37-57`. The SPA must resolve asset name→id client-side via `/api/user/assets` (already returned by `assets.js`), so the route should use asset **id** rather than name.
7. **`clearDiblCache()`** — referenced in `base.html:95` on logout. Must be reimplemented in Vue (clear Pinia/LS) on `/logout`.
8. **Session cookie scope** — session cookie is `localhost`/domain scoped and non-httpOnly-readably fine for same-origin fetch. No CORS needed (same origin). But if the SPA is ever served from a different origin/subdomain, this whole model breaks. Keep SPA + API same-origin.
9. **Production `APP_PREFIX=""`** — the SPA must be built with `base:'/'` (Coolify) but also support `/customui`. Use Vite `base` driven by env at build time.
10. **Binary zip export** — `debug_proxy` returns a `Response` (not JSON) for exports. Axios (better than fetch for blob handling) or `responseType:'blob'` in fetch is required; trivial but must be handled explicitly.
11. **Token refresh timing** — `get_valid_token` refreshes server-side on expiry. The SPA sees only 303 redirects on expired sessions (via `NotAuthenticatedException` handler) → must handle unexpected 303s by routing back to login.
12. **Docs/knowledge drift** — `docs/09_custom_ui_architecture.md` (verified read) documents the old flow; should be updated to reference Vue. Not a code risk.

## Recommendation

**Phased approach:**
1. Add a single `/api/session` endpoint returning `{username, realm}` from the request session (so auth is future-proof and you are not forced into username-in-URL). Keep `verify_username_match` but relax the SPA to consume `/api/session` then `/{username}/api/...`. *(Minor backend change, big clarity win.)*
2. Scaffold the Vite app; migrate one page fully (e.g. Dashboard) as the proof-of-concept.
3. Migrate remaining pages in priority order: Assets → AssetDetail → Timers → History → Rules → Settings → TestApi.
4. Add the multi-stage Dockerfile build.
5. Delete legacy templates + JS/CSS only after the SPA is verified in staging.
