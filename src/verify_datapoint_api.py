
import requests
import json
import os
import sys

# Constants
KEYCLOAK_URL = os.getenv("KEYCLOAK_URL", "https://localhost/auth")
OR_MANAGER_URL = os.getenv("OR_MANAGER_URL", "https://localhost")
OR_HOSTNAME = os.environ.get('OR_HOSTNAME', 'localhost')
DEFAULT_REALM = "dibl-iot"
MASTER_REALM = "master"
ADMIN_USER = "admin"
ADMIN_PASS = os.getenv("OR_ADMIN_PASSWORD", "secret")

# Test User Credentials (use one that exists or create one)
TEST_USER = "testuser"
TEST_PASS = "testpass"

def get_token(realm, username, password):
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
            return res.json().get("access_token")
        else:
            print(f"Failed to get token for {username}: {res.text}")
    except Exception as e:
        print(f"Error getting token: {e}")
    return None

def list_user_roles(realm, user_id, admin_token):
    print(f"Checking roles for user {user_id}...")
    headers = {"Authorization": f"Bearer {admin_token}", "Host": OR_HOSTNAME}
    
    # Get client ID first
    clients_url = f"{KEYCLOAK_URL}/admin/realms/{realm}/clients?clientId=openremote"
    res = requests.get(clients_url, headers=headers, verify=False)
    if res.status_code != 200 or not res.json():
        print("Could not find openremote client")
        return []
    
    client_uuid = res.json()[0]['id']
    
    url = f"{KEYCLOAK_URL}/admin/realms/{realm}/users/{user_id}/role-mappings/clients/{client_uuid}"
    try:
        res = requests.get(url, headers=headers, verify=False)
        if res.status_code == 200:
            roles = [r['name'] for r in res.json()]
            print(f"User Roles: {roles}")
            return roles
        else:
            print(f"Failed to list roles: {res.text}")
    except Exception as e:
        print(f"Error listing roles: {e}")
    return []

def assign_roles(realm, user_id, admin_token):
    print(f"Assigning roles to {user_id}...")
    headers = {"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json", "Host": OR_HOSTNAME}
    
    # Get client ID
    clients_url = f"{KEYCLOAK_URL}/admin/realms/{realm}/clients?clientId=openremote"
    res = requests.get(clients_url, headers=headers, verify=False)
    if res.status_code != 200: return False
    client_uuid = res.json()[0]['id']
    
    # Get Available Roles
    roles_url = f"{KEYCLOAK_URL}/admin/realms/{realm}/clients/{client_uuid}/roles"
    res = requests.get(roles_url, headers=headers, verify=False)
    if res.status_code != 200: return False
    all_roles = res.json()
    
    # Assign 'read:assets', 'read:attributes' if available
    wanted = ["read:assets", "read:attributes", "read:user", "read:rules"]
    to_assign = [r for r in all_roles if r['name'] in wanted]
    
    assign_url = f"{KEYCLOAK_URL}/admin/realms/{realm}/users/{user_id}/role-mappings/clients/{client_uuid}"
    res = requests.post(assign_url, json=to_assign, headers=headers, verify=False)
    if res.status_code in [200, 204]:
        print("Roles assigned successfully.")
        return True
    else:
        print(f"Role assignment failed: {res.text}")
        return False

def create_user(realm, admin_token, username, password):
    url = f"{KEYCLOAK_URL}/admin/realms/{realm}/users"
    headers = {
        "Authorization": f"Bearer {admin_token}",
        "Content-Type": "application/json",
        "Host": OR_HOSTNAME
    }
    user_data = {
        "username": username,
        "enabled": True,
        "credentials": [{"type": "password", "value": password, "temporary": False}]
    }
    try:
        res = requests.post(url, json=user_data, headers=headers, verify=False)
        if res.status_code == 201:
            print(f"Created user {username} in {realm}")
            return True
        elif res.status_code == 409:
             print(f"User {username} already exists in {realm}")
             return True # Already exists is fine
        else:
             print(f"Failed to create user: {res.text}")
    except Exception as e:
        print(f"Error creating user: {e}")
    return False

