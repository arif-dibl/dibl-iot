import requests
import json
import base64
import re
import time
from fastapi import Request
from fastapi.responses import RedirectResponse
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
        resp = requests.post(url, data=data, headers=headers)
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
        res = requests.post(url, data=payload, headers=headers, verify=False)
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
        res = requests.post(url, data=payload, headers=headers, verify=False)
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

def perform_auto_login_logic(request: Request, realm: str, username: str, password: str):
    """
    Helper function to perform the auto-login dance.
    Returns (success, response_or_error_msg)
    """
    try:
        session = requests.Session()
        auth_url = f"{KEYCLOAK_URL}/realms/{realm}/protocol/openid-connect/auth"
        params = {
            "client_id": "openremote",
            "redirect_uri": f"https://{OR_HOSTNAME}/manager/",
            "response_type": "code",
            "scope": "openid"
        }
        headers = {"Host": OR_HOSTNAME}
        resp = session.get(auth_url, params=params, headers=headers, verify=False)
        resp.raise_for_status()
        
        match = re.search(r'action="([^"]+)"', resp.text)
        if not match:
            return False, "Could not find login form action"
            
        action_url = match.group(1).replace("&amp;", "&")
        target_url = action_url
        if f"https://{OR_HOSTNAME}/auth" in action_url:
            target_url = action_url.replace(f"https://{OR_HOSTNAME}/auth", KEYCLOAK_URL)
        elif f"http://{OR_HOSTNAME}/auth" in action_url:
            target_url = action_url.replace(f"http://{OR_HOSTNAME}/auth", KEYCLOAK_URL)
            
        payload = {"username": username, "password": password, "credentialId": ""}
        post_resp = session.post(target_url, data=payload, headers=headers, allow_redirects=False, verify=False)
        
        if post_resp.status_code == 302:
            request.session["realm"] = realm
            request.session["username"] = username
            token_data = get_user_token(realm, username, password)
            if token_data:
                request.session["access_token"] = token_data.get("access_token")
                request.session["refresh_token"] = token_data.get("refresh_token")
            
            admin_token = get_admin_token(realm)
            if admin_token:
                user_id = get_user_id_by_username(realm, username, admin_token)
                request.session["user_id"] = user_id
            
            return True, session.cookies
        else:
            return False, "Invalid username or password"
    except Exception as e:
        print(f"[LOGIN] Auto-login logic error: {e}")
        return False, str(e)
