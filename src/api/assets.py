import requests
import json
import base64
import threading
import time
from fastapi import APIRouter, Request
from core.config import OR_MANAGER_URL, DEFAULT_REALM
from core.auth import get_valid_token, get_admin_token
from core.utils import load_preferences, save_preferences
from core.hawkbit import sync_assets_to_hawkbit

router = APIRouter(prefix="/api", tags=["assets"])

@router.get("/user/preferences")
async def get_preferences(username: str, request: Request):
    user_id = request.session.get("user_id")
    if not user_id: return {}
    prefs = load_preferences()
    return prefs.get(user_id, {})

@router.get("/friendly-names")
async def get_friendly_names_api(username: str):
    try:
        from core.config import FRIENDLY_NAMES_FILE
        import os
        if os.path.exists(FRIENDLY_NAMES_FILE):
            with open(FRIENDLY_NAMES_FILE, "r") as f:
                return json.load(f)
    except Exception as e:
        print(f"[API] Error loading friendly names: {e}")
    return {"attributes": {}, "keys": {}}

@router.post("/user/preferences/pin")
async def pin_attribute(username: str, request: Request, payload: dict):
    user_id = request.session.get("user_id")
    if not user_id: return {"status": "error", "message": "Not logged in"}
    
    asset_id = payload.get("assetId")
    attr_name = payload.get("attributeName")
    key = payload.get("key")
    display_name = payload.get("displayName")
    
    if not asset_id or not attr_name: return {"status": "error"}
    
    prefs = load_preferences()
    if user_id not in prefs: prefs[user_id] = {"pinned": []}
    if "pinned" not in prefs[user_id]: prefs[user_id]["pinned"] = []
    
    exists = False
    for item in prefs[user_id]["pinned"]:
        if item["assetId"] == asset_id and item["attributeName"] == attr_name:
            if item.get("key") == key:
                exists = True
                prefs[user_id]["pinned"].remove(item)
                break
    
    if not exists:
        new_pin = {"assetId": asset_id, "attributeName": attr_name}
        if key: new_pin["key"] = key
        if display_name: new_pin["displayName"] = display_name
        prefs[user_id]["pinned"].append(new_pin)
        
    save_preferences(prefs)
    return {"status": "success", "pinned": not exists}

@router.post("/user/preferences/pin/rename")
async def rename_pin(username: str, request: Request, payload: dict):
    user_id = request.session.get("user_id")
    if not user_id: return {"status": "error", "message": "Not logged in"}
    
    asset_id = payload.get("assetId")
    attr_name = payload.get("attributeName")
    key = payload.get("key")
    display_name = payload.get("displayName", "")
    
    if not asset_id or not attr_name: return {"status": "error"}
    
    prefs = load_preferences()
    if user_id not in prefs or "pinned" not in prefs[user_id]:
        return {"status": "error", "message": "No pins found"}
    
    for item in prefs[user_id]["pinned"]:
        if item["assetId"] == asset_id and item["attributeName"] == attr_name and item.get("key") == key:
            if display_name.strip():
                item["displayName"] = display_name.strip()
            elif "displayName" in item:
                del item["displayName"]
            save_preferences(prefs)
            return {"status": "success"}
    return {"status": "error", "message": "Pin not found"}

@router.get("/user/dashboard/widgets")
async def get_dashboard_widgets(username: str, request: Request):
    realm = request.session.get("realm", DEFAULT_REALM)
    user_id = request.session.get("user_id")
    access_token = get_valid_token(request)
    if not user_id or not access_token: return []
    
    prefs = load_preferences()
    user_prefs = prefs.get(user_id, {})
    pinned = user_prefs.get("pinned", [])
    if not pinned: return []
    
    headers = {"Authorization": f"Bearer {access_token}"}
    widgets = []
    try:
        # Get the list of assets actually linked to this user
        linked_assets_url = f"{OR_MANAGER_URL}/api/{realm}/asset/user/current"
        linked_res = requests.get(linked_assets_url, headers=headers)
        linked_asset_ids = set()
        if linked_res.status_code == 200:
            linked_assets = linked_res.json()
            linked_asset_ids = set(a["id"] for a in linked_assets)
        
        # Filter pinned items to only include assets that are linked to user
        valid_pinned = [p for p in pinned if p["assetId"] in linked_asset_ids]
        
        # Clean up orphaned pins
        if len(valid_pinned) < len(pinned):
            prefs[user_id]["pinned"] = valid_pinned
            save_preferences(prefs)
            pinned = valid_pinned
        
        if not pinned: return []
        
        unique_asset_ids = list(set([p["assetId"] for p in pinned]))
        assets_cache = {}
        for aid in unique_asset_ids:
            res = requests.get(f"{OR_MANAGER_URL}/api/{realm}/asset/{aid}", headers=headers)
            if res.status_code == 200:
                assets_cache[aid] = res.json()
        
        for p in pinned:
            aid = p["assetId"]
            aname = p["attributeName"]
            if aid in assets_cache:
                asset = assets_cache[aid]
                val = "N/A"
                if "attributes" in asset and aname in asset["attributes"]:
                    attr_obj = asset["attributes"][aname]
                    raw_val = attr_obj.get("value", "N/A")
                    target_key = p.get("key")
                    val = raw_val.get(target_key, "N/A") if target_key and isinstance(raw_val, dict) else raw_val
                
                widgets.append({
                    "assetId": aid,
                    "assetName": asset.get("name", "Unknown"),
                    "attributeName": aname,
                    "key": p.get("key"),
                    "displayName": p.get("displayName"),
                    "value": val
                })
    except Exception as e:
        print(f"[WIDGETS] Error: {e}")
    return widgets

