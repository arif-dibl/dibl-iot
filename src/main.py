from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from starlette.middleware.sessions import SessionMiddleware
from routes import auth as auth_routes, dashboard as dashboard_routes
from api import assets as assets_api, rules as rules_api, user as user_api, debug as debug_api

app = FastAPI(title="DIBL IoT Custom UI") # Reload trigger v3

# Session Middleware
from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware
app.add_middleware(ProxyHeadersMiddleware, trusted_hosts=["*"])
app.add_middleware(SessionMiddleware, secret_key="supersecretkey")

# Static Files
app.mount("/static", StaticFiles(directory="static"), name="static")

# Backend API Routers
app.include_router(assets_api.router)
app.include_router(rules_api.router)
app.include_router(user_api.router)
app.include_router(debug_api.router)

# HTML Page Routers
app.include_router(auth_routes.router)
app.include_router(dashboard_routes.router)

from fastapi.responses import FileResponse
@app.get("/favicon.ico", include_in_schema=False)
async def favicon():
    return FileResponse("static/images/favicon.png")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
