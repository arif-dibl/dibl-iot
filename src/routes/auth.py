import requests
from fastapi import APIRouter, Request, Form
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates
from core.config import DEFAULT_REALM, KEYCLOAK_URL, OR_HOSTNAME, OR_ADMIN_PASSWORD, APP_PREFIX
from core.auth import get_admin_token, assign_roles_to_user, perform_auto_login_logic

router = APIRouter(tags=["auth"])
templates = Jinja2Templates(directory="templates")

# Helper to get redirect URL with prefix
def get_redirect_url(path: str) -> str:
    return f"{APP_PREFIX}{path}"

@router.get("/", response_class=HTMLResponse)
async def index_page(request: Request):
    if request.session.get("access_token") and request.session.get("username"):
        return RedirectResponse(get_redirect_url("/dashboard"))
    return templates.TemplateResponse("login.html", {"request": request, "prefix": APP_PREFIX})

@router.get("/login", response_class=HTMLResponse)
async def login_get(request: Request):
    return RedirectResponse(get_redirect_url("/"))

@router.post("/login", response_class=HTMLResponse)
async def login_post(request: Request, username: str = Form(...), password: str = Form(...)):
    success, result = perform_auto_login_logic(request, DEFAULT_REALM, username, password)
    if success:
        return RedirectResponse(get_redirect_url("/dashboard"), status_code=303)
    return templates.TemplateResponse("login.html", {"request": request, "error": result, "prefix": APP_PREFIX})

@router.get("/signup", response_class=HTMLResponse)
async def signup_get(request: Request):
    return templates.TemplateResponse("signup.html", {"request": request, "prefix": APP_PREFIX})

@router.post("/signup", response_class=HTMLResponse)
async def signup_post(request: Request, username: str = Form(...), email: str = Form(...), password: str = Form(...), terms: str = Form(...)):
    realm = DEFAULT_REALM
    
    # Log Terms and Conditions acceptance
    if terms == "on":
        print(f"User {username} accepted Terms and Conditions")
        
    admin_token = get_admin_token(realm)
    if not admin_token:
        return templates.TemplateResponse("signup.html", {"request": request, "error": "Could not connect to auth server", "prefix": APP_PREFIX})

    user_data = {
        "username": username,
        "email": email,
        "enabled": True,
        "credentials": [{"type": "password", "value": password, "temporary": False}]
    }
    
    headers = {"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"}
    create_url = f"{KEYCLOAK_URL}/admin/realms/{realm}/users"
    
    try:
        res = requests.post(create_url, json=user_data, headers=headers)
        if res.status_code == 201:
            from core.auth import get_user_id_by_username
            user_id = get_user_id_by_username(realm, username, admin_token)
            if user_id:
                assign_roles_to_user(realm, user_id, admin_token)
            return templates.TemplateResponse("signup.html", {"request": request, "success": "Account created! You can now login.", "prefix": APP_PREFIX})
        else:
            error_msg = res.json().get("errorMessage", "Registration failed")
            return templates.TemplateResponse("signup.html", {"request": request, "error": error_msg, "prefix": APP_PREFIX})
    except Exception as e:
        return templates.TemplateResponse("signup.html", {"request": request, "error": str(e), "prefix": APP_PREFIX})

@router.get("/logout")
async def logout(request: Request):
    request.session.clear()
    return RedirectResponse(get_redirect_url("/"), status_code=302)
