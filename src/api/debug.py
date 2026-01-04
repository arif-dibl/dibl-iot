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
            # Pass query params if any
            res = requests.get(url, headers=headers)
        elif method == "POST":
            res = requests.post(url, json=body, headers=headers)
        elif method == "PUT":
            res = requests.put(url, json=body, headers=headers)
        elif method == "DELETE":
            res = requests.delete(url, headers=headers)
        else:
            return {"status": 400, "data": "Method not supported"}
            
        # Check for binary content
        content_type = res.headers.get("Content-Type", "")
        # Check header OR magic bytes for ZIP (PK\x03\x04)
        is_zip = res.content.startswith(b'PK\x03\x04')
        
        if "application/zip" in content_type or "application/octet-stream" in content_type or is_zip:
            # Return direct Response for binary
            from fastapi.responses import Response
            media_type = content_type if content_type else "application/zip"
            filename = "export.zip"
            
            # Try to extract filename from Content-Disposition
            cd = res.headers.get("Content-Disposition", "")
            if "filename=" in cd:
                try:
                    filename = cd.split("filename=")[1].strip('"')
                except:
                    pass
            
            return Response(content=res.content, media_type=media_type, headers={
                "Content-Disposition": f'attachment; filename="{filename}"'
            })

        try:
            data = res.json()
        except:
            data = res.text
            
        return {"status": res.status_code, "data": data}
    except Exception as e:
        return {"status": 500, "data": str(e)}
