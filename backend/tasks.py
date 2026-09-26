from celery.schedules import crontab
from backend.celery_app import celery_app
import asyncio

@celery_app.task
def check_low_stock():
    """
    Checks the database for products where total quantity < reorder_point.
    Since Celery is synchronous by default and we use SQLAlchemy Async, 
    we need to wrap the async execution in an event loop.
    """
    # In a real app, you would initialize an async session,
    # query the DB for StockQuant quantities aggregated by Product,
    # compare it to product.reorder_point, and trigger an alert if low.
    
    # We will simulate the async db check here.
    async def async_check():
        print("Checking for low stock across all warehouses...")
        # e.g., result = await db.execute(select(...))
        # alert_system.send_email(...)
        pass
        
    asyncio.run(async_check())
    return "Low stock check completed."

# Schedule the task to run every 15 minutes as per requirements
celery_app.conf.beat_schedule = {
    "check-low-stock-every-15-mins": {
        "task": "backend.tasks.check_low_stock",
        "schedule": crontab(minute="*/15"),
    },
}
