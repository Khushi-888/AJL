import os
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from backend import database

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Ensure tables exist in database (PostgreSQL or fallback SQLite)
    try:
        async with database.engine.begin() as conn:
            await conn.run_sync(database.Base.metadata.create_all)
    except Exception as e:
        print(f"[Lifespan] Primary DB connection failed ({e}). Automatically switching to local SQLite...")
        database.switch_to_sqlite()
        async with database.engine.begin() as conn:
            await conn.run_sync(database.Base.metadata.create_all)

    # Auto-seed database if empty
    try:
        from backend import models
        from sqlalchemy import select, func
        user_cnt = 0
        async with database.AsyncSessionLocal() as db_session:
            user_cnt = await db_session.scalar(select(func.count(models.User.id)))
        if user_cnt == 0:
            from backend.seed import seed_data
            await seed_data()
    except Exception as e:
        print(f"[Lifespan] Startup check/seed info: {e}")

    yield
    # Clean up on shutdown
    try:
        await database.engine.dispose()
    except Exception:
        pass

from backend.routers import operations, auth, websocket, products, otp, warehouses

app = FastAPI(
    title="StockSense - Modular Inventory Management System",
    description="Full-featured IMS digitizing stock operations, receipts, deliveries, internal transfers, and move history backed by PostgreSQL.",
    version="1.0.0",
    lifespan=lifespan
)

# Enable CORS for web browser responsiveness across any origin/port
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register API Routers
app.include_router(auth.router)
app.include_router(operations.router)
app.include_router(products.router)
app.include_router(warehouses.router)
app.include_router(otp.router)
app.include_router(websocket.router)

# Mount frontend directory for static assets
frontend_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "frontend")
if os.path.exists(frontend_dir):
    app.mount("/static", StaticFiles(directory=frontend_dir), name="static")

@app.get("/")
async def serve_home():
    index_path = os.path.join(frontend_dir, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path)
    return {"message": "Welcome to StockSense API"}

# Support root relative static file requests for seamless local & live serving
@app.get("/style.css")
async def serve_root_style():
    p = os.path.join(frontend_dir, "style.css")
    if os.path.exists(p):
        return FileResponse(p, media_type="text/css")
    return {"error": "style.css not found"}

@app.get("/app.js")
async def serve_root_app_js():
    p = os.path.join(frontend_dir, "app.js")
    if os.path.exists(p):
        return FileResponse(p, media_type="application/javascript")
    return {"error": "app.js not found"}

@app.get("/warehouse3d.js")
async def serve_root_warehouse3d_js():
    p = os.path.join(frontend_dir, "warehouse3d.js")
    if os.path.exists(p):
        return FileResponse(p, media_type="application/javascript")
    return {"error": "warehouse3d.js not found"}

@app.get("/health")
async def health_check():
    db_type = "PostgreSQL 18" if "postgresql" in str(database.DATABASE_URL or "") else "SQLite (Local Async)"
    return {"status": "ok", "database": db_type, "app": "StockSense"}
