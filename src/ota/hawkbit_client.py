import requests
import logging
from src.core.config import HAWKBIT_URL, HAWKBIT_USER, HAWKBIT_PASSWORD

logger = logging.getLogger(__name__)

def sync_asset_to_hawkbit(asset_id: str, asset_type: str):
    """
    Synchronizes an OpenRemote asset to HawkBit.
    Creates a target filter (group) based on asset_type if it doesn't exist.
    Creates a target based on asset_id if it doesn't exist.
    """
    if not asset_id or not asset_type:
        logger.warning("HawkBit Sync: Missing asset_id or asset_type. Skipping.")
        return

    logger.info(f"HawkBit Sync: Checking/Creating for asset_id={asset_id}, asset_type={asset_type}")
    
    auth = (HAWKBIT_USER, HAWKBIT_PASSWORD)
    
    # 1. Check and Create Target Filter (Group)
    _check_or_create_target_filter(asset_type, auth)
    
    # 2. Check and Create Target
    _check_or_create_target(asset_id, asset_type, auth)

def _check_or_create_target_filter(asset_type: str, auth: tuple):
    filter_url = f"{HAWKBIT_URL}/rest/v1/targetfilters"
    try:
        # We can just try to create it directly, Hawkbit might just fail with 409 Conflict if it exists,
        # but the safer way is to check first or handle the conflict.
        # Let's list the targetfilters to see if one matches the query.
        res = requests.get(filter_url, auth=auth, timeout=10)
        
        if res.status_code == 200:
            data = res.json()
            filters = data.get("content", [])
            # Search if filter by this name already exists
            for f in filters:
                if f.get("name") == asset_type:
                    logger.info(f"HawkBit Sync: Target filter '{asset_type}' already exists.")
                    return

        # Create filter if not found
        # In HawkBit, a target filter query could be simply based on a tag or attribute we assign to the target.
        # We will query based on the 'tags' or 'name' or any custom metadata.
        # For simplicity, let's query on tags
        query = f"tag=='{asset_type}'"
        payload = [{
            "name": asset_type,
            "query": query
        }]
        
        post_res = requests.post(filter_url, json=payload, auth=auth, timeout=10)
        if post_res.status_code in [201, 200]:
            logger.info(f"HawkBit Sync: Created target filter '{asset_type}'.")
        elif post_res.status_code == 409:
            logger.info(f"HawkBit Sync: Target filter '{asset_type}' already exists (409 Conflict).")
        else:
            logger.error(f"HawkBit Sync: Failed to create target filter '{asset_type}': {post_res.status_code} {post_res.text}")

    except Exception as e:
        logger.error(f"HawkBit Sync: Exception in target filter creation: {e}")

def _check_or_create_target(asset_id: str, asset_type: str, auth: tuple):
    target_url = f"{HAWKBIT_URL}/rest/v1/targets/{asset_id}"
    try:
        res = requests.get(target_url, auth=auth, timeout=10)
        if res.status_code == 200:
            logger.info(f"HawkBit Sync: Target '{asset_id}' already exists.")
            return
        elif res.status_code == 404:
            # Create target
            create_url = f"{HAWKBIT_URL}/rest/v1/targets"
            payload = [{
                "controllerId": asset_id,
                "name": f"Device {asset_id}",
                "description": f"Auto-provisioned {asset_type}",
                # The filter we created searches for this tag. So we must add it here!
                # Note: creating a target and tags might be separate API calls in Hawkbit or combined in some versions.
                # In standard API, target creation just takes controllerId, name, description. 
                # We can add a tag later or just assume this payload format.
                "tags": [asset_type]
            }]
            
            post_res = requests.post(create_url, json=payload, auth=auth, timeout=10)
            if post_res.status_code in [201, 200]:
                logger.info(f"HawkBit Sync: Created target '{asset_id}'.")
                
                # To be absolutely sure the tag is applied for our filter query:
                # PUT /rest/v1/targets/{asset_id}/tags
                tags_url = f"{HAWKBIT_URL}/rest/v1/targets/{asset_id}/tags"
                requests.post(tags_url, json=[{"name": asset_type}], auth=auth, timeout=10)
            else:
                logger.error(f"HawkBit Sync: Failed to create target '{asset_id}': {post_res.status_code} {post_res.text}")
        else:
            logger.warning(f"HawkBit Sync: Unexpected response checking target '{asset_id}': {res.status_code} {res.text}")

    except Exception as e:
        logger.error(f"HawkBit Sync: Exception in target creation: {e}")
