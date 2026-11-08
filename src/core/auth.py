import requests
import json
import base64
import re
import time
from fastapi import Request, HTTPException, status, Depends
from fastapi.security import HTTPBasic, HTTPBasicCredentials
import secrets
from fastapi.responses import RedirectResponse
import time

class NotAuthenticatedException(Exception):
    def __init__(self, redirect_url: str):
        self.redirect_url = redirect_url

security = HTTPBasic()

def auth_test_api(credentials: HTTPBasicCredentials = Depends(security)):
    """
    Basic Auth dependency strictly for the Test API page.
    Validates against hardcoded specific user/password (arif / 12345).
    """
    correct_username = secrets.compare_digest(credentials.username.encode("utf8"), b"arif")
    correct_password = secrets.compare_digest(credentials.password.encode("utf8"), b"12345")
    if not (correct_username and correct_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Basic"},
        )
    return credentials.username

async def verify_username_match(username: str, request: Request):
    """
    Gatekeeper: Ensures the username in the URL matches the session username.
    Used as a FastAPI dependency for protected routes.
    """
    logged_in_user = request.session.get("username")
    
    # If not logged in at all, or trying to access someone else's space
    if not logged_in_user or username != logged_in_user:
        if logged_in_user:
            raise NotAuthenticatedException(redirect_url=f"/{logged_in_user}/dashboard")
            
        raise NotAuthenticatedException(redirect_url="/")
        
    # Also explicitly validate the token here so we catch expired sessions early
    from core.auth import get_valid_token
    if not get_valid_token(request):
        raise NotAuthenticatedException(redirect_url="/")
        
    return username
from core.config import (
    KEYCLOAK_URL, OR_HOSTNAME, OR_ADMIN_PASSWORD, OR_MANAGER_URL,
    DEFAULT_REALM, ASSIGN_ROLE_READ_ALARMS, ASSIGN_ROLE_READ_ASSETS,
    ASSIGN_ROLE_READ_INSIGHTS, ASSIGN_ROLE_READ_LOGS, ASSIGN_ROLE_READ_RULES,
    ASSIGN_ROLE_READ_SERVICES, ASSIGN_ROLE_READ_USERS, ASSIGN_ROLE_WRITE_ALARMS,
    ASSIGN_ROLE_WRITE_ASSETS, ASSIGN_ROLE_WRITE_ATTRIBUTES, ASSIGN_ROLE_WRITE_INSIGHTS,
    ASSIGN_ROLE_WRITE_LOGS, ASSIGN_ROLE_WRITE_RULES, ASSIGN_ROLE_WRITE_SERVICES,
    ASSIGN_ROLE_WRITE_USER
)

def get_admin_token(realm):
    """Fetches the admin token from the Master realm."""
    url = f"{KEYCLOAK_URL}/realms/master/protocol/openid-connect/token"
    data = {
        "grant_type": "password",
        "client_id": "openremote",
        "username": "admin",
        "password": OR_ADMIN_PASSWORD
    }
    headers = {"Host": OR_HOSTNAME}
    try:
        resp = requests.post(url, data=data, headers=headers, verify=False, timeout=10)
        resp.raise_for_status()
        return resp.json().get("access_token")
    except Exception as e:
        print(f"[TOKEN] Admin token error: {e}")
        return None

def assign_roles_to_user(realm, user_id, admin_token):
    """Assigns roles using the Keycloak Admin API directly."""
    try:
        headers = {
            "Authorization": f"Bearer {admin_token}",
            "Content-Type": "application/json"
        }
        clients_url = f"{KEYCLOAK_URL}/admin/realms/{realm}/clients?clientId=openremote"
        res = requests.get(clients_url, headers=headers)
        if res.status_code != 200 or not res.json():
            return False
            
        client_uuid = res.json()[0]['id']
        roles_url = f"{KEYCLOAK_URL}/admin/realms/{realm}/clients/{client_uuid}/roles"
        res = requests.get(roles_url, headers=headers)
        if res.status_code != 200:
            return False
            
        all_roles = res.json()
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
        
        wanted_roles = {name for enabled, name in role_map if enabled}
        roles_to_assign = [r for r in all_roles if r['name'] in wanted_roles]

        if not roles_to_assign:
            return True

        assign_url = f"{KEYCLOAK_URL}/admin/realms/{realm}/users/{user_id}/role-mappings/clients/{client_uuid}"
        res = requests.post(assign_url, json=roles_to_assign, headers=headers)
        return res.status_code in [200, 204]
    except Exception as e:
        print(f"[ROLE] Assignment error: {e}")
        return False

