import requests
from fastapi import APIRouter, Request
from core.config import OR_MANAGER_URL, DEFAULT_REALM, OR_HOSTNAME
from core.auth import get_valid_token

router = APIRouter(prefix="/api/debug", tags=["debug"])

@router.post("/proxy")
async def debug_proxy(request: Request, payload: dict):
    realm = request.session.get("realm", DEFAULT_REALM)
    access_token = get_valid_token(request)
    
    if not access_token:
        return {"status": 401, "data": "No access token found in session"}
        
    endpoint = payload.get("endpoint", "")
    method = payload.get("method", "GET").upper()
    body = payload.get("body")
    
    if not endpoint.startswith("/"): endpoint = "/" + endpoint
    url = f"{OR_MANAGER_URL}{endpoint}"
    
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json",
        "Host": OR_HOSTNAME
    }
    
    try:
        if method == "GET":
            res = requests.get(url, headers=headers)
        elif method == "POST":
            res = requests.post(url, json=body, headers=headers)
        elif method == "PUT":
            res = requests.put(url, json=body, headers=headers)
        elif method == "DELETE":
            res = requests.delete(url, headers=headers)
        else:
            return {"status": 400, "data": "Method not supported"}
            
        try:
            data = res.json()
        except:
            data = res.text
            
        return {"status": res.status_code, "data": data}
    except Exception as e:
        return {"status": 500, "data": str(e)}