def create_asset(realm, admin_token, name):
    url = f"{OR_MANAGER_URL}/api/{realm}/asset"
    headers = {
        "Authorization": f"Bearer {admin_token}",
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Host": OR_HOSTNAME
    }
    asset_data = {
        "name": name,
        "type": "ThingAsset",
        "accessPublicRead": True,
        "attributes": {
            "temperature": {
                "name": "temperature",
                "type": "number",
                "value": 25.0
            },
            "notes": {
                "name": "notes",
                "type": "text",
                "value": "Test Asset Notes"
            },
            "location": {
                "name": "location",
                "type": "geo:point",
                "value": {
                    "type": "Point",
                    "coordinates": [5.0, 52.0]
                }
            }
        }
    }
    try:
        res = requests.post(url, json=asset_data, headers=headers, verify=False)
        if res.status_code in [200, 201]:
            print(f"Created asset {name}")
            return res.text # returns ID usually or full obj
        else:
             print(f"Failed to create asset: {res.text}")
    except Exception as e:
        print(f"Error creating asset: {e}")
    return None

def test_api(name, token, method, endpoint, body=None):
    url = f"{OR_MANAGER_URL}{endpoint}"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "Host": OR_HOSTNAME
    }
    print(f"\n--- Testing {name} [{method} {endpoint}] ---")
    try:
        if method == "GET":
            res = requests.get(url, headers=headers, verify=False)
        elif method == "POST":
            res = requests.post(url, json=body, headers=headers, verify=False)
        
        print(f"Status: {res.status_code}")
        if res.status_code >= 400:
            print(f"Error: {res.text}")
        else:
            print("Success (preview):", res.text[:200])
    except Exception as e:
        print(f"Exception: {e}")

def main():
    print("Getting tokens...")
    admin_token = get_token(MASTER_REALM, ADMIN_USER, ADMIN_PASS)
    if not admin_token:
        print("Could not get Admin token. Aborting.")
        return

    # Hardcoded Configuration
    target_realm = DEFAULT_REALM
    asset_id = "6SXHozgEUJ7TKD2o6z1gB0"
    attribute_name = "X"
    print(f"Using Asset: {asset_id} Attribute: {attribute_name} in Realm: {target_realm}")

    # Ensure Test User Exists
    create_user(target_realm, admin_token, TEST_USER, TEST_PASS)
    
    # Get User ID
    headers = {"Authorization": f"Bearer {admin_token}", "Host": OR_HOSTNAME}
    users_url = f"{KEYCLOAK_URL}/admin/realms/{target_realm}/users?username={TEST_USER}"
    user_id = None
    res = requests.get(users_url, headers=headers, verify=False)
    if res.status_code == 200 and res.json():
        user_id = res.json()[0]['id']

    if user_id:
        roles = list_user_roles(target_realm, user_id, admin_token)
        if "read:assets" not in roles:
            assign_roles(target_realm, user_id, admin_token)
    
    # Get User Token
    user_token = get_token(target_realm, TEST_USER, TEST_PASS)
    if not user_token:
         print(f"Warning: Could not get token for {TEST_USER} in {target_realm}.")

    # Define Endpoints
    # 1. Datapoint History (POST) - Confirmed by docs
    endpoint_history = f"/api/{target_realm}/asset/datapoint/{asset_id}/{attribute_name}"
    
    # 2. Current Value (GET) - Standard API
    endpoint_current = f"/api/{target_realm}/asset/{asset_id}/attribute/{attribute_name}"
    
    payload_history = {
        "fromTimestamp": 0, 
        "toTimestamp": 9999999999999,
        "type": "json" # or string/number depending on attribute
    }

    if user_token:
        # TEST 1: User POST History
        test_api("User (POST History)", user_token, "POST", endpoint_history, body=payload_history)

        # TEST 2: User GET Current Value
        test_api("User (GET Current)", user_token, "GET", endpoint_current)
        
    print("\nDone.")

if __name__ == "__main__":
    main()
