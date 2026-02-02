from fastapi import FastAPI, Request, APIRouter
from fastapi.staticfiles import StaticFiles
from starlette.middleware.sessions import SessionMiddleware
from routes import auth as auth_routes, dashboard as dashboard_routes
from api import assets as assets_api, rules as rules_api, user as user_api, debug as debug_api
from core.config import APP_PREFIX

# Create FastAPI app with root_path for correct URL generation behind reverse proxy
app = FastAPI(title="DIBL IoT Custom UI", root_path=APP_PREFIX)

# Session Middleware
from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware
app.add_middleware(ProxyHeadersMiddleware, trusted_hosts=["*"])
app.add_middleware(SessionMiddleware, secret_key="supersecretkey")

# Static Files - mount at prefixed path
static_mount_path = f"{APP_PREFIX}/static" if APP_PREFIX else "/static"
app.mount(static_mount_path, StaticFiles(directory="static"), name="static")

# Create a parent router with APP_PREFIX for all routes
# This ensures all routes work under the /customui subpath
if APP_PREFIX:
    parent_router = APIRouter(prefix=APP_PREFIX)
    
    # Backend API Routers
    parent_router.include_router(assets_api.router)
    parent_router.include_router(rules_api.router)
    parent_router.include_router(user_api.router)
    parent_router.include_router(debug_api.router)
    
    # HTML Page Routers
    parent_router.include_router(auth_routes.router)
    parent_router.include_router(dashboard_routes.router)
    
    app.include_router(parent_router)
else:
    # No prefix - include routers directly (for local development)
    app.include_router(assets_api.router)
    app.include_router(rules_api.router)
    app.include_router(user_api.router)
    app.include_router(debug_api.router)
    app.include_router(auth_routes.router)
    app.include_router(dashboard_routes.router)

from fastapi.responses import FileResponse
@app.get(f"{APP_PREFIX}/favicon.ico" if APP_PREFIX else "/favicon.ico", include_in_schema=False)
async def favicon():
    return FileResponse("static/images/favicon.png")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
