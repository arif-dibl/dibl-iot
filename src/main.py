from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from starlette.middleware.sessions import SessionMiddleware
from routes import auth as auth_routes, dashboard as dashboard_routes
from api import assets as assets_api, rules as rules_api, user as user_api, debug as debug_api
from fastapi.responses import FileResponse
import os

# Get subpath prefix from environment (e.g., "/customui" for proxy deployment)
APP_PREFIX = os.environ.get("APP_PREFIX", "")

# Create the main app
app = FastAPI(title="DIBL IoT Custom UI", root_path=APP_PREFIX)

# Middleware
from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware
app.add_middleware(ProxyHeadersMiddleware, trusted_hosts=["*"])
app.add_middleware(SessionMiddleware, secret_key="supersecretkey")

# If we have a prefix, create a sub-application pattern
if APP_PREFIX:
    # Create a sub-app that handles all routes
    from fastapi import APIRouter
    
    # Mount static files under the prefix
    app.mount(f"{APP_PREFIX}/static", StaticFiles(directory="static"), name="static")
    
    # Also mount at root for backward compatibility
    app.mount("/static", StaticFiles(directory="static"), name="static_root")
    
    # Create prefixed routers
    prefixed_router = APIRouter(prefix=APP_PREFIX)
    
    # Include all routes in the prefixed router
    prefixed_router.include_router(assets_api.router)
    prefixed_router.include_router(rules_api.router)
    prefixed_router.include_router(user_api.router)
    prefixed_router.include_router(debug_api.router)
    prefixed_router.include_router(auth_routes.router)
    prefixed_router.include_router(dashboard_routes.router)
    
    @prefixed_router.get("/favicon.ico", include_in_schema=False)
    async def favicon_prefixed():
        return FileResponse("static/images/favicon.png")
    
    # Mount the prefixed router
    app.include_router(prefixed_router)
    
    # Redirect root to prefixed root
    from fastapi.responses import RedirectResponse
    @app.get("/")
    async def redirect_to_prefix():
        return RedirectResponse(f"{APP_PREFIX}/")
else:
    # Standard operation without prefix
    app.mount("/static", StaticFiles(directory="static"), name="static")
    
    # Backend API Routers
    app.include_router(assets_api.router)
    app.include_router(rules_api.router)
    app.include_router(user_api.router)
    app.include_router(debug_api.router)
    
    # HTML Page Routers
    app.include_router(auth_routes.router)
    app.include_router(dashboard_routes.router)
    
    @app.get("/favicon.ico", include_in_schema=False)
    async def favicon():
        return FileResponse("static/images/favicon.png")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
