from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import List, Optional
from backend.database import get_db
from backend import schemas, crud, models
from backend.events import event_manager

router = APIRouter(prefix="/operations", tags=["Operations"])

@router.post("/receipt", response_model=schemas.DocumentResponse)
async def create_receipt(req: schemas.ReceiptCreateRequest, db: AsyncSession = Depends(get_db)):
    """1. Receipts (Incoming Goods): Vendor -> Increase stock automatically."""
    try:
        return await crud.process_receipt(db, req)
    except HTTPException:
        await db.rollback()
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=400, detail=str(e))

@router.post("/delivery", response_model=schemas.DocumentResponse)
async def create_delivery(req: schemas.DeliveryCreateRequest, db: AsyncSession = Depends(get_db)):
    """2. Delivery Orders (Outgoing Goods): Customer shipment -> Decrease stock."""
    try:
        return await crud.process_delivery(db, req)
    except HTTPException:
        await db.rollback()
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=400, detail=str(e))

@router.post("/transfer", response_model=schemas.DocumentResponse)
async def create_transfer(req: schemas.TransferCreateRequest, db: AsyncSession = Depends(get_db)):
    """3. Internal Transfers: Move stock inside company (e.g. Main Store -> Production Rack)."""
    try:
        return await crud.process_transfer(db, req)
    except HTTPException:
        await db.rollback()
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=400, detail=str(e))

@router.post("/adjustment", response_model=schemas.DocumentResponse)
async def create_adjustment(req: schemas.AdjustmentCreateRequest, db: AsyncSession = Depends(get_db)):
    """4. Stock Adjustments: Fix mismatches between recorded stock and physical count."""
    try:
        return await crud.process_adjustment(db, req)
    except HTTPException:
        await db.rollback()
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=400, detail=str(e))

@router.get("/documents", response_model=List[schemas.DocumentResponse])
async def get_documents(
    doc_type: Optional[str] = Query(None, description="receipt, delivery, transfer, adjustment"),
    status: Optional[str] = Query(None, description="draft, waiting, ready, done, canceled"),
    warehouse_id: Optional[int] = Query(None),
    location_id: Optional[int] = Query(None),
    category: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    limit: int = 100,
    db: AsyncSession = Depends(get_db)
):
    """List documents with dynamic filters matching PDF specifications."""
    return await crud.list_documents(
        db,
        doc_type=doc_type,
        status=status,
        warehouse_id=warehouse_id,
        location_id=location_id,
        category=category,
        search=search,
        limit=limit
    )

@router.get("/documents/{doc_id}", response_model=schemas.DocumentResponse)
async def get_document(doc_id: int, db: AsyncSession = Depends(get_db)):
    doc = await crud.get_document_by_id(db, doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    return doc

@router.post("/documents/{doc_id}/validate", response_model=schemas.DocumentResponse)
async def validate_doc(doc_id: int, db: AsyncSession = Depends(get_db)):
    """Validate a document (transitions to done and applies stock effects)."""
    try:
        return await crud.validate_document(db, doc_id)
    except HTTPException:
        await db.rollback()
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=400, detail=str(e))

@router.post("/documents/{doc_id}/status")
async def update_status(doc_id: int, new_status: str, db: AsyncSession = Depends(get_db)):
    doc = await crud.get_document_by_id(db, doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    
    if new_status == "done":
        return await crud.validate_document(db, doc_id)
    
    try:
        doc.status = models.DocumentStatusEnum(new_status)
        await db.commit()
        await db.refresh(doc)
        return doc
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=400, detail=f"Invalid status: {e}")

@router.get("/ledger", response_model=List[schemas.StockLedgerResponse])
async def get_stock_ledger(
    product_id: Optional[int] = Query(None),
    location_id: Optional[int] = Query(None),
    search: Optional[str] = Query(None),
    limit: int = 200,
    db: AsyncSession = Depends(get_db)
):
    """Move History (Stock Ledger): complete audit trail of all movements."""
    return await crud.list_ledger_entries(
        db, product_id=product_id, location_id=location_id, search=search, limit=limit
    )

