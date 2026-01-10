
import sys
import os
import requests
import json

# Add src to path
sys.path.append(os.path.join(os.getcwd(), 'src'))

from core.config import OR_MANAGER_URL, DEFAULT_REALM
from core.auth import get_admin_token

def test_links():
    realm = DEFAULT_REALM
    print(f"Testing for Realm: {realm}")
    
    token = get_admin_token(realm)
    if not token:
        print("Failed to get Admin Token")
        return

    headers = {"Authorization": f"Bearer {token}"}
    
    # Test 1: Current Master Endpoint (What code uses)
    url_master = f"{OR_MANAGER_URL}/api/master/asset/user/link"
    try:
        res = requests.get(url_master, headers=headers, verify=False)
        print(f"\n[MASTER] {url_master}")
        print(f"Status: {res.status_code}")
        if res.status_code == 200:
            data = res.json()
            print(f"Count: {len(data)}")
            print(json.dumps(data[:2], indent=2)) # Show first 2
    except Exception as e:
        print(f"Error: {e}")

    # Test 2: Realm Specific Endpoint
    url_realm = f"{OR_MANAGER_URL}/api/{realm}/asset/user/link"
    try:
        res = requests.get(url_realm, headers=headers, verify=False)
        print(f"\n[REALM] {url_realm}")
        print(f"Status: {res.status_code}")
        if res.status_code == 200:
            data = res.json()
            print(f"Count: {len(data)}")
            print(json.dumps(data[:2], indent=2)) # Show first 2
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    test_links()
