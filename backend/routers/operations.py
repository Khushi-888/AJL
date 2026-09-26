from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List, Optional
from backend.database import get_db
from backend import schemas, crud, models

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
    location_id: Optional[int] = Query(None),
    search: Optional[str] = Query(None),
    limit: int = 100,
    db: AsyncSession = Depends(get_db)
):
    """List documents with dynamic filters matching PDF specifications."""
    return await crud.list_documents(
        db, doc_type=doc_type, status=status, location_id=location_id, search=search, limit=limit
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