def get_user_id_by_username(realm, username, admin_token):
    url = f"{KEYCLOAK_URL}/admin/realms/{realm}/users"
    params = {"username": username, "exact": True}
    headers = {"Authorization": f"Bearer {admin_token}"}
    try:
        res = requests.get(url, params=params, headers=headers)
        if res.status_code == 200 and res.json():
            return res.json()[0]['id']
    except Exception as e:
        print(f"[USER] Lookup error: {e}")
    return None

def get_user_id_by_email(realm, email, admin_token):
    url = f"{KEYCLOAK_URL}/admin/realms/{realm}/users"
    params = {"email": email, "exact": True}
    headers = {"Authorization": f"Bearer {admin_token}"}
    try:
        res = requests.get(url, params=params, headers=headers)
        if res.status_code == 200 and res.json():
            return res.json()[0]['id']
    except Exception as e:
        print(f"[USER] Lookup error by email: {e}")
    return None

def get_username_by_email(realm, email, admin_token):
    url = f"{KEYCLOAK_URL}/admin/realms/{realm}/users"
    params = {"email": email, "exact": True}
    headers = {"Authorization": f"Bearer {admin_token}"}
    try:
        res = requests.get(url, params=params, headers=headers)
        if res.status_code == 200 and res.json():
            return res.json()[0]['username']
    except Exception as e:
        print(f"[USER] Lookup error by email: {e}")
    return None

def assign_realm_roles(realm, user_id, role_names, admin_token):
    try:
        headers = {
            "Authorization": f"Bearer {admin_token}",
            "Content-Type": "application/json"
        }
        roles_url = f"{KEYCLOAK_URL}/admin/realms/{realm}/roles"
        res = requests.get(roles_url, headers=headers)
        if res.status_code != 200:
            return False
        all_roles = res.json()
        roles_to_assign = [r for r in all_roles if r['name'] in role_names]
        if not roles_to_assign:
            return False
        assign_url = f"{KEYCLOAK_URL}/admin/realms/{realm}/users/{user_id}/role-mappings/realm"
        res = requests.post(assign_url, json=roles_to_assign, headers=headers)
        return res.status_code in [200, 204]
    except Exception as e:
        print(f"[ROLE] Realm role assignment error: {e}")
        return False

def get_user_token(realm, username, password):
    url = f"{KEYCLOAK_URL}/realms/{realm}/protocol/openid-connect/token"
    payload = {
        "client_id": "openremote",
        "username": username,
        "password": password,
        "grant_type": "password"
    }
    headers = {"Host": OR_HOSTNAME}
    try:
        res = requests.post(url, data=payload, headers=headers, verify=False, timeout=10)
        if res.status_code == 200:
            return res.json()
    except Exception as e:
        print(f"[AUTH] Token error: {e}")
    return None

def refresh_user_token(realm, refresh_token):
    url = f"{KEYCLOAK_URL}/realms/{realm}/protocol/openid-connect/token"
    payload = {
        "client_id": "openremote",
        "grant_type": "refresh_token",
        "refresh_token": refresh_token
    }
    headers = {"Host": OR_HOSTNAME}
    try:
        res = requests.post(url, data=payload, headers=headers, verify=False, timeout=10)
        if res.status_code == 200:
            return res.json()
    except Exception as e:
        print(f"[AUTH] Refresh error: {e}")
    return None

def get_valid_token(request: Request):
    access_token = request.session.get("access_token")
    refresh_token = request.session.get("refresh_token")
    realm = request.session.get("realm", DEFAULT_REALM)
    
    if not access_token:
        return None

    try:
        parts = access_token.split(".")
        if len(parts) > 1:
            payload_b64 = parts[1]
            payload_b64 += "=" * ((4 - len(payload_b64) % 4) % 4)
            payload_json = base64.urlsafe_b64decode(payload_b64).decode()
            exp = json.loads(payload_json).get("exp")
            
            current_time = time.time()
            if exp and (exp - current_time < 60):
                if refresh_token:
                    new_tokens = refresh_user_token(realm, refresh_token)
                    if new_tokens:
                        request.session["access_token"] = new_tokens.get("access_token")
                        if "refresh_token" in new_tokens:
                            request.session["refresh_token"] = new_tokens.get("refresh_token")
                        return new_tokens.get("access_token") 
                if exp < current_time:
                    request.session.clear()
                    return None
    except Exception as e:
        print(f"[AUTH] Token validation error: {e}")
        return None
    return access_token