@router.get("/user/assets")
async def get_user_assets(username: str, request: Request):
    realm = request.session.get("realm", DEFAULT_REALM)
    access_token = get_valid_token(request)
    if not access_token: return []

    headers = {"Authorization": f"Bearer {access_token}", "Content-Type": "application/json"}
    try:
        user_uuid = None
        parts = access_token.split(".")
        if len(parts) > 1:
            payload_b64 = parts[1]
            payload_b64 += "=" * ((4 - len(payload_b64) % 4) % 4)
            payload_json = base64.urlsafe_b64decode(payload_b64).decode()
            user_uuid = json.loads(payload_json).get("sub")

        if not user_uuid: return {"assets": [], "error": "Could not extract User ID"}

        url = f"{OR_MANAGER_URL}/api/{realm}/asset/user/current"
        res = requests.get(url, headers=headers)
        if res.status_code != 200: return {"assets": [], "error": f"Error: {res.status_code}"}
            
        all_assets = res.json()
        final_assets = []
        for a in all_assets:
            flat_attrs = {}
            last_activity_ts = None
            if "attributes" in a:
                for k, v in a["attributes"].items():
                    if isinstance(v, dict) and "value" in v:
                        val = v["value"]
                        ts = v.get("timestamp")
                        
                        # Inject timestamp for Timers only
                        if k.startswith("Timer"):
                            if isinstance(val, str):
                                try:
                                    parsed = json.loads(val)
                                    if isinstance(parsed, dict):
                                        val = parsed
                                except:
                                    pass
                            
                            if isinstance(val, dict) and ts:
                                val["_timestamp"] = ts

                        flat_attrs[k] = val
                        
                        # Activity Detection: use the latest timestamp from EnvData or SystemData
                        # AND ensure it's not just placeholder data (all '--')
                        if ts and k in ("EnvData", "SystemData"):
                            has_real_data = False
                            if isinstance(val, dict):
                                for sub_val in val.values():
                                    if sub_val not in [None, "", "--"]:
                                        has_real_data = True
                                        break
                            elif val not in [None, "", "--"]:
                                has_real_data = True

                            if has_real_data:
                                if last_activity_ts is None or ts > last_activity_ts:
                                    last_activity_ts = ts
                    else:
                        flat_attrs[k] = v
            
            loc = None
            if "location" in flat_attrs and isinstance(flat_attrs["location"], dict):
                 coords = flat_attrs["location"].get("coordinates")
                 if coords: loc = [coords[1], coords[0]]
            
            final_assets.append({
                "id": a["id"],
                "name": a.get("name", "Unnamed"),
                "type": a.get("type", "Asset"),
                "attributes": flat_attrs,
                "location": loc,
                "lastActivityTimestamp": last_activity_ts
            })
        # Sync assets to HawkBit OTA in background (non-blocking)
        if final_assets:
            threading.Thread(
                target=sync_assets_to_hawkbit,
                args=(final_assets,),
                daemon=True
            ).start()

        return {"assets": final_assets}
    except Exception as e:
        print(f"[API] Error: {e}")
        return {"assets": [], "error": str(e)}

