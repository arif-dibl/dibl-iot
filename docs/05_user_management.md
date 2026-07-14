# User Management — Keycloak & OpenRemote Users

This document explains how user identity, authentication, and role-based access control (RBAC) are managed in the DIBL IoT platform using the integrated **Keycloak** service, and how the Custom UI interacts with it.

---

## Table of Contents
- [Keycloak Architecture (Master Realm)](#keycloak-architecture-master-realm)
- [User Types](#user-types)
- [Role-Based Access Control (RBAC)](#role-based-access-control-rbac)
- [Custom UI Authentication Flow](#custom-ui-authentication-flow)
- [User API & Profile Management](#user-api--profile-management)
- [Asset Sharing (Asset Partners)](#asset-sharing-asset-partners)

---

## Keycloak Architecture (Master Realm)

OpenRemote delegates all Identity and Access Management (IAM) to **Keycloak**. 
- In this deployment, all operations happen within the **`master` realm**.
- Keycloak is accessible externally via `https://<OR_HOSTNAME>/auth` (or `/auth/admin` for the Keycloak Admin Console).
- The OpenRemote Manager relies on JWT (JSON Web Tokens) issued by Keycloak to authenticate API requests and MQTT connections.

---

## User Types

There are three distinct types of users within the DIBL IoT ecosystem:

### 1. The Admin User
- **Credentials:** Configured in `.env` via `OR_ADMIN_PASSWORD` (username is always `admin`).
- **Role:** Superuser. Has full access to the Keycloak Admin Console, OpenRemote Manager UI, and HawkBit.
- **Usage:** The Custom UI backend uses the Admin user's credentials to fetch an `admin_token` (via `get_admin_token()`). This elevated token is required to perform system-level operations, such as linking assets to other users or looking up Keycloak UUIDs.

### 2. End-Users (Customers)
- **Role:** Real human users who log into the Custom UI to monitor and control their devices.
- **Creation:** Can be created via the OpenRemote UI or the Custom UI signup flow.
- **Permissions:** They only see assets that have been explicitly linked to their Keycloak User ID.

### 3. Service Users (IoT Devices)
- **Role:** Non-human accounts created automatically by the OpenRemote Auto-Provisioning engine.
- **Mechanism:** When a new ESP32 connects via MQTT presenting a valid X.509 certificate, OpenRemote creates an Asset *and* a corresponding Service User in Keycloak. 
- **Permissions:** These users have highly restricted roles (typically just `write:attributes`) allowing them only to publish telemetry for their specific asset.

---

## Role-Based Access Control (RBAC)

OpenRemote uses specific Client Roles within Keycloak to govern what a user or service can do via the API. 
The Custom UI codebase (`src/core/auth.py`) automatically maps these roles during user setup. Key roles include:

- `read:assets` / `write:assets`
- `read:attributes` / `write:attributes` (Required for devices to send data and users to toggle switches)
- `read:rules` / `write:rules`
- `read:alarms` / `write:alarms`

When a new user registers through the system, the `assign_roles_to_user()` function dynamically attaches these OpenRemote client roles to the user's Keycloak UUID so they have the necessary permissions to interact with the platform.

---

## Custom UI Authentication Flow

Because the Custom UI is a bespoke frontend, it must securely negotiate login with Keycloak:

1. **User Login:** The user submits their username and password to the FastAPI backend.
2. **Keycloak Handshake:** The backend (`perform_auto_login_logic` in `src/core/auth.py`) programmatically submits these credentials to the Keycloak OpenID Connect endpoint (`/protocol/openid-connect/auth`).
3. **Token Retrieval:** If successful, Keycloak returns an `access_token` (JWT) and a `refresh_token`.
4. **Session Storage:** The Custom UI stores these tokens securely in an encrypted HTTP-only session cookie.
5. **Gatekeeper Validation:** Every protected route passes through `verify_username_match()`, which checks the session cookie, ensures the token hasn't expired, and verifies the user is only accessing their own namespace.

---

## User API & Profile Management

The Custom UI exposes endpoints (in `src/api/user.py`) to allow users to manage their accounts without needing to access the complex OpenRemote Manager interface:

- **`GET /api/user/profile`**: Fetches the user's details (email, first name, last name) directly from the OpenRemote REST API.
- **`PUT /api/user/profile`**: Updates personal information.
- **`PUT /api/user/change-password`**: 
  - First, validates the `currentPassword` by attempting to fetch a new token from Keycloak.
  - If valid, calls the OpenRemote `reset-password` endpoint with the new password.

---

## Asset Sharing (Asset Partners)

A unique feature of the DIBL IoT Custom UI is the "Asset Partners" endpoint (`GET /api/user/asset-partners`). 
Because an agricultural FarmHub might be managed by multiple farm workers, an asset can be linked to multiple users.

**How it works:**
1. The API fetches the current user's linked assets.
2. It uses the `admin_token` to fetch *all* asset-user links in the system (`/api/master/asset/user/link`).
3. It filters the global list to find other Keycloak User IDs linked to the same assets.
4. It resolves those User IDs to human-readable names and returns a list of "partners" who share access to the device.