def _extract_sub_from_jwt(access_token: str):
    """Extracts the 'sub' (user_id) claim from a JWT access token."""
    if not access_token:
        return None
    try:
        parts = access_token.split(".")
        if len(parts) > 1:
            payload_b64 = parts[1] + "=" * ((4 - len(parts[1]) % 4) % 4)
            return json.loads(base64.urlsafe_b64decode(payload_b64).decode()).get("sub")
    except Exception:
        pass
    return None

def perform_auto_login_logic(request: Request, realm: str, username: str, password: str):
    """
    Authenticates the user directly via Keycloak OIDC Token API (Direct Access Grants)
    and populates the FastAPI session.
    Returns (success, response_or_error_msg)
    """
    try:
        token_url = f"{KEYCLOAK_URL}/realms/{realm}/protocol/openid-connect/token"
        payload = {
            "client_id": "openremote",
            "username": username,
            "password": password,
            "grant_type": "password"
        }
        headers = {"Host": OR_HOSTNAME}
        token_resp = requests.post(token_url, data=payload, headers=headers, verify=False, timeout=10)

        # If Keycloak says "Account is not fully set up", check if email is verified
        # or if Keycloak 26's User Profile requires firstName/lastName/clearing requiredActions
        if token_resp.status_code == 400:
            try:
                err_data = token_resp.json()
                err_desc = err_data.get("error_description", "").lower()
            except Exception:
                err_desc = ""

            if "not fully set up" in err_desc:
                admin_token = get_admin_token(realm)
                user_id = get_user_id_by_username(realm, username, admin_token) if admin_token else None
                if admin_token and user_id:
                    admin_headers = {
                        "Authorization": f"Bearer {admin_token}",
                        "Content-Type": "application/json"
                    }
                    user_url = f"{KEYCLOAK_URL}/admin/realms/{realm}/users/{user_id}"
                    u_res = requests.get(user_url, headers=admin_headers, verify=False, timeout=10)
                    if u_res.status_code == 200:
                        u_obj = u_res.json()
                        if not u_obj.get("emailVerified", False):
                            return False, "Please verify your email address to activate your account before logging in."
                        # Email is verified, clear any blocking profile/requiredActions in Keycloak 26 and retry
                        u_obj["firstName"] = u_obj.get("firstName") or username
                        u_obj["lastName"] = u_obj.get("lastName") or username
                        u_obj["requiredActions"] = []
                        requests.put(user_url, json=u_obj, headers=admin_headers, verify=False, timeout=10)
                        token_resp = requests.post(token_url, data=payload, headers=headers, verify=False, timeout=10)
                else:
                    return False, "Please verify your email address to activate your account before logging in."

        if token_resp.status_code == 200:
            token_data = token_resp.json()
            access_token = token_data.get("access_token")
            refresh_token = token_data.get("refresh_token")

            request.session["realm"] = realm
            request.session["username"] = username
            request.session["access_token"] = access_token
            request.session["refresh_token"] = refresh_token

            user_id = _extract_sub_from_jwt(access_token)
            if not user_id:
                admin_token = get_admin_token(realm)
                if admin_token:
                    user_id = get_user_id_by_username(realm, username, admin_token)
            request.session["user_id"] = user_id

            return True, "Success"

        print(f"[DEBUG LOGIN] Keycloak token status {token_resp.status_code}: {token_resp.text[:300]}")
        try:
            err_desc = token_resp.json().get("error_description", "").lower()
            if "disabled" in err_desc:
                return False, "Your account has been disabled."
            if "not fully set up" in err_desc:
                return False, "Please verify your email address to activate your account before logging in."
        except Exception:
            pass

        return False, "Invalid email or password"
    except Exception as e:
        print(f"[LOGIN] Auto-login logic error: {e}")
        return False, "Authentication service is temporarily unavailable. Please try again later."
