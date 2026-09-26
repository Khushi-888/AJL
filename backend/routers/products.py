from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload, joinedload
from sqlalchemy import func, or_
from typing import List, Optional

from backend import models, schemas
from backend.database import get_db
from backend.crud import get_or_create_quant, generate_reference

router = APIRouter(prefix="/products", tags=["Products"])

@router.post("/", response_model=schemas.ProductResponse)
async def create_product(product: schemas.ProductCreate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(models.Product).where(models.Product.sku == product.sku))
    existing_product = result.scalars().first()
    if existing_product:
        raise HTTPException(status_code=400, detail="Product with this SKU already exists")
        
    db_product = models.Product(
        name=product.name,
        sku=product.sku,
        category=product.category or "General",
        uom=product.uom or "Units",
        reorder_point=product.reorder_point or 10.0
    )
    db.add(db_product)
    await db.flush()

    # Initial stock optional handling
    if product.initial_stock and product.initial_stock > 0:
        loc_id = product.initial_location_id
        if not loc_id:
            # Pick first available location
            loc_res = await db.execute(select(models.Location.id).limit(1))
            loc_id = loc_res.scalar()
        
        if loc_id:
            quant = await get_or_create_quant(db, db_product.id, loc_id)
            quant.quantity += product.initial_stock
            
            ref = await generate_reference(db, models.DocumentTypeEnum.receipt)
            # Create document for opening inventory
            doc = models.Document(
                reference=ref,
                doc_type=models.DocumentTypeEnum.receipt,
                status=models.DocumentStatusEnum.done,
                partner_name="Initial Inventory",
                dest_location_id=loc_id,
                notes="Initial Stock upon product creation"
            )
            db.add(doc)
            await db.flush()
            
            line = models.DocumentLine(
                document_id=doc.id,
                product_id=db_product.id,
                quantity=product.initial_stock,
                dest_location_id=loc_id
            )
            db.add(line)

            ledger = models.StockLedger(
                product_id=db_product.id,
                location_id=loc_id,
                document_id=doc.id,
                reference=ref,
                quantity_change=product.initial_stock,
                balance_after=quant.quantity,
                note="Opening balance"
            )
            db.add(ledger)

    await db.commit()
    await db.refresh(db_product)
    return await get_product_details(db_product.id, db)

@router.get("/", response_model=List[schemas.ProductResponse])
async def list_products(
    category: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    low_stock_only: bool = False,
    db: AsyncSession = Depends(get_db)
):
    query = (
        select(models.Product)
        .options(
            selectinload(models.Product.quants).joinedload(models.StockQuant.location).joinedload(models.Location.warehouse)
        )
        .order_by(models.Product.name.asc())
    )

    if category and category.lower() != "all":
        query = query.where(models.Product.category == category)
    if search:
        s = f"%{search}%"
        query = query.where(or_(models.Product.name.ilike(s), models.Product.sku.ilike(s)))

    result = await db.execute(query)
    products = result.scalars().all()

    out = []
    for p in products:
        total_stock = sum(q.quantity for q in p.quants)
        is_low = total_stock <= p.reorder_point
        if low_stock_only and not is_low:
            continue
            
        quants_out = [
            schemas.StockQuantResponse(
                id=q.id,
                product_id=q.product_id,
                location_id=q.location_id,
                quantity=q.quantity,
                location_name=q.location.name if q.location else None,
                warehouse_name=q.location.warehouse.name if q.location and q.location.warehouse else None
            )
            for q in p.quants
        ]
        out.append(
            schemas.ProductResponse(
                id=p.id,
                name=p.name,
                sku=p.sku,
                category=p.category,
                uom=p.uom,
                reorder_point=p.reorder_point,
                created_at=p.created_at,
                total_stock=total_stock,
                is_low_stock=is_low,
                quants=quants_out
            )
        )
    return out

@router.get("/categories")
async def get_categories(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(models.Product.category).distinct())
    cats = [c for c in result.scalars().all() if c]
    return sorted(list(set(cats)))

@router.get("/reordering-rules")
async def get_reordering_rules(db: AsyncSession = Depends(get_db)):
    query = (
        select(models.Product)
        .options(selectinload(models.Product.quants))
        .order_by(models.Product.name.asc())
    )
    result = await db.execute(query)
    prods = result.scalars().all()
    
    rules = []
    for p in prods:
        curr_stock = sum(q.quantity for q in p.quants)
        rules.append({
            "product_id": p.id,
            "product_name": p.name,
            "sku": p.sku,
            "uom": p.uom,
            "current_stock": curr_stock,
            "reorder_point": p.reorder_point,
            "alert": curr_stock <= p.reorder_point,
            "suggested_order_qty": max(0.0, (p.reorder_point * 2) - curr_stock)
        })
    return rules

@router.get("/{product_id}", response_model=schemas.ProductResponse)
async def get_product_details(product_id: int, db: AsyncSession = Depends(get_db)):
    query = (
        select(models.Product)
        .options(
            selectinload(models.Product.quants).joinedload(models.StockQuant.location).joinedload(models.Location.warehouse)
        )
        .where(models.Product.id == product_id)
    )
    result = await db.execute(query)
    p = result.scalars().first()
    if not p:
        raise HTTPException(status_code=404, detail="Product not found")

    total_stock = sum(q.quantity for q in p.quants)
    quants_out = [
        schemas.StockQuantResponse(
            id=q.id,
            product_id=q.product_id,
            location_id=q.location_id,
            quantity=q.quantity,
            location_name=q.location.name if q.location else None,
            warehouse_name=q.location.warehouse.name if q.location and q.location.warehouse else None
        )
        for q in p.quants
    ]
    return schemas.ProductResponse(
        id=p.id,
        name=p.name,
        sku=p.sku,
        category=p.category,
        uom=p.uom,
        reorder_point=p.reorder_point,
        created_at=p.created_at,
        total_stock=total_stock,
        is_low_stock=total_stock <= p.reorder_point,
        quants=quants_out
    )

@router.put("/{product_id}", response_model=schemas.ProductResponse)
async def update_product(product_id: int, update: schemas.ProductUpdate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(models.Product).where(models.Product.id == product_id))
    p = result.scalars().first()
    if not p:
        raise HTTPException(status_code=404, detail="Product not found")
        
    if update.name is not None:
        p.name = update.name
    if update.category is not None:
        p.category = update.category
    if update.uom is not None:
        p.uom = update.uom
    if update.reorder_point is not None:
        p.reorder_point = update.reorder_point

    await db.commit()
    await db.refresh(p)
    return await get_product_details(product_id, db)
