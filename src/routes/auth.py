import requests
from fastapi import APIRouter, Request, Form
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates
from core.config import DEFAULT_REALM, KEYCLOAK_URL, OR_HOSTNAME, OR_ADMIN_PASSWORD, APP_PREFIX
from core.auth import get_admin_token, assign_roles_to_user, perform_auto_login_logic

router = APIRouter(tags=["auth"])
templates = Jinja2Templates(directory="templates")

def get_prefixed_path(path: str) -> str:
    """Get path with APP_PREFIX prepended"""
    return f"{APP_PREFIX}{path}" if APP_PREFIX else path

@router.get("/", response_class=HTMLResponse)
async def index_page(request: Request):
    username = request.session.get("username")
    if request.session.get("access_token") and username:
        return RedirectResponse(get_prefixed_path(f"/{username}/dashboard"))
    return templates.TemplateResponse("login.html", {"request": request, "prefix": APP_PREFIX})

@router.get("/login", response_class=HTMLResponse)
async def login_get(request: Request):
    return RedirectResponse(get_prefixed_path("/"))

@router.post("/login", response_class=HTMLResponse)
async def login_post(request: Request, username: str = Form(...), password: str = Form(...)):
    success, result = perform_auto_login_logic(request, DEFAULT_REALM, username, password)
    if success:
        return RedirectResponse(get_prefixed_path(f"/{username}/dashboard"), status_code=303)
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
                
                # Trigger verification email
                email_url = f"{KEYCLOAK_URL}/admin/realms/{realm}/users/{user_id}/execute-actions-email"
                try:
                    requests.put(email_url, json=["VERIFY_EMAIL"], headers=headers)
                except Exception as e:
                    print(f"Failed to send verify email: {e}")
                    
            return templates.TemplateResponse("signup.html", {"request": request, "success": "Account created! Please check your email to verify your account before logging in.", "prefix": APP_PREFIX})
        else:
            error_msg = res.json().get("errorMessage", "Registration failed")
            return templates.TemplateResponse("signup.html", {"request": request, "error": error_msg, "prefix": APP_PREFIX})
    except Exception as e:
        return templates.TemplateResponse("signup.html", {"request": request, "error": str(e), "prefix": APP_PREFIX})

@router.get("/forgot-password", response_class=HTMLResponse)
async def forgot_password_get(request: Request):
    return templates.TemplateResponse("forgot_password.html", {"request": request, "prefix": APP_PREFIX})

@router.post("/forgot-password", response_class=HTMLResponse)
async def forgot_password_post(request: Request, email: str = Form(...)):
    realm = DEFAULT_REALM
    admin_token = get_admin_token(realm)
    
    if not admin_token:
        return templates.TemplateResponse("forgot_password.html", {"request": request, "error": "Could not connect to auth server", "prefix": APP_PREFIX})

    from core.auth import get_user_id_by_email
    user_id = get_user_id_by_email(realm, email, admin_token)
    
    if not user_id:
        return templates.TemplateResponse("forgot_password.html", {"request": request, "success": "If an account with that email exists, a password reset link has been sent.", "prefix": APP_PREFIX})

    # Trigger password reset email with client_id and redirect_uri
    email_url = f"{KEYCLOAK_URL}/admin/realms/{realm}/users/{user_id}/execute-actions-email?client_id=openremote&redirect_uri=https://{OR_HOSTNAME}/manager/"
    headers = {"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"}
    
    try:
        res = requests.put(email_url, json=["UPDATE_PASSWORD"], headers=headers)
        if res.status_code in [200, 204]:
            return templates.TemplateResponse("forgot_password.html", {"request": request, "success": "If an account with that email exists, a password reset link has been sent.", "prefix": APP_PREFIX})
        else:
            print(f"Failed to send reset email: {res.status_code} - {res.text}")
            return templates.TemplateResponse("forgot_password.html", {"request": request, "error": "Failed to send reset email. Please contact support.", "prefix": APP_PREFIX})
    except Exception as e:
        print(f"Error sending reset email: {e}")
        return templates.TemplateResponse("forgot_password.html", {"request": request, "error": "An error occurred while sending the email.", "prefix": APP_PREFIX})

@router.get("/logout")
async def logout(request: Request):
    request.session.clear()
    return RedirectResponse(get_prefixed_path("/"), status_code=302)
