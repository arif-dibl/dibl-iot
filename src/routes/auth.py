import requests
from fastapi import APIRouter, Request, Form
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates
from core.config import DEFAULT_REALM, KEYCLOAK_URL, OR_HOSTNAME, OR_ADMIN_PASSWORD
from core.auth import get_admin_token, assign_roles_to_user, perform_auto_login_logic

router = APIRouter(tags=["auth"])
templates = Jinja2Templates(directory="templates")

@router.get("/", response_class=HTMLResponse)
async def index_page(request: Request):
    if request.session.get("access_token") and request.session.get("username"):
        return RedirectResponse("/dashboard")
    return templates.TemplateResponse("login.html", {"request": request})

@router.get("/login", response_class=HTMLResponse)
async def login_get(request: Request):
    return RedirectResponse("/")

@router.post("/login", response_class=HTMLResponse)
async def login_post(request: Request, username: str = Form(...), password: str = Form(...)):
    success, result = perform_auto_login_logic(request, DEFAULT_REALM, username, password)
    if success:
        return RedirectResponse("/dashboard", status_code=303)
    return templates.TemplateResponse("login.html", {"request": request, "error": result})

@router.get("/signup", response_class=HTMLResponse)
async def signup_get(request: Request):
    return templates.TemplateResponse("signup.html", {"request": request})

@router.post("/signup", response_class=HTMLResponse)
async def signup_post(request: Request, username: str = Form(...), email: str = Form(...), password: str = Form(...), terms: str = Form(...)):
    realm = DEFAULT_REALM
    
    # Log Terms and Conditions acceptance
    if terms == "on":
        print(f"User {username} accepted Terms and Conditions")
        
    admin_token = get_admin_token(realm)
    if not admin_token:
        return templates.TemplateResponse("signup.html", {"request": request, "error": "Could not connect to auth server"})

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
            return templates.TemplateResponse("signup.html", {"request": request, "success": "Account created! You can now login."})
        else:
            error_msg = res.json().get("errorMessage", "Registration failed")
            return templates.TemplateResponse("signup.html", {"request": request, "error": error_msg})
    except Exception as e:
        return templates.TemplateResponse("signup.html", {"request": request, "error": str(e)})

@router.get("/logout")
async def logout(request: Request):
    request.session.clear()
    return RedirectResponse("/", status_code=302)
