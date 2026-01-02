import requests
from fastapi import APIRouter, Request
from core.config import OR_MANAGER_URL, DEFAULT_REALM
from core.auth import get_valid_token, get_admin_token

router = APIRouter(prefix="/api/user/rules", tags=["rules"])

@router.get("")
async def get_user_rules(request: Request):
    realm = request.session.get("realm", DEFAULT_REALM)
    user_id = request.session.get("user_id")
    if not user_id: return []
    
    admin_token = get_admin_token(realm)
    headers = {"Authorization": f"Bearer {admin_token}"}
    
    try:
        url = f"{OR_MANAGER_URL}/api/{realm}/rules"
        res = requests.get(url, headers=headers)
        if res.status_code == 200:
            all_rules = res.json()
            prefix = f"u:{user_id}:"
            my_rules = []
            for r in all_rules:
                if r["name"].startswith(prefix):
                    my_rules.append({
                        "id": r["id"],
                        "name": r["name"].replace(prefix, ""),
                        "desc": r.get("description", "User Rule"),
                        "active": r.get("status") == "ACTIVE"
                    })
            return my_rules
    except:
        pass
    return []

@router.post("")
async def create_rule(request: Request, rule: dict):
    realm = request.session.get("realm", DEFAULT_REALM)
    user_id = request.session.get("user_id")
    if not user_id: return {"error": "Not logged in"}

    admin_token = get_admin_token(realm)
    headers = {"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"}
    
    clean_name = rule.get("name", "Rule")
    full_name = f"u:{user_id}:{clean_name}"
    
    or_rule = {
        "name": full_name,
        "description": "Custom User Rule",
        "status": "ACTIVE",
        "content": f"""
package rules
import org.openremote.model.asset.*
import org.openremote.model.rules.*

rule "{full_name}"
when
    Icon(assets: assets)
then
    System.out.println("User Rule Triggered");
end
""" 
    }
    
    try:
        url = f"{OR_MANAGER_URL}/api/{realm}/rules"
        res = requests.post(url, json=or_rule, headers=headers)
        if res.status_code in [200, 201]:
            return {"status": "success"}
    except:
        pass
    return {"status": "error"}

@router.delete("/{id}")
async def delete_rule(request: Request, id: str):
    realm = request.session.get("realm", DEFAULT_REALM)
    admin_token = get_admin_token(realm)
    if not admin_token: return {"status": "error", "message": "Admin token failed"}
    headers = {"Authorization": f"Bearer {admin_token}"}
    try:
        url = f"{OR_MANAGER_URL}/api/{realm}/rules/{id}"
        res = requests.delete(url, headers=headers)
        return {"status": "success"} if res.status_code in [200, 204] else {"status": "error"}
    except:
        return {"status": "error"}
