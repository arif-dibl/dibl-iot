from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates
from core.config import DEFAULT_REALM, OR_HOSTNAME, APP_PREFIX
from core.auth import get_valid_token

router = APIRouter(tags=["pages"])
templates = Jinja2Templates(directory="templates")

# Helper to get redirect URL with prefix
def get_redirect_url(path: str) -> str:
    return f"{APP_PREFIX}{path}"

@router.get("/dashboard", response_class=HTMLResponse)
async def dashboard_page(request: Request):
    if not get_valid_token(request): return RedirectResponse(get_redirect_url("/"), status_code=303)
    realm = request.session.get("realm", DEFAULT_REALM)
    return templates.TemplateResponse("dashboard.html", {"request": request, "realm": realm, "page": "dashboard", "prefix": APP_PREFIX})

@router.get("/assets", response_class=HTMLResponse)
async def assets_page(request: Request):
    if not get_valid_token(request): return RedirectResponse(get_redirect_url("/"), status_code=303)
    realm = request.session.get("realm", DEFAULT_REALM)
    return templates.TemplateResponse("assets.html", {"request": request, "realm": realm, "page": "assets", "prefix": APP_PREFIX})

@router.get("/asset/{asset_id}", response_class=HTMLResponse)
async def asset_detail_page(request: Request, asset_id: str):
    if not get_valid_token(request): return RedirectResponse(get_redirect_url("/"), status_code=303)
    realm = request.session.get("realm", DEFAULT_REALM)
    return templates.TemplateResponse("asset_detail.html", {"request": request, "realm": realm, "asset_id": asset_id, "page": "assets", "prefix": APP_PREFIX})

@router.get("/rules", response_class=HTMLResponse)
async def rules_page(request: Request):
    if not get_valid_token(request): return RedirectResponse(get_redirect_url("/"), status_code=303)
    realm = request.session.get("realm", DEFAULT_REALM)
    return templates.TemplateResponse("rules.html", {"request": request, "realm": realm, "page": "rules", "prefix": APP_PREFIX})

@router.get("/timers", response_class=HTMLResponse)
async def timers_page(request: Request):
    if not get_valid_token(request): return RedirectResponse(get_redirect_url("/"), status_code=303)
    realm = request.session.get("realm", DEFAULT_REALM)
    return templates.TemplateResponse("timers.html", {"request": request, "realm": realm, "page": "timers", "prefix": APP_PREFIX})

@router.get("/settings", response_class=HTMLResponse)
async def user_page(request: Request):
    if not get_valid_token(request): return RedirectResponse(get_redirect_url("/"), status_code=303)
    realm = request.session.get("realm", DEFAULT_REALM)
    return templates.TemplateResponse("user.html", {"request": request, "realm": realm, "page": "settings", "prefix": APP_PREFIX})

@router.get("/link", response_class=HTMLResponse)
async def link_asset_page(request: Request):
    if not get_valid_token(request): return RedirectResponse(get_redirect_url("/"), status_code=303)
    realm = request.session.get("realm", DEFAULT_REALM)
    return templates.TemplateResponse("link_asset.html", {"request": request, "realm": realm, "page": "assets", "prefix": APP_PREFIX})

@router.get("/test", response_class=HTMLResponse)
async def test_page(request: Request):
    if not get_valid_token(request): return RedirectResponse(get_redirect_url("/"), status_code=303)
    realm = request.session.get("realm", DEFAULT_REALM)
    return templates.TemplateResponse("test_api.html", {"request": request, "realm": realm, "host": OR_HOSTNAME, "page": "test", "prefix": APP_PREFIX})

@router.get("/history-logs", response_class=HTMLResponse)
async def history_logs_page(request: Request):
    if not get_valid_token(request): return RedirectResponse(get_redirect_url("/"), status_code=303)
    realm = request.session.get("realm", DEFAULT_REALM)
    return templates.TemplateResponse("datapoint_history.html", {"request": request, "realm": realm, "page": "history_logs", "prefix": APP_PREFIX})
