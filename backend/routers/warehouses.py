from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload, joinedload
from typing import List

from backend import models, schemas
from backend.database import get_db

router = APIRouter(prefix="/warehouses", tags=["Settings & Warehouses"])

@router.get("/", response_model=List[schemas.WarehouseResponse])
async def list_warehouses(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(models.Warehouse)
        .options(selectinload(models.Warehouse.locations))
        .order_by(models.Warehouse.name.asc())
    )
    return result.scalars().all()

@router.post("/", response_model=schemas.WarehouseResponse)
async def create_warehouse(wh: schemas.WarehouseCreate, db: AsyncSession = Depends(get_db)):
    db_wh = models.Warehouse(**wh.model_dump())
    db.add(db_wh)
    await db.commit()
    await db.refresh(db_wh)
    return db_wh

@router.get("/locations", response_model=List[schemas.LocationResponse])
async def list_locations(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(models.Location)
        .options(joinedload(models.Location.warehouse))
        .order_by(models.Location.name.asc())
    )
    return result.scalars().all()

@router.post("/locations", response_model=schemas.LocationResponse)
async def create_location(loc: schemas.LocationCreate, db: AsyncSession = Depends(get_db)):
    db_loc = models.Location(**loc.model_dump())
    db.add(db_loc)
    await db.commit()
    await db.refresh(db_loc)
    return db_loc

@router.get("/stock-matrix")
async def get_stock_matrix(db: AsyncSession = Depends(get_db)):
    """Provides product stock availability per location matrix."""
    prods_res = await db.execute(select(models.Product).order_by(models.Product.name.asc()))
    products = prods_res.scalars().all()
    
    locs_res = await db.execute(
        select(models.Location)
        .options(joinedload(models.Location.warehouse))
        .order_by(models.Location.name.asc())
    )
    locations = locs_res.scalars().all()

    quants_res = await db.execute(select(models.StockQuant))
    quants = quants_res.scalars().all()
    
    # Map (prod_id, loc_id) -> quantity
    q_map = {(q.product_id, q.location_id): q.quantity for q in quants}

    matrix = []
    for p in products:
        loc_stocks = {}
        total = 0.0
        for loc in locations:
            qty = q_map.get((p.id, loc.id), 0.0)
            loc_stocks[str(loc.id)] = qty
            total += qty
        matrix.append({
            "product_id": p.id,
            "product_name": p.name,
            "sku": p.sku,
            "category": p.category,
            "uom": p.uom,
            "total_stock": total,
            "locations": loc_stocks
        })
        
    return {
        "locations": [
            {"id": loc.id, "name": loc.name, "warehouse": loc.warehouse.name if loc.warehouse else ""}
            for loc in locations
        ],
        "products": matrix
    }
