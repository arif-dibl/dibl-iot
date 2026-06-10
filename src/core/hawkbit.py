"""
HawkBit OTA Integration Module

Provides idempotent functions to sync OpenRemote assets into HawkBit as targets
and target filters (groups). Uses the HawkBit Management REST API v1.

- Asset ID   -> HawkBit Target (controllerId)
- Asset Type -> HawkBit Target Filter (group)
"""

import os
import requests
import logging

logger = logging.getLogger("hawkbit")

# -------------------------
# HAWKBIT CONFIG
# -------------------------
HAWKBIT_URL = os.getenv("HAWKBIT_URL", "http://hawkbit:8080/ota")
HAWKBIT_USER = os.getenv("HAWKBIT_USER", "admin")
HAWKBIT_PASSWORD = os.getenv("HAWKBIT_PASSWORD", "admin")


def _hawkbit_auth():
    """Returns HTTP Basic Auth tuple for HawkBit Management API."""
    return (HAWKBIT_USER, HAWKBIT_PASSWORD)


def _hawkbit_headers():
    """Returns common headers for HawkBit API requests."""
    return {"Content-Type": "application/json", "Accept": "application/json"}


def _get_existing_targets():
    """
    Fetches all existing targets from HawkBit.
    Returns a set of controllerIds for fast lookup.
    """
    try:
        url = f"{HAWKBIT_URL}/rest/v1/targets?limit=500"
        res = requests.get(url, auth=_hawkbit_auth(), headers=_hawkbit_headers(), timeout=10)
        if res.status_code == 200:
            data = res.json()
            targets = data.get("content", [])
            return {t["controllerId"] for t in targets}
        else:
            logger.warning(f"[HAWKBIT] Failed to list targets: {res.status_code} {res.text[:200]}")
    except Exception as e:
        logger.error(f"[HAWKBIT] Error listing targets: {e}")
    return set()


def _get_existing_filters():
    """
    Fetches all existing target filters from HawkBit.
    Returns a dict mapping filter name -> filter id.
    """
    try:
        url = f"{HAWKBIT_URL}/rest/v1/targetfilters?limit=500"
        res = requests.get(url, auth=_hawkbit_auth(), headers=_hawkbit_headers(), timeout=10)
        if res.status_code == 200:
            data = res.json()
            filters = data.get("content", [])
            return {f["name"]: f["id"] for f in filters}
        else:
            logger.warning(f"[HAWKBIT] Failed to list filters: {res.status_code} {res.text[:200]}")
    except Exception as e:
        logger.error(f"[HAWKBIT] Error listing filters: {e}")
    return {}


def _create_target(controller_id, name, description="Auto-provisioned via Custom UI"):
    """
    Creates a single target in HawkBit.
    Returns True on success, False on failure.
    """
    try:
        url = f"{HAWKBIT_URL}/rest/v1/targets"
        payload = [
            {
                "controllerId": controller_id,
                "name": name,
                "description": description
            }
        ]
        res = requests.post(url, json=payload, auth=_hawkbit_auth(), headers=_hawkbit_headers(), timeout=10)
        if res.status_code in [200, 201]:
            logger.info(f"[HAWKBIT] Created target: {controller_id}")
            return True
        else:
            logger.warning(f"[HAWKBIT] Failed to create target {controller_id}: {res.status_code} {res.text[:200]}")
            return False
    except Exception as e:
        logger.error(f"[HAWKBIT] Error creating target {controller_id}: {e}")
        return False


def _create_target_filter(name, query):
    """
    Creates a target filter (group) in HawkBit.
    Returns the filter ID on success, None on failure.
    """
    try:
        url = f"{HAWKBIT_URL}/rest/v1/targetfilters"
        payload = {
            "name": name,
            "query": query
        }
        res = requests.post(url, json=payload, auth=_hawkbit_auth(), headers=_hawkbit_headers(), timeout=10)
        if res.status_code in [200, 201]:
            filter_id = res.json().get("id")
            logger.info(f"[HAWKBIT] Created target filter: {name} (id={filter_id})")
            return filter_id
        else:
            logger.warning(f"[HAWKBIT] Failed to create filter {name}: {res.status_code} {res.text[:200]}")
            return None
    except Exception as e:
        logger.error(f"[HAWKBIT] Error creating filter {name}: {e}")
        return None


def sync_assets_to_hawkbit(assets):
    """
    Main sync function. Takes a list of asset dicts (each with 'id' and 'type')
    and ensures they exist as targets in HawkBit, grouped by asset type.

    This function is idempotent:
    - Existing targets are not recreated.
    - Existing filters are not recreated.

    Args:
        assets: list of dicts, each with at least:
            - "id": str (OpenRemote asset ID -> HawkBit controllerId)
            - "type": str (OpenRemote asset type -> HawkBit target filter/group name)
    """
    if not assets:
        return

    try:
        # Step 1: Fetch current state from HawkBit (batch, not per-asset)
        existing_targets = _get_existing_targets()
        existing_filters = _get_existing_filters()

        # Step 2: Determine what needs to be created
        asset_types_needed = set()
        targets_to_create = []

        for asset in assets:
            asset_id = asset.get("id")
            asset_type = asset.get("type", "UnknownType")

            if not asset_id:
                continue

            # Collect unique asset types for filter creation
            asset_types_needed.add(asset_type)

            # Check if target already exists
            if asset_id not in existing_targets:
                targets_to_create.append({
                    "controllerId": asset_id,
                    "name": f"{asset_type}_{asset_id}",
                    "description": f"Auto-provisioned from OpenRemote ({asset_type})"
                })

        # Step 3: Create missing target filters (groups)
        for asset_type in asset_types_needed:
            if asset_type not in existing_filters:
                # FIQL query: match targets whose name contains the asset type
                query = f"name==*{asset_type}*"
                _create_target_filter(asset_type, query)

        # Step 4: Create missing targets (batch create)
        if targets_to_create:
            try:
                url = f"{HAWKBIT_URL}/rest/v1/targets"
                res = requests.post(
                    url, json=targets_to_create,
                    auth=_hawkbit_auth(), headers=_hawkbit_headers(), timeout=15
                )
                if res.status_code in [200, 201]:
                    logger.info(f"[HAWKBIT] Batch created {len(targets_to_create)} targets")
                else:
                    # Batch failed, fall back to individual creation
                    logger.warning(f"[HAWKBIT] Batch create failed ({res.status_code}), falling back to individual creation")
                    for t in targets_to_create:
                        _create_target(t["controllerId"], t["name"], t["description"])
            except Exception as e:
                logger.error(f"[HAWKBIT] Batch create error: {e}, falling back to individual creation")
                for t in targets_to_create:
                    _create_target(t["controllerId"], t["name"], t["description"])

        total_new = len(targets_to_create)
        total_skipped = len(assets) - total_new
        if total_new > 0:
            logger.info(f"[HAWKBIT] Sync complete: {total_new} new targets, {total_skipped} already existed")

    except Exception as e:
        logger.error(f"[HAWKBIT] Sync error: {e}")
