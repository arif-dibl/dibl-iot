import requests
from fastapi import APIRouter, Request
from core.config import OR_MANAGER_URL, KEYCLOAK_URL, DEFAULT_REALM
from core.auth import get_valid_token

router = APIRouter(prefix="/api/user", tags=["user"])

@router.get("/profile")
async def get_user_profile(request: Request):
    realm = request.session.get("realm", DEFAULT_REALM)
    access_token = get_valid_token(request)
    if not access_token:
        return {"error": "Not authenticated"}
    
    try:
        url = f"{OR_MANAGER_URL}/api/{realm}/user/user"
        headers = {"Authorization": f"Bearer {access_token}"}
        res = requests.get(url, headers=headers, verify=False)
        if res.status_code == 200:
            return res.json()
        return {"error": f"Failed to fetch profile: {res.status_code}"}
    except Exception as e:
        print(f"[USER] Profile fetch error: {e}")
        return {"error": str(e)}

@router.put("/profile")
async def update_user_profile(request: Request):
    realm = request.session.get("realm", DEFAULT_REALM)
    access_token = get_valid_token(request)
    if not access_token:
        return {"error": "Not authenticated"}
    
    try:
        body = await request.json()
        url = f"{OR_MANAGER_URL}/api/{realm}/user/update"
        headers = {
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json"
        }
        res = requests.put(url, json=body, headers=headers, verify=False)
        if res.status_code in [200, 204]:
            return {"status": "success"}
        return {"error": f"Update failed: {res.status_code}", "details": res.text}
    except Exception as e:
        print(f"[USER] Profile update error: {e}")
        return {"error": str(e)}

@router.put("/change-password")
async def change_user_password(request: Request):
    realm = request.session.get("realm", DEFAULT_REALM)
    username = request.session.get("username")
    access_token = get_valid_token(request)
    if not access_token or not username:
        return {"error": "Not authenticated"}
    
    try:
        body = await request.json()
        current_password = body.get("currentPassword")
        new_password = body.get("password")
        
        if not current_password or not new_password:
            return {"error": "Current and new password are required"}
        
        token_url = f"{KEYCLOAK_URL}/realms/{realm}/protocol/openid-connect/token"
        verify_data = {
            "grant_type": "password",
            "client_id": "openremote",
            "username": username,
            "password": current_password
        }
        verify_res = requests.post(token_url, data=verify_data, verify=False)
        if verify_res.status_code != 200:
            return {"error": "Current password is incorrect"}
        
        url = f"{OR_MANAGER_URL}/api/{realm}/user/reset-password"
        headers = {
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json"
        }
        res = requests.put(url, json={"password": new_password}, headers=headers, verify=False)
        if res.status_code in [200, 204]:
            return {"status": "success"}
        return {"error": f"Password change failed: {res.status_code}", "details": res.text}
    except Exception as e:
        print(f"[USER] Password change error: {e}")
        return {"error": str(e)}

@router.get("/asset-partners")
async def get_asset_partners(request: Request):
    from core.auth import get_admin_token
    from core.config import IGNORED_USERS_FILE
    import json
    import os
    realm = request.session.get("realm", DEFAULT_REALM)
    user_id = request.session.get("user_id")
    access_token = get_valid_token(request)
    if not user_id or not access_token: return []
    
    try:
        # 1. Get My Assets
        headers = {"Authorization": f"Bearer {access_token}"}
        assets_res = requests.get(f"{OR_MANAGER_URL}/api/{realm}/asset/user/current", headers=headers, verify=False)
        if assets_res.status_code != 200: return []
        my_assets = {a["id"]: a.get("name", "Unknown") for a in assets_res.json()}
        
        if not my_assets: return []

        # 2. Get All Links (Admin)
        admin_token = get_admin_token(realm)
        admin_headers = {"Authorization": f"Bearer {admin_token}"}
        
        # Try fetching all links.
        links_res = requests.get(f"{OR_MANAGER_URL}/api/master/asset/user/link", params={"realm": realm}, headers=admin_headers, verify=False)
        all_links = links_res.json() if links_res.status_code == 200 else []
        
        # 3. Filter relevant links and cache names
        partners_map = {} # asset_id -> set(user_id)
        user_name_cache = {} # user_id -> full name
        
        for link in all_links:
            lid = link.get("id", {})
            l_asset = lid.get("assetId")
            l_user = lid.get("userId")
            l_realm = lid.get("realm")
            
            if l_realm == realm and l_asset in my_assets and l_user != user_id:
                if l_asset not in partners_map: partners_map[l_asset] = set()
                partners_map[l_asset].add(l_user)
                
                # Use name from link if available, fallback to cache or Unknown
                if "userFullName" in link:
                    user_name_cache[l_user] = link["userFullName"]

        if not partners_map: return []
        
        # 4. Resolve User Names (Fallback for missing names)
        # Only lookup if not in cache (though links usually have it)
        all_partner_ids = set()
        for uids in partners_map.values():
            all_partner_ids.update(uids)
            
        for pid in all_partner_ids:
            if pid not in user_name_cache:
                try:
                    u_res = requests.get(f"{OR_MANAGER_URL}/api/{realm}/user/user/{pid}", headers=admin_headers, verify=False)
                    if u_res.status_code == 200:
                        u_data = u_res.json()
                        name = u_data.get("firstName") or u_data.get("username", "Unknown")
                        if u_data.get("lastName"): name += f" {u_data.get('lastName')}"
                        user_name_cache[pid] = name
                    else:
                        user_name_cache[pid] = "Unknown"
                except:
                    user_name_cache[pid] = "Unknown"

        # 5. Build Response
        # Load ignored patterns
        ignored_prefixes = []
        ignored_usernames = []
        if os.path.exists(IGNORED_USERS_FILE):
            try:
                with open(IGNORED_USERS_FILE, 'r') as f:
                    data = json.load(f)
                    ignored_prefixes = data.get("ignored_prefixes", [])
                    ignored_usernames = data.get("ignored_usernames", [])
            except: pass

        result = []
        for aid, user_ids in partners_map.items():
            valid_names = []
            for uid in user_ids:
                name = user_name_cache.get(uid, "Unknown")
                
                # Check Ignore Filters
                is_ignored = False
                if name != "Unknown":
                    # Check exact username match (if name looks like a username)
                    if name in ignored_usernames: is_ignored = True
                    
                    # Check prefixes
                    for prefix in ignored_prefixes:
                        if name.startswith(prefix):
                            is_ignored = True
                            break
                            
                if not is_ignored:
                    valid_names.append(name)
            
            if valid_names:
                result.append({
                    "assetId": aid,
                    "assetName": my_assets[aid],
                    "users": valid_names
                })
            
        return result
        
    except Exception as e:
        print(f"[API] Asset Partners Error: {e}")
        return []
