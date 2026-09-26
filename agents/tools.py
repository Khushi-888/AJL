from langchain.tools import tool
import httpx
import json

API_URL = "http://localhost:8000"

@tool
def process_receipt(product_id: int, dest_location_id: int, quantity: float) -> str:
    """Processes an incoming receipt for a product from a vendor."""
    payload = {
        "doc_type": "receipt",
        "lines": [{
            "product_id": product_id,
            "dest_location_id": dest_location_id,
            "quantity": quantity
        }]
    }
    with httpx.Client() as client:
        resp = client.post(f"{API_URL}/operations/receipt", json=payload)
        if resp.status_code == 200:
            return f"Successfully created receipt: {resp.json()}"
        return f"Failed to create receipt: {resp.text}"

@tool
def process_delivery(product_id: int, source_location_id: int, quantity: float) -> str:
    """Processes an outgoing delivery for a customer shipment."""
    payload = {
        "doc_type": "delivery",
        "lines": [{
            "product_id": product_id,
            "source_location_id": source_location_id,
            "quantity": quantity
        }]
    }
    with httpx.Client() as client:
        resp = client.post(f"{API_URL}/operations/delivery", json=payload)
        if resp.status_code == 200:
            return f"Successfully created delivery: {resp.json()}"
        return f"Failed to create delivery: {resp.text}"

@tool
def process_transfer(product_id: int, source_location_id: int, dest_location_id: int, quantity: float) -> str:
    """Processes an internal transfer of stock between two locations."""
    payload = {
        "doc_type": "transfer",
        "lines": [{
            "product_id": product_id,
            "source_location_id": source_location_id,
            "dest_location_id": dest_location_id,
            "quantity": quantity
        }]
    }
    with httpx.Client() as client:
        resp = client.post(f"{API_URL}/operations/transfer", json=payload)
        if resp.status_code == 200:
            return f"Successfully created transfer: {resp.json()}"
        return f"Failed to create transfer: {resp.text}"

@tool
def process_adjustment(product_id: int, location_id: int, quantity_delta: float) -> str:
    """Processes a manual stock adjustment (positive or negative quantity_delta)."""
    payload = {
        "doc_type": "adjustment",
        "lines": [{
            "product_id": product_id,
            "quantity": quantity_delta,
            "source_location_id": location_id if quantity_delta < 0 else None,
            "dest_location_id": location_id if quantity_delta > 0 else None
        }]
    }
    with httpx.Client() as client:
        resp = client.post(f"{API_URL}/operations/adjustment", json=payload)
        if resp.status_code == 200:
            return f"Successfully adjusted stock: {resp.json()}"
        return f"Failed to adjust stock: {resp.text}"
