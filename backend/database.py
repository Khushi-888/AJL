import os
import socket
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import declarative_base, sessionmaker

DATABASE_URL = os.getenv("DATABASE_URL")

def is_postgres_available(host="127.0.0.1", port=5432, timeout=0.5) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False

# Determine database engine
if not DATABASE_URL:
    if is_postgres_available():
        DATABASE_URL = "postgresql+asyncpg://postgres:postgres@127.0.0.1:5432/stocksense"
        print("[Database] Connected to local PostgreSQL on 127.0.0.1:5432")
    else:
        DATABASE_URL = "sqlite+aiosqlite:///./stocksense.db"
        print("[Database] Local PostgreSQL not running. Using local asynchronous SQLite (stocksense.db)")
else:
    # Ensure asyncpg dialect is used regardless of whether Render provides postgres:// or postgresql://
    if DATABASE_URL.startswith("postgres://"):
        DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql+asyncpg://", 1)
    elif DATABASE_URL.startswith("postgresql://") and not DATABASE_URL.startswith("postgresql+asyncpg://"):
        DATABASE_URL = DATABASE_URL.replace("postgresql://", "postgresql+asyncpg://", 1)
    print(f"[Database] Using configured DATABASE_URL: {DATABASE_URL.split('@')[-1] if '@' in DATABASE_URL else 'configured'}")

engine = create_async_engine(DATABASE_URL, echo=False)

# Async session factory
AsyncSessionLocal = sessionmaker(
    engine, class_=AsyncSession, expire_on_commit=False
)

Base = declarative_base()

def switch_to_sqlite():
    global engine, AsyncSessionLocal, DATABASE_URL
    DATABASE_URL = "sqlite+aiosqlite:///./stocksense.db"
    print("[Database] Switching fallback engine to SQLite (stocksense.db)")
    engine = create_async_engine(DATABASE_URL, echo=False)
    AsyncSessionLocal = sessionmaker(
        engine, class_=AsyncSession, expire_on_commit=False
    )
    return engine

async def get_db():
    async with AsyncSessionLocal() as session:
        yield session
