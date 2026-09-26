import os
from celery import Celery

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
RABBITMQ_URL = os.getenv("CELERY_BROKER_URL", "amqp://guest:guest@localhost:5672//")

# Using RabbitMQ as broker, Redis as backend as per the requirements
celery_app = Celery(
    "stocksense_tasks",
    broker=RABBITMQ_URL,
    backend=REDIS_URL,
    include=["backend.tasks"]
)

# Optional configuration
celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
)
