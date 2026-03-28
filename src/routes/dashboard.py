from fastapi import APIRouter, Request, Depends
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates
from core.config import DEFAULT_REALM, OR_HOSTNAME, APP_PREFIX
from core.auth import get_valid_token, auth_test_api

router = APIRouter(tags=["pages"])
templates = Jinja2Templates(directory="templates")

def get_prefixed_path(path: str) -> str:
    """Get path with APP_PREFIX prepended"""
    return f"{APP_PREFIX}{path}" if APP_PREFIX else path

@router.get("/dashboard", response_class=HTMLResponse)
async def dashboard_page(request: Request, username: str):
    realm = request.session.get("realm", DEFAULT_REALM)
    return templates.TemplateResponse("dashboard.html", {"request": request, "realm": realm, "page": "dashboard", "prefix": APP_PREFIX, "username": username})

@router.get("/assets", response_class=HTMLResponse)
async def assets_page(request: Request, username: str):
    realm = request.session.get("realm", DEFAULT_REALM)
    return templates.TemplateResponse("assets.html", {"request": request, "realm": realm, "page": "assets", "prefix": APP_PREFIX, "username": username})

@router.get("/asset/{asset_name}", response_class=HTMLResponse)
async def asset_detail_page(request: Request, username: str, asset_name: str):
    realm = request.session.get("realm", DEFAULT_REALM)
    
    # Resolve Name to ID
    import requests
    import urllib.parse
    from core.config import OR_MANAGER_URL
    
    access_token = get_valid_token(request)
    headers = {"Authorization": f"Bearer {access_token}"}
    decoded_name = urllib.parse.unquote(asset_name)
    
    asset_id = None
    try:
        url = f"{OR_MANAGER_URL}/api/{realm}/asset/user/current"
        res = requests.get(url, headers=headers)
        if res.status_code == 200:
            assets = res.json()
            for a in assets:
                name = a.get("name", "")
                # Try exact match or hyphenated match
                if name == decoded_name or name.replace(" ", "-") == decoded_name:
                    asset_id = a["id"]
                    decoded_name = name # Use the original name for display
                    break
            
            # If not found by name, check if asset_name is actually an ID
            if not asset_id:
                for a in assets:
                    if a.get("id") == asset_name:
                        asset_id = a["id"]
                        decoded_name = a.get("name", "Unnamed")
                        break
    except Exception as e:
        print(f"[Dashboard] Error resolving asset name: {e}")

    return templates.TemplateResponse("asset_detail.html", {
        "request": request, 
        "realm": realm, 
        "asset_id": asset_id, 
        "asset_name": decoded_name,
        "page": "assets", 
        "prefix": APP_PREFIX, 
        "username": username
    })

@router.get("/rules", response_class=HTMLResponse)
async def rules_page(request: Request, username: str):
    realm = request.session.get("realm", DEFAULT_REALM)
    return templates.TemplateResponse("rules.html", {"request": request, "realm": realm, "page": "rules", "prefix": APP_PREFIX, "username": username})

@router.get("/timers", response_class=HTMLResponse)
async def timers_page(request: Request, username: str):
    realm = request.session.get("realm", DEFAULT_REALM)
    return templates.TemplateResponse("timers.html", {"request": request, "realm": realm, "page": "timers", "prefix": APP_PREFIX, "username": username})

@router.get("/settings", response_class=HTMLResponse)
async def user_page(request: Request, username: str):
    realm = request.session.get("realm", DEFAULT_REALM)
    return templates.TemplateResponse("user.html", {"request": request, "realm": realm, "page": "settings", "prefix": APP_PREFIX, "username": username})

@router.get("/link", response_class=HTMLResponse)
async def link_asset_page(request: Request, username: str):
    realm = request.session.get("realm", DEFAULT_REALM)
    return templates.TemplateResponse("link_asset.html", {"request": request, "realm": realm, "page": "assets", "prefix": APP_PREFIX, "username": username})

@router.get("/test", response_class=HTMLResponse)
async def test_page(request: Request, username: str, _=Depends(auth_test_api)):
    realm = request.session.get("realm", DEFAULT_REALM)
    return templates.TemplateResponse("test_api.html", {"request": request, "realm": realm, "host": OR_HOSTNAME, "page": "test", "prefix": APP_PREFIX, "username": username})

@router.get("/history-logs", response_class=HTMLResponse)
async def history_logs_page(request: Request, username: str):
    realm = request.session.get("realm", DEFAULT_REALM)
    return templates.TemplateResponse("datapoint_history.html", {"request": request, "realm": realm, "page": "history_logs", "prefix": APP_PREFIX, "username": username})
