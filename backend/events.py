import os
import json
import asyncio
from typing import Set, Dict, Any, Optional

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")

# In-memory pubsub fallback and key-value store for development / environments without Redis
class InMemoryBus:
    def __init__(self):
        self.subscribers: Set[asyncio.Queue] = set()
        self.store: Dict[str, tuple[str, float]] = {} # key -> (val, expire_at)

    def subscribe(self) -> asyncio.Queue:
        q = asyncio.Queue()
        self.subscribers.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue):
        self.subscribers.discard(q)

    async def publish(self, channel: str, message: str):
        dead = []
        for q in self.subscribers:
            try:
                await q.put(message)
            except Exception:
                dead.append(q)
        for q in dead:
            self.subscribers.discard(q)

    async def setex(self, key: str, seconds: int, value: str):
        loop = asyncio.get_event_loop()
        expire_at = loop.time() + seconds
        self.store[key] = (value, expire_at)

    async def get(self, key: str) -> Optional[bytes]:
        loop = asyncio.get_event_loop()
        item = self.store.get(key)
        if not item:
            return None
        val, expire_at = item
        if loop.time() > expire_at:
            del self.store[key]
            return None
        return val.encode("utf-8") if isinstance(val, str) else val

    async def delete(self, key: str):
        self.store.pop(key, None)

memory_bus = InMemoryBus()
_redis_available = False
_redis_client = None

try:
    import redis.asyncio as aioredis
    _redis_client = aioredis.from_url(REDIS_URL, decode_responses=False)
except Exception:
    _redis_client = None

class EventManager:
    async def publish_stock_update(self, product_id: int, location_id: int, new_quantity: float, change: float, trigger: str):
        message = {
            "event": "stock_updated",
            "data": {
                "product_id": product_id,
                "location_id": location_id,
                "new_quantity": new_quantity,
                "change": change,
                "trigger": trigger
            }
        }
        raw = json.dumps(message)
        # Always publish to memory bus for local websocket clients
        await memory_bus.publish("stock_updates", raw)
        if _redis_client:
            try:
                await _redis_client.publish("stock_updates", raw)
            except Exception:
                pass

    async def set_cache(self, key: str, seconds: int, value: str):
        await memory_bus.setex(key, seconds, value)
        if _redis_client:
            try:
                await _redis_client.setex(key, seconds, value)
            except Exception:
                pass

    async def get_cache(self, key: str) -> Optional[str]:
        if _redis_client:
            try:
                res = await _redis_client.get(key)
                if res:
                    return res.decode("utf-8") if isinstance(res, bytes) else str(res)
            except Exception:
                pass
        res = await memory_bus.get(key)
        return res.decode("utf-8") if res else None

    async def delete_cache(self, key: str):
        await memory_bus.delete(key)
        if _redis_client:
            try:
                await _redis_client.delete(key)
            except Exception:
                pass

event_manager = EventManager()
redis_client = memory_bus # For backward compatibility with routes importing redis_client