@router.get("/asset/{id}")
async def get_single_asset(username: str, request: Request, id: str):
    realm = request.session.get("realm", DEFAULT_REALM)
    access_token = get_valid_token(request)
    if not access_token: return {}
    headers = {"Authorization": f"Bearer {access_token}"}
    url = f"{OR_MANAGER_URL}/api/{realm}/asset/{id}"
    res = requests.get(url, headers=headers)
    if res.status_code == 200:
        a = res.json()
        flat_attrs = {}
        last_activity_ts = None
        if "attributes" in a:
            for k, v in a["attributes"].items():
                if isinstance(v, dict) and "value" in v:
                    val = v["value"]
                    ts = v.get("timestamp")

                    # Inject timestamp for Timers only
                    if k.startswith("Timer"):
                        if isinstance(val, str):
                            try:
                                parsed = json.loads(val)
                                if isinstance(parsed, dict):
                                    val = parsed
                            except:
                                pass
                        
                        if isinstance(val, dict) and ts:
                            val["_timestamp"] = ts

                    flat_attrs[k] = val

                    # Activity Detection: use the latest timestamp from EnvData or SystemData
                    # AND ensure it's not just placeholder data (all '--')
                    if ts and k in ("EnvData", "SystemData"):
                        has_real_data = False
                        if isinstance(val, dict):
                            for sub_val in val.values():
                                if sub_val not in [None, "", "--"]:
                                    has_real_data = True
                                    break
                        elif val not in [None, "", "--"]:
                            has_real_data = True

                        if has_real_data:
                            if last_activity_ts is None or ts > last_activity_ts:
                                last_activity_ts = ts
                else:
                    flat_attrs[k] = v
        return {
            "id": a["id"],
            "name": a.get("name", "Unnamed"),
            "type": a.get("type", "Asset"),
            "attributes": flat_attrs,
            "lastActivityTimestamp": last_activity_ts
        }
    return {}

@router.post("/asset/{asset_id}/attribute/{attr_name}")
async def update_asset_attribute_api(username: str, request: Request, asset_id: str, attr_name: str, payload: dict):
    realm = request.session.get("realm", DEFAULT_REALM)
    access_token = get_valid_token(request)
    if not access_token: return {"status": "error", "message": "Not authenticated"}
    
    value = payload.get("value")
    headers = {"Authorization": f"Bearer {access_token}", "Content-Type": "application/json"}
    url = f"{OR_MANAGER_URL}/api/{realm}/asset/{asset_id}/attribute/{attr_name}"
    try:
        res = requests.put(url, json=value, headers=headers, verify=False)
        return {"status": "success"} if res.status_code in [200, 204] else {"status": "error", "message": res.text}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@router.post("/user/assets")
async def link_user_asset_api(username: str, request: Request, payload: dict):
    realm = request.session.get("realm", DEFAULT_REALM)
    user_id = request.session.get("user_id")
    asset_id = payload.get("assetId")
    if not user_id or not asset_id: return {"status": "error", "message": "Missing data"}
    
    admin_token = get_admin_token(realm)
    link_url = f"{OR_MANAGER_URL}/api/master/asset/user/link"
    headers = {"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"}
    body = [{"id": {"realm": realm, "userId": user_id, "assetId": asset_id}}]
    try:
        res = requests.post(link_url, json=body, headers=headers)
        if res.status_code in [200, 204]:
            # Sync newly linked asset to HawkBit in background
            # Use admin_token (already fetched above) since Request is not thread-safe
            _admin_token = admin_token
            _realm = realm
            _asset_id = asset_id
            def _sync_linked_asset():
                try:
                    asset_headers = {"Authorization": f"Bearer {_admin_token}"}
                    asset_res = requests.get(
                        f"{OR_MANAGER_URL}/api/{_realm}/asset/{_asset_id}",
                        headers=asset_headers
                    )
                    if asset_res.status_code == 200:
                        a = asset_res.json()
                        sync_assets_to_hawkbit([{
                            "id": a["id"],
                            "type": a.get("type", "Asset")
                        }])
                except Exception as e:
                    print(f"[HAWKBIT] Link sync error: {e}")
            threading.Thread(target=_sync_linked_asset, daemon=True).start()
            return {"status": "success"}
        return {"status": "error", "message": f"OR API Error: {res.status_code}"}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@router.put("/user/assets/{asset_id}")
async def update_user_asset_api(username: str, request: Request, asset_id: str, payload: dict):
    realm = request.session.get("realm", DEFAULT_REALM)
    access_token = get_valid_token(request)
    if not access_token: return {"status": "error", "message": "Unauthorized"}
    headers = {"Authorization": f"Bearer {access_token}", "Content-Type": "application/json"}
    try:
        get_res = requests.get(f"{OR_MANAGER_URL}/api/{realm}/asset/{asset_id}", headers=headers)
        if get_res.status_code != 200: return {"status": "error", "message": "Fetch failed"}
        asset_data = get_res.json()
        if payload.get("name"): asset_data["name"] = payload.get("name")
        put_res = requests.put(f"{OR_MANAGER_URL}/api/{realm}/asset/{asset_id}", json=asset_data, headers=headers, verify=False)
        return {"status": "success"} if put_res.status_code in [200, 204] else {"status": "error", "message": "Update failed"}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@router.delete("/user/assets/{asset_id}")
