import os
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from backend.database import engine, Base

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Ensure tables exist in PostgreSQL
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    # Clean up on shutdown
    await engine.dispose()

from backend.routers import operations, auth, websocket, products, otp, warehouses

app = FastAPI(
    title="StockSense - Modular Inventory Management System",
    description="Full-featured IMS digitizing stock operations, receipts, deliveries, internal transfers, and move history backed by PostgreSQL.",
    version="1.0.0",
    lifespan=lifespan
)

# Enable CORS for web browser responsiveness
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

@app.get("/health")
async def health_check():
    return {"status": "ok", "database": "PostgreSQL 18", "app": "StockSense"}
