from fastapi import APIRouter, WebSocket, WebSocketDisconnect
import asyncio
from backend.events import memory_bus

router = APIRouter(tags=["Real-Time Dashboard"])

class ConnectionManager:
    def __init__(self):
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: str):
        for connection in list(self.active_connections):
            try:
                await connection.send_text(message)
            except Exception:
                self.disconnect(connection)

manager = ConnectionManager()

@router.websocket("/ws/dashboard")
async def websocket_dashboard(websocket: WebSocket):
    await manager.connect(websocket)
    queue = memory_bus.subscribe()
    
    try:
        while True:
            # Wait for either incoming message from websocket or published bus event
            bus_task = asyncio.create_task(queue.get())
            ws_task = asyncio.create_task(websocket.receive_text())
            
            done, pending = await asyncio.wait(
                [bus_task, ws_task],
                return_when=asyncio.FIRST_COMPLETED
            )
            
            for task in pending:
                task.cancel()
                
            for task in done:
                if task == bus_task:
                    msg = task.result()
                    await websocket.send_text(msg)
                elif task == ws_task:
                    # Echo / heartbeat
                    data = task.result()
                    if data == "ping":
                        await websocket.send_text('{"event":"pong"}')
    except WebSocketDisconnect:
        manager.disconnect(websocket)
        memory_bus.unsubscribe(queue)
    except Exception:
        manager.disconnect(websocket)
        memory_bus.unsubscribe(queue)