async def unlink_user_asset_api(username: str, request: Request, asset_id: str):
    realm = request.session.get("realm", DEFAULT_REALM)
    user_id = request.session.get("user_id")
    if not user_id or not asset_id: return {"status": "error"}
    admin_token = get_admin_token(realm)
    headers = {"Authorization": f"Bearer {admin_token}"}
    url = f"{OR_MANAGER_URL}/api/master/asset/user/link/{realm}/{user_id}/{asset_id}"
    try:
        res = requests.delete(url, headers=headers)
        
        # Cleanup local preferences
        prefs = load_preferences()
        if user_id in prefs and "pinned" in prefs[user_id]:
            original_count = len(prefs[user_id]["pinned"])
            prefs[user_id]["pinned"] = [p for p in prefs[user_id]["pinned"] if p.get("assetId") != asset_id]
            if len(prefs[user_id]["pinned"]) < original_count:
                save_preferences(prefs)
                
        return {"status": "success"} if res.status_code in [200, 204] else {"status": "error", "message": f"OR API Error: {res.status_code}"}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@router.post("/user/provision-device")
async def provision_device(username: str, request: Request, payload: dict):
    """
    Provision a new IoT device via BLE setup.
    Creates the asset in OpenRemote and links it to the user.
    """
    realm = request.session.get("realm", DEFAULT_REALM)
    user_id = request.session.get("user_id")
    access_token = get_valid_token(request)
    if not user_id or not access_token:
        return {"status": "error", "message": "Not authenticated"}

    device_name = payload.get("name", "DIBL Device")
    device_type = payload.get("type", "sens")
    device_id = payload.get("id", "")
    wifi_ssid = payload.get("wifi_ssid", "")
    wifi_password = payload.get("wifi_password", "")

    if not device_id:
        return {"status": "error", "message": "Missing device ID"}

    try:
        # 1. Create asset in OpenRemote using the admin token
        admin_token = get_admin_token(realm)
        if not admin_token:
            return {"status": "error", "message": "Could not get admin token"}

        headers = {
            "Authorization": f"Bearer {admin_token}",
            "Content-Type": "application/json"
        }

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

        # Build initial attributes for the new asset
        attributes = {
            "EnvData": {},
            "RelayData": {},
            "SystemData": {
                "firmware": payload.get("firmware", "1.0.0"),
                "bleId": device_id,
                "provisionedVia": "ble",
                "provisionedAt": int(time.time() * 1000)
            }
        }

        if wifi_ssid:
            attributes["SystemData"]["wifiSsid"] = wifi_ssid

        asset_data = {
            "name": device_name,
            "type": or_asset_type,
            "attributes": attributes
        }

        # 2. Create the asset via OpenRemote Manager API
        create_url = f"{OR_MANAGER_URL}/api/{realm}/asset"
        create_res = requests.post(create_url, json=asset_data, headers=headers, verify=False)
        if create_res.status_code not in [200, 201]:
            return {"status": "error", "message": f"Failed to create asset: {create_res.status_code} {create_res.text}"}

        created_asset = create_res.json()
        asset_id = created_asset.get("id")

        if not asset_id:
            return {"status": "error", "message": "Asset created but no ID returned"}

        # 3. Link the asset to the user
        link_url = f"{OR_MANAGER_URL}/api/master/asset/user/link"
        link_body = [{"id": {"realm": realm, "userId": user_id, "assetId": asset_id}}]
        link_res = requests.post(link_url, json=link_body, headers=headers, verify=False)
        if link_res.status_code not in [200, 204]:
            # Asset created but linking failed — still return success so user can link manually
            print(f"[PROVISION] Asset {asset_id} created but link failed: {link_res.status_code}")

        # 4. Sync to HawkBit in background
        try:
            from core.hawkbit import sync_assets_to_hawkbit
            import threading
            threading.Thread(
                target=sync_assets_to_hawkbit,
                args=([{"id": asset_id, "type": or_asset_type}],),
                daemon=True
            ).start()
        except Exception as e:
            print(f"[PROVISION] HawkBit sync error: {e}")

        return {
            "status": "success",
            "assetId": asset_id,
            "name": device_name,
            "message": f"Device '{device_name}' provisioned and linked successfully"
        }

    except Exception as e:
        print(f"[PROVISION] Error: {e}")
        return {"status": "error", "message": str(e)}
