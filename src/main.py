from fastapi import FastAPI, Request, APIRouter, Depends
from fastapi.staticfiles import StaticFiles
from starlette.middleware.sessions import SessionMiddleware
from routes import auth as auth_routes, dashboard as dashboard_routes
from api import assets as assets_api, rules as rules_api, user as user_api, debug as debug_api
from core.config import APP_PREFIX
from core.auth import verify_username_match

# Create FastAPI app
docs_url = f"{APP_PREFIX}/docs" if APP_PREFIX else "/docs"
openapi_url = f"{APP_PREFIX}/openapi.json" if APP_PREFIX else "/openapi.json"

app = FastAPI(title="DIBL IoT Custom UI", docs_url=docs_url, openapi_url=openapi_url)

# Session Middleware
from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware
app.add_middleware(ProxyHeadersMiddleware, trusted_hosts=["*"])
app.add_middleware(SessionMiddleware, secret_key="supersecretkey")

# 1. PUBLIC ROUTES (No prefix, no gatekeeper)
# Include authentication routes directly at the root (or APP_PREFIX)
app.include_router(auth_routes.router, prefix=APP_PREFIX)

# Static Files - mount at prefixed path
static_mount_path = f"{APP_PREFIX}/static" if APP_PREFIX else "/static"
app.mount(static_mount_path, StaticFiles(directory="static"), name="static")

# 2. PROTECTED ROUTES (Requires /{username} prefix and Gatekeeper)
# Create a router specifically for user-prefixed content
user_router = APIRouter(
    prefix=f"{APP_PREFIX}/{{username}}" if APP_PREFIX else "/{username}",
    dependencies=[Depends(verify_username_match)]
)

# Backend API Routers
user_router.include_router(assets_api.router)
user_router.include_router(rules_api.router)
user_router.include_router(user_api.router)
user_router.include_router(debug_api.router)

# HTML Page Routers
user_router.include_router(dashboard_routes.router)

app.include_router(user_router)

from fastapi.responses import FileResponse
@app.get(f"{APP_PREFIX}/favicon.ico" if APP_PREFIX else "/favicon.ico", include_in_schema=False)
async def favicon():
    return FileResponse("static/images/favicon.png")

if __name__ == "__main__":
    import uvicorn
    # CRITICAL: Port must match HAProxy target (5000), NOT 8000
    uvicorn.run(app, host="0.0.0.0", port=5000)