@router.get("/kpis", response_model=schemas.DashboardKPIs)
async def get_kpis(db: AsyncSession = Depends(get_db)):
    """Dashboard KPIs matching PDF."""
    return await crud.get_dashboard_kpis(db)

# --- Dedicated Warehouse Staff Execution Endpoints ---

@router.get("/staff/tasks")
async def get_staff_tasks(db: AsyncSession = Depends(get_db)):
    """Task queues specifically tailored for Warehouse Staff (picking, shelving, transfers, counting)."""
    # 1. Picking tasks: pending deliveries
    del_docs = await crud.list_documents(db, doc_type="delivery", limit=50)
    del_docs = [d for d in del_docs if d.status != models.DocumentStatusEnum.done and d.status != models.DocumentStatusEnum.canceled]
    
    picking_tasks = []
    for d in del_docs:
        for l in d.lines:
            picking_tasks.append({
                "document_id": d.id,
                "reference": d.reference,
                "customer": d.partner_name or "Customer Dispatch",
                "product_id": l.product_id,
                "product_name": l.product.name if l.product else "Item",
                "sku": l.product.sku if l.product else "-",
                "quantity": l.quantity,
                "uom": l.product.uom if l.product else "Units",
                "source_location": d.source_location.name if d.source_location else "Main Store",
                "status": d.status
            })

    # 2. Shelving tasks: received items waiting to be put away onto racks
    rec_docs = await crud.list_documents(db, doc_type="receipt", limit=50)
    shelving_tasks = []
    for d in rec_docs:
        if d.status != models.DocumentStatusEnum.canceled:
            for l in d.lines:
                shelving_tasks.append({
                    "document_id": d.id,
                    "reference": d.reference,
                    "supplier": d.partner_name or "Supplier",
                    "product_id": l.product_id,
                    "product_name": l.product.name if l.product else "Item",
                    "sku": l.product.sku if l.product else "-",
                    "quantity": l.quantity,
                    "uom": l.product.uom if l.product else "Units",
                    "from_dock": "Inbound Receiving Dock",
                    "dest_location_id": l.dest_location_id or d.dest_location_id,
                    "dest_location": l.dest_location.name if l.dest_location else (d.dest_location.name if d.dest_location else "Main Store"),
                    "status": "Ready to Shelve"
                })

    # 3. Transfer tasks: scheduled internal moves
    tra_docs = await crud.list_documents(db, doc_type="transfer", limit=50)
    transfer_tasks = []
    for d in tra_docs:
        if d.status != models.DocumentStatusEnum.done and d.status != models.DocumentStatusEnum.canceled:
            for l in d.lines:
                transfer_tasks.append({
                    "document_id": d.id,
                    "reference": d.reference,
                    "product_id": l.product_id,
                    "product_name": l.product.name if l.product else "Item",
                    "sku": l.product.sku if l.product else "-",
                    "quantity": l.quantity,
                    "uom": l.product.uom if l.product else "Units",
                    "from_location": d.source_location.name if d.source_location else "Shelf A",
                    "to_location": d.dest_location.name if d.dest_location else "Shelf B",
                    "status": d.status
                })

    # 4. Counting tasks: products needing physical cycle count
    from sqlalchemy.orm import selectinload
    prods_res = await db.execute(
        select(models.Product).options(selectinload(models.Product.quants)).order_by(models.Product.name.asc())
    )
    prods = prods_res.scalars().all()
    counting_tasks = []
    for p in prods:
        curr_stock = sum(q.quantity for q in p.quants)
        counting_tasks.append({
            "product_id": p.id,
            "product_name": p.name,
            "sku": p.sku,
            "uom": p.uom,
            "recorded_stock": curr_stock,
            "reorder_point": p.reorder_point,
            "needs_attention": curr_stock <= p.reorder_point
        })

    return {
        "picking_tasks": picking_tasks,
        "shelving_tasks": shelving_tasks,
        "transfer_tasks": transfer_tasks,
        "counting_tasks": counting_tasks,
        "metrics": {
            "pending_picking": len(picking_tasks),
            "pending_shelving": len(shelving_tasks),
            "pending_transfers": len(transfer_tasks),
            "pending_counts": len([c for c in counting_tasks if c["needs_attention"]])
        }
    }

