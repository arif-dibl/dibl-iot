# API Reference and Device Sync Solution

This document outlines all APIs used within the Custom UI architecture (spanning Frontend, Backend, OpenRemote, and Keycloak) and the Eclipse HawkBit OTA system. It also details the research-based solution for automatically syncing OpenRemote assets to HawkBit targets and groups.

## 1. Complete API Reference

### 1.1 Custom UI Platform APIs

#### Frontend to Custom UI Backend (`/api/`)
These endpoints are exposed by the Python FastAPI backend and consumed by the JavaScript frontend (`src/static/js/*.js`).

*   **User & Profile:**
    *   `GET /api/user/profile`
    *   `PUT /api/user/profile`
    *   `PUT /api/user/change-password`
    *   `GET /api/user/preferences`
    *   `PUT /api/user/preferences/pin`
    *   `PUT /api/user/preferences/pin/rename`
*   **Asset Management:**
    *   `GET /api/user/assets`
    *   `POST /api/user/assets`
    *   `GET /api/user/assets/{id}`
    *   `PUT /api/user/assets/{id}`
    *   `DELETE /api/user/assets/{id}`
    *   `GET /api/asset/{assetId}`
    *   `PUT /api/asset/{assetId}/attribute/{attrName}`
    *   `GET /api/user/asset-partners`
*   **Dashboard & Misc:**
    *   `GET /api/user/dashboard/widgets`
    *   `GET /api/friendly-names`
    *   `POST /api/debug/proxy`

#### Custom UI Backend to External Services (Keycloak & OpenRemote)
These external calls are made by the Python backend (`src/api/*`, `src/core/*`) using the `requests` library.

*   **To Keycloak (Auth & User Management):**
    *   `POST /realms/{realm}/protocol/openid-connect/token`
    *   `GET /realms/{realm}/protocol/openid-connect/auth`
    *   `POST /admin/realms/{realm}/users`
    *   `PUT /admin/realms/{realm}/users/{user_id}/execute-actions-email`
    *   `GET /admin/realms/{realm}/clients?clientId=openremote`
    *   `GET /admin/realms/{realm}/clients/{client_uuid}/roles`
    *   `GET /admin/realms/{realm}/roles`
    *   `POST /admin/realms/{realm}/users/{user_id}/role-mappings/clients/{client_uuid}`
    *   `POST /admin/realms/{realm}/users/{user_id}/role-mappings/realm`
    *   `GET /admin/realms/{target_realm}/users?username={username}`
*   **To OpenRemote Manager (Asset & Rule Management):**
    *   `GET /api/{realm}/asset/{aid}`
    *   `PUT /api/{realm}/asset/{asset_id}`
    *   `DELETE /api/{realm}/asset/{asset_id}`
    *   `GET /api/{realm}/asset/user/current`
    *   `POST /api/master/asset/user/link`
    *   `GET /api/master/asset/user/link?realm={realm}`
    *   `POST /api/{realm}/rule`
    *   `DELETE /api/{realm}/rule/{ruleId}`
    *   `GET /api/{realm}/user/user/{pid}`

### 1.2 Eclipse HawkBit Management APIs
These REST APIs are exposed by the HawkBit update server on the `/rest/v1/` path for OTA lifecycle management.

*   **Targets (Devices):**
    *   `GET /rest/v1/targets`
    *   `POST /rest/v1/targets`
    *   `GET /rest/v1/targets/{controllerId}`
    *   `PUT /rest/v1/targets/{controllerId}`
    *   `DELETE /rest/v1/targets/{controllerId}`
*   **Software Modules & Artifacts:**
    *   `GET /rest/v1/softwaremodules`
    *   `POST /rest/v1/softwaremodules`
    *   `POST /rest/v1/softwaremodules/{softwareModuleId}/artifacts`
    *   `DELETE /rest/v1/softwaremodules/{softwareModuleId}`
*   **Distribution Sets:**
    *   `GET /rest/v1/distributionsets`
    *   `POST /rest/v1/distributionsets`
    *   `POST /rest/v1/distributionsets/{distributionSetId}/softwaremodules`
    *   `DELETE /rest/v1/distributionsets/{distributionSetId}`
*   **Target Filters (Groups):**
    *   `GET /rest/v1/targetfilters`
    *   `POST /rest/v1/targetfilters`
    *   `PUT /rest/v1/targetfilters/{filterId}`
    *   `DELETE /rest/v1/targetfilters/{filterId}`
