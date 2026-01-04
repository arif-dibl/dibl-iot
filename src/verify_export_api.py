
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

def test_export(token, realm, asset_id, attribute_name):
    # Endpoint: /api/{realm}/asset/datapoint/export
    # Query: assetId, attributeRefs, fromTimestamp, toTimestamp
    endpoint = f"{OR_MANAGER_URL}/api/{realm}/asset/datapoint/export"
    
    # 24 hour range
    import time
    end = int(time.time() * 1000)
    start = end - (24 * 3600 * 1000)
    
    # Valid attributeRefs JSON: [{"id": "assetId", "name": "attributeName"}]
    import json
    refs = json.dumps([{"id": asset_id, "name": attribute_name}])
    
    params = {
        # "assetId": asset_id, # assetId might not be needed if in refs, but docs say "query parameters... attributeRefs".
        # Let's try JUST attributeRefs + timestamps first as per example.
        "attributeRefs": refs,
        "fromTimestamp": start,
        "toTimestamp": end
    }
    
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/zip", # Key for export
        "Host": OR_HOSTNAME
    }
    
    print(f"\n--- Testing Export [{endpoint}] ---")
    print(f"Params: {params}")
    
    try:
        res = requests.get(endpoint, params=params, headers=headers, verify=False)
        print(f"Status: {res.status_code}")
        print(f"Content-Type: {res.headers.get('Content-Type')}")
        
        if res.status_code == 200:
            print(f"Success! Content Length: {len(res.content)} bytes")
            print(f"First 50 bytes: {res.content[:50]}")
        else:
            print(f"Error Body: {res.text}")
            
    except Exception as e:
        print(f"Exception: {e}")

def main():
    print("Getting tokens...")
    admin_token = get_token(MASTER_REALM, ADMIN_USER, ADMIN_PASS)
    if not admin_token:
        return

    # Hardcoded Test Target
    target_realm = DEFAULT_REALM # or MASTER_REALM if assets are there?
    # In verify_datapoint_api.py, user used DEFAULT_REALM="dibl-iot" but in UI we saw "dibl-iot" or "master"
    # The browser session used "dibl-iot" probably?
    # Wait, browser used "dibl-iot device03", ID "5dMwOXZyq2ZbPclMj6d4CD"
    
    asset_id = "5dMwOXZyq2ZbPclMj6d4CD" # From browser log
    attribute_name = "EnvData" # From browser log
    
    # Use Admin token to be sure permissions aren't the issue first
    test_export(admin_token, MASTER_REALM, asset_id, attribute_name)
    
    # Try with DEFAULT_REALM just in case
    # test_export(admin_token, DEFAULT_REALM, asset_id, attribute_name)

if __name__ == "__main__":
    main()
