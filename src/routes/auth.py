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
async def login_post(request: Request, email: str = Form(...), password: str = Form(...)):
    realm = DEFAULT_REALM
    admin_token = get_admin_token(realm)
    
    if not admin_token:
        return templates.TemplateResponse("login.html", {"request": request, "error": "System error. Please try again later.", "prefix": APP_PREFIX})
        
    from core.auth import get_username_by_email
    username = get_username_by_email(realm, email, admin_token)
    
    if not username:
        return templates.TemplateResponse("login.html", {"request": request, "error": "Invalid email or password", "prefix": APP_PREFIX})

    # Pass the actual username to Keycloak for auto-login
    success, result = perform_auto_login_logic(request, realm, username, password)
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
                
                # Trigger verification email via OTP
                from core.otp import generate_otp, send_otp_email
                otp = generate_otp(email, "verify")
                send_otp_email(email, otp, "Verify your DIBL IOT Account")
                    
            return RedirectResponse(url=get_prefixed_path(f"/verify-email?email={email}"), status_code=303)
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
        return RedirectResponse(url=get_prefixed_path(f"/reset-password?email={email}"), status_code=303)

    from core.otp import generate_otp, send_otp_email
    otp = generate_otp(email, "reset")
    send_otp_email(email, otp, "Reset your DIBL IOT Password")
    
    return RedirectResponse(url=get_prefixed_path(f"/reset-password?email={email}"), status_code=303)

@router.get("/verify-email", response_class=HTMLResponse)
async def verify_email_get(request: Request, email: str = ""):
    return templates.TemplateResponse("verify_email.html", {"request": request, "email": email, "prefix": APP_PREFIX})

@router.post("/verify-email", response_class=HTMLResponse)
async def verify_email_post(request: Request, email: str = Form(...), otp: str = Form(...)):
    from core.otp import verify_otp
    if verify_otp(email, otp, "verify"):
        realm = DEFAULT_REALM
        admin_token = get_admin_token(realm)
        from core.auth import get_user_id_by_email
        user_id = get_user_id_by_email(realm, email, admin_token)
        if user_id and admin_token:
            headers = {"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"}
            url = f"{KEYCLOAK_URL}/admin/realms/{realm}/users/{user_id}"
            requests.put(url, json={"emailVerified": True}, headers=headers)
        return templates.TemplateResponse("login.html", {"request": request, "success": "Email verified successfully! You can now log in.", "prefix": APP_PREFIX})
    return templates.TemplateResponse("verify_email.html", {"request": request, "error": "Invalid or expired OTP", "email": email, "prefix": APP_PREFIX})

@router.get("/reset-password", response_class=HTMLResponse)
async def reset_password_get(request: Request, email: str = ""):
    return templates.TemplateResponse("reset_password.html", {"request": request, "email": email, "prefix": APP_PREFIX})

@router.post("/reset-password", response_class=HTMLResponse)
async def reset_password_post(request: Request, email: str = Form(...), otp: str = Form(...), password: str = Form(...)):
    from core.otp import verify_otp
    if verify_otp(email, otp, "reset"):
        realm = DEFAULT_REALM
        admin_token = get_admin_token(realm)
        from core.auth import get_user_id_by_email
        user_id = get_user_id_by_email(realm, email, admin_token)
        if user_id and admin_token:
            headers = {"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"}
            url = f"{KEYCLOAK_URL}/admin/realms/{realm}/users/{user_id}/reset-password"
            res = requests.put(url, json={"type": "password", "value": password, "temporary": False}, headers=headers)
            if res.status_code in [200, 204]:
                return templates.TemplateResponse("login.html", {"request": request, "success": "Password reset successfully! You can now log in.", "prefix": APP_PREFIX})
            else:
                return templates.TemplateResponse("reset_password.html", {"request": request, "error": "Failed to update password in auth server.", "email": email, "prefix": APP_PREFIX})
        return templates.TemplateResponse("reset_password.html", {"request": request, "error": "User not found or connection failed.", "email": email, "prefix": APP_PREFIX})
    return templates.TemplateResponse("reset_password.html", {"request": request, "error": "Invalid or expired OTP", "email": email, "prefix": APP_PREFIX})

@router.get("/logout")
async def logout(request: Request):
    request.session.clear()
    return RedirectResponse(get_prefixed_path("/"), status_code=302)