*   **Rollouts & Actions:**
    *   `POST /rest/v1/actions`
    *   `POST /rest/v1/rollouts`
    *   `POST /rest/v1/rollouts/{rolloutId}/start`
    *   `GET /rest/v1/rollouts/{rolloutId}`

---

## 2. APIs Related to Device / Asset / Target Handling

The following endpoints are strictly related to the physical or logical lifecycle of the device across the two platforms:

### Custom UI / OpenRemote (Asset Handling)
*   **Frontend:**
    *   `GET /api/asset/{assetId}` (Read state)
    *   `PUT /api/asset/{assetId}/attribute/{attrName}` (Control physical device)
    *   `GET /api/user/assets` (List user devices)
*   **Backend:**
    *   `GET /api/{realm}/asset/{aid}` (Fetch full asset JSON)
    *   `POST /api/master/asset/user/link` (Link/Provision asset to user)
    *   `PUT /api/{realm}/asset/{asset_id}` (Update metadata)
    *   `DELETE /api/{realm}/asset/{asset_id}` (Delete asset)

### HawkBit (Target Handling)
*   `GET /rest/v1/targets` (List all OTA targets)
*   `GET /rest/v1/targets/{controllerId}` (Check specific device OTA status)
*   `POST /rest/v1/targets` (Register device for OTA)
*   `PUT /rest/v1/targets/{controllerId}` (Update OTA target metadata)
*   `DELETE /rest/v1/targets/{controllerId}` (Remove device from OTA)

---

## 3. Solution: Auto-Provisioning OpenRemote Assets to HawkBit

Based on the API specifications, this section outlines the idempotent integration flow to sync newly provisioned OpenRemote assets (with their `id` and `type`) into HawkBit `targets` and `targetfilters` (Groups).

### Implementation Environment
This logic should reside within the Custom UI Python backend (e.g., in `src/api/assets.py` or a dedicated `src/core/hawkbit.py` script). It relies on the Python `requests` library and utilizes the internal Docker network to communicate securely with `http://hawkbit:8080/rest/v1/`.

### Workflow & Evidence-Based Logic

#### Step 1: Extract Asset Data
**Trigger:** Whenever the Custom UI backend fetches asset details or performs a successful link (`POST /api/master/asset/user/link`).
**Action:** Extract the necessary fields from the OpenRemote JSON response:
*   `asset_id` (e.g., `5kGfVxyz123`) -> Maps to HawkBit `controllerId`
*   `asset_type` (e.g., `DripIrrigationNode`) -> Maps to HawkBit `Target Filter` (Group)

#### Step 2: Idempotent Target Filter (Group) Creation
In HawkBit, devices are grouped using "Target Filters", which execute queries against target metadata or tags.

1.  **Check for existence:**
    *   `GET http://hawkbit:8080/rest/v1/targetfilters`
    *   *Logic:* Parse the response JSON. If a filter with `name == asset_type` exists, skip creation.
2.  **Create if missing:**
    *   If not found, create the group:
    *   `POST http://hawkbit:8080/rest/v1/targetfilters`
    *   *Payload:* 
        ```json
        [
          {
            "name": "{asset_type}",
            "query": "name=='*{asset_type}*'"
          }
        ]
        ```
    *   *Evidence:* HawkBit filter queries use FIQL syntax. `name=='*<type>*'` ensures any target containing the asset type in its name/tag falls into this group automatically.

#### Step 3: Idempotent Target Creation
1.  **Check for existence:**
    *   `GET http://hawkbit:8080/rest/v1/targets/{asset_id}`
    *   *Logic:* If the response is HTTP `200 OK`, the device is already provisioned in HawkBit. Do nothing.
2.  **Create if missing:**
    *   If the response is HTTP `404 Not Found`, the target must be created.
    *   `POST http://hawkbit:8080/rest/v1/targets`
    *   *Payload:*
        ```json
        [
          {
            "controllerId": "{asset_id}",
            "name": "{asset_type}_{asset_id}",
            "description": "Auto-provisioned via Custom UI"
          }
        ]
        ```
    *   *Evidence:* Setting the `name` to include the `{asset_type}` fulfills the FIQL query defined in the Target Filter (`name=='*{asset_type}*'`). Consequently, upon creation, the target is instantly categorized into the correct HawkBit group without any additional manual grouping API calls.

### Conclusion
By relying on HTTP status codes (`200 OK` vs `404 Not Found`) and lists (`GET` endpoints), the backend guarantees that targets and filters are never duplicated. This provides a robust, evidence-based auto-provisioning pipeline connecting OpenRemote and HawkBit OTA.