@router.post("/staff/pick")
async def staff_pick_item(req: schemas.StaffPickRequest, db: AsyncSession = Depends(get_db)):
    """Staff confirms picking & packing goods from shelf."""
    try:
        return await crud.validate_document(db, req.document_id)
    except HTTPException:
        await db.rollback()
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=400, detail=str(e))

@router.post("/staff/shelve")
async def staff_shelve_item(req: schemas.StaffShelveRequest, db: AsyncSession = Depends(get_db)):
    """Staff puts away received material from Inbound Dock onto a target rack."""
    try:
        # Move into quant of target rack
        quant = await crud.get_or_create_quant(db, req.product_id, req.dest_location_id)
        quant.quantity += req.quantity
        
        # Log to Stock Ledger
        loc = await db.get(models.Location, req.dest_location_id)
        prod = await db.get(models.Product, req.product_id)
        loc_name = loc.name if loc else f"Loc #{req.dest_location_id}"
        ref = f"SHELVE/{loc_name.replace(' ', '_').upper()}"
        
        ledger = models.StockLedger(
            product_id=req.product_id,
            location_id=req.dest_location_id,
            reference=ref,
            quantity_change=req.quantity,
            balance_after=quant.quantity,
            note=req.notes or f"Staff shelved {req.quantity} {prod.uom if prod else 'units'} to {loc_name}"
        )
        db.add(ledger)
        await event_manager.publish_stock_update(
            product_id=req.product_id,
            location_id=req.dest_location_id,
            new_quantity=quant.quantity,
            change=req.quantity,
            trigger="shelve"
        )
        await db.commit()
        await db.refresh(quant)
        return {
            "status": "success",
            "message": f"Successfully shelved {req.quantity} units to {loc_name}",
            "new_balance": quant.quantity
        }
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=400, detail=str(e))

@router.post("/staff/count")
async def staff_count_item(req: schemas.StaffCountRequest, db: AsyncSession = Depends(get_db)):
    """Staff submits physical stock count, recording delta in ledger."""
    try:
        adj_req = schemas.AdjustmentCreateRequest(
            product_id=req.product_id,
            location_id=req.location_id,
            counted_quantity=req.counted_quantity,
            notes=req.notes or "Physical cycle count by warehouse staff"
        )
        return await crud.process_adjustment(db, adj_req)
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=400, detail=str(e))

@router.post("/staff/transfer")
async def staff_transfer_item(req: schemas.StaffTransferRequest, db: AsyncSession = Depends(get_db)):
    """Staff executes internal transfer between shelves/locations."""
    try:
        tra_req = schemas.TransferCreateRequest(
            source_location_id=req.source_location_id,
            dest_location_id=req.dest_location_id,
            notes=req.notes or "Internal transfer moved by warehouse staff",
            items=[
                schemas.DocumentLineCreate(
                    product_id=req.product_id,
                    quantity=req.quantity,
                    source_location_id=req.source_location_id,
                    dest_location_id=req.dest_location_id
                )
            ],
            validate_immediately=True
        )
        return await crud.process_transfer(db, tra_req)
    except HTTPException:
        await db.rollback()
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=400, detail=str(e))

@router.post("/staff/transfer-doc/{doc_id}")
async def staff_execute_transfer_doc(doc_id: int, db: AsyncSession = Depends(get_db)):
    """Staff executes and confirms a scheduled internal transfer document."""
    try:
        return await crud.validate_document(db, doc_id)
    except HTTPException:
        await db.rollback()
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=400, detail=str(e))

@router.post("/reset-demo")
async def reset_demo_data():
    """Reset PostgreSQL database to clean seed state matching the PDF problem statement."""
    from backend.seed import seed_data
    try:
        await seed_data()
        return {"status": "success", "message": "StockSense database reset to initial demo state successfully!"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to reset demo: {str(e)}")


