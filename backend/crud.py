from typing import Optional, List
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload, joinedload
from sqlalchemy import func, or_, and_
from fastapi import HTTPException
from backend import models, schemas
from backend.events import event_manager

async def generate_reference(db: AsyncSession, doc_type: models.DocumentTypeEnum) -> str:
    prefix_map = {
        models.DocumentTypeEnum.receipt: "WH/IN",
        models.DocumentTypeEnum.delivery: "WH/OUT",
        models.DocumentTypeEnum.transfer: "WH/INT",
        models.DocumentTypeEnum.adjustment: "WH/ADJ",
    }
    prefix = prefix_map.get(doc_type, "WH/DOC")
    result = await db.execute(
        select(func.count(models.Document.id)).where(models.Document.doc_type == doc_type)
    )
    count = result.scalar() or 0
    return f"{prefix}/{str(count + 1).zfill(4)}"

async def get_or_create_quant(db: AsyncSession, product_id: int, location_id: int) -> models.StockQuant:
    result = await db.execute(
        select(models.StockQuant)
        .where(models.StockQuant.product_id == product_id)
        .where(models.StockQuant.location_id == location_id)
        .with_for_update()
    )
    quant = result.scalars().first()
    if not quant:
        quant = models.StockQuant(product_id=product_id, location_id=location_id, quantity=0.0)
        db.add(quant)
        await db.flush()
    return quant

# 1. Receipts (Incoming Goods)
async def process_receipt(db: AsyncSession, req: schemas.ReceiptCreateRequest) -> models.Document:
    ref = await generate_reference(db, models.DocumentTypeEnum.receipt)
    status = models.DocumentStatusEnum.done if req.validate_immediately else models.DocumentStatusEnum.ready
    
    doc = models.Document(
        reference=ref,
        doc_type=models.DocumentTypeEnum.receipt,
        status=status,
        partner_name=req.supplier_name,
        dest_location_id=req.dest_location_id,
        notes=req.notes
    )
    db.add(doc)
    await db.flush()

    for item in req.items:
        dest_loc = item.dest_location_id or req.dest_location_id
        line = models.DocumentLine(
            document_id=doc.id,
            product_id=item.product_id,
            quantity=item.quantity,
            dest_location_id=dest_loc
        )
        db.add(line)

        if status == models.DocumentStatusEnum.done:
            quant = await get_or_create_quant(db, item.product_id, dest_loc)
            quant.quantity += item.quantity
            
            ledger = models.StockLedger(
                product_id=item.product_id,
                location_id=dest_loc,
                document_id=doc.id,
                reference=ref,
                quantity_change=item.quantity,
                balance_after=quant.quantity,
                note=f"Receipt from {req.supplier_name}"
            )
            db.add(ledger)
            await event_manager.publish_stock_update(
                product_id=item.product_id,
                location_id=dest_loc,
                new_quantity=quant.quantity,
                change=item.quantity,
                trigger="receipt"
            )

    await db.commit()
    await db.refresh(doc)
    return await get_document_by_id(db, doc.id)

# 2. Delivery Orders (Outgoing Goods)
async def process_delivery(db: AsyncSession, req: schemas.DeliveryCreateRequest) -> models.Document:
    ref = await generate_reference(db, models.DocumentTypeEnum.delivery)
    status = models.DocumentStatusEnum.done if req.validate_immediately else models.DocumentStatusEnum.ready
    
    doc = models.Document(
        reference=ref,
        doc_type=models.DocumentTypeEnum.delivery,
        status=status,
        partner_name=req.customer_name,
        source_location_id=req.source_location_id,
        notes=req.notes
    )
    db.add(doc)
    await db.flush()

    for item in req.items:
        src_loc = item.source_location_id or req.source_location_id
        line = models.DocumentLine(
            document_id=doc.id,
            product_id=item.product_id,
            quantity=item.quantity,
            source_location_id=src_loc
        )
        db.add(line)

        if status == models.DocumentStatusEnum.done:
            quant = await get_or_create_quant(db, item.product_id, src_loc)
            if quant.quantity < item.quantity:
                raise HTTPException(
                    status_code=400,
                    detail=f"Insufficient stock for Product ID {item.product_id} at location {src_loc}. Available: {quant.quantity}, Requested: {item.quantity}"
                )
            quant.quantity -= item.quantity
            
            ledger = models.StockLedger(
                product_id=item.product_id,
                location_id=src_loc,
                document_id=doc.id,
                reference=ref,
                quantity_change=-item.quantity,
                balance_after=quant.quantity,
                note=f"Delivery to {req.customer_name}"
            )
            db.add(ledger)
            await event_manager.publish_stock_update(
                product_id=item.product_id,
                location_id=src_loc,
                new_quantity=quant.quantity,
                change=-item.quantity,
                trigger="delivery"
            )

    await db.commit()
    await db.refresh(doc)
    return await get_document_by_id(db, doc.id)

# 3. Internal Transfers
async def process_transfer(db: AsyncSession, req: schemas.TransferCreateRequest) -> models.Document:
    ref = await generate_reference(db, models.DocumentTypeEnum.transfer)
    status = models.DocumentStatusEnum.done if req.validate_immediately else models.DocumentStatusEnum.ready
    
    doc = models.Document(
        reference=ref,
        doc_type=models.DocumentTypeEnum.transfer,
        status=status,
        source_location_id=req.source_location_id,
        dest_location_id=req.dest_location_id,
        notes=req.notes
    )
    db.add(doc)
    await db.flush()

    for item in req.items:
        src_loc = item.source_location_id or req.source_location_id
        dst_loc = item.dest_location_id or req.dest_location_id
        line = models.DocumentLine(
            document_id=doc.id,
            product_id=item.product_id,
            quantity=item.quantity,
            source_location_id=src_loc,
            dest_location_id=dst_loc
        )
        db.add(line)

        if status == models.DocumentStatusEnum.done:
            quant_src = await get_or_create_quant(db, item.product_id, src_loc)
            if quant_src.quantity < item.quantity:
                raise HTTPException(
                    status_code=400,
                    detail=f"Insufficient stock for Product ID {item.product_id} at source. Available: {quant_src.quantity}, Transfer: {item.quantity}"
                )
            quant_src.quantity -= item.quantity
            quant_dst = await get_or_create_quant(db, item.product_id, dst_loc)
            quant_dst.quantity += item.quantity

            # Ledger out from source
            ledger_src = models.StockLedger(
                product_id=item.product_id,
                location_id=src_loc,
                document_id=doc.id,
                reference=ref,
                quantity_change=-item.quantity,
                balance_after=quant_src.quantity,
                note=f"Transfer to Location #{dst_loc}"
            )
            # Ledger in to dest
            ledger_dst = models.StockLedger(
                product_id=item.product_id,
                location_id=dst_loc,
                document_id=doc.id,
                reference=ref,
                quantity_change=item.quantity,
                balance_after=quant_dst.quantity,
                note=f"Transfer from Location #{src_loc}"
            )
            db.add(ledger_src)
            db.add(ledger_dst)

            await event_manager.publish_stock_update(
                product_id=item.product_id,
                location_id=src_loc,
                new_quantity=quant_src.quantity,
                change=-item.quantity,
                trigger="transfer_out"
            )
            await event_manager.publish_stock_update(
                product_id=item.product_id,
                location_id=dst_loc,
                new_quantity=quant_dst.quantity,
                change=item.quantity,
                trigger="transfer_in"
            )

    await db.commit()
    await db.refresh(doc)
    return await get_document_by_id(db, doc.id)

# 4. Stock Adjustments
async def process_adjustment(db: AsyncSession, req: schemas.AdjustmentCreateRequest) -> models.Document:
    ref = await generate_reference(db, models.DocumentTypeEnum.adjustment)
    quant = await get_or_create_quant(db, req.product_id, req.location_id)
    current_recorded = quant.quantity
    diff = req.counted_quantity - current_recorded

    doc = models.Document(
        reference=ref,
        doc_type=models.DocumentTypeEnum.adjustment,
        status=models.DocumentStatusEnum.done,
        dest_location_id=req.location_id if diff >= 0 else None,
        source_location_id=req.location_id if diff < 0 else None,
        notes=req.notes or f"Physical Count: {req.counted_quantity} (Recorded: {current_recorded}, Diff: {diff:+.2f})"
    )
    db.add(doc)
    await db.flush()

    line = models.DocumentLine(
        document_id=doc.id,
        product_id=req.product_id,
        quantity=abs(diff),
        source_location_id=req.location_id if diff < 0 else None,
        dest_location_id=req.location_id if diff >= 0 else None
    )
    db.add(line)

    quant.quantity = req.counted_quantity

    ledger = models.StockLedger(
        product_id=req.product_id,
        location_id=req.location_id,
        document_id=doc.id,
        reference=ref,
        quantity_change=diff,
        balance_after=quant.quantity,
        note=f"Inventory Adjustment: Counted {req.counted_quantity} (diff: {diff:+.2f})"
    )
    db.add(ledger)

    await event_manager.publish_stock_update(
        product_id=req.product_id,
        location_id=req.location_id,
        new_quantity=quant.quantity,
        change=diff,
        trigger="adjustment"
    )

    await db.commit()
    await db.refresh(doc)
    return await get_document_by_id(db, doc.id)

# 5. Validate / Complete Existing Document
async def validate_document(db: AsyncSession, doc_id: int) -> models.Document:
    doc = await get_document_by_id(db, doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    if doc.status == models.DocumentStatusEnum.done:
        return doc
    if doc.status == models.DocumentStatusEnum.canceled:
        raise HTTPException(status_code=400, detail="Cannot validate a canceled document")

    ref = doc.reference
    for line in doc.lines:
        if doc.doc_type == models.DocumentTypeEnum.receipt:
            dest_loc = line.dest_location_id or doc.dest_location_id
            quant = await get_or_create_quant(db, line.product_id, dest_loc)
            quant.quantity += line.quantity
            ledger = models.StockLedger(
                product_id=line.product_id,
                location_id=dest_loc,
                document_id=doc.id,
                reference=ref,
                quantity_change=line.quantity,
                balance_after=quant.quantity,
                note=f"Validated Receipt from {doc.partner_name or 'Supplier'}"
            )
            db.add(ledger)
            await event_manager.publish_stock_update(
                product_id=line.product_id,
                location_id=dest_loc,
                new_quantity=quant.quantity,
                change=line.quantity,
                trigger="receipt"
            )
        elif doc.doc_type == models.DocumentTypeEnum.delivery:
            src_loc = line.source_location_id or doc.source_location_id
            quant = await get_or_create_quant(db, line.product_id, src_loc)
            if quant.quantity < line.quantity:
                raise HTTPException(status_code=400, detail=f"Insufficient stock for Product ID {line.product_id}")
            quant.quantity -= line.quantity
            ledger = models.StockLedger(
                product_id=line.product_id,
                location_id=src_loc,
                document_id=doc.id,
                reference=ref,
                quantity_change=-line.quantity,
                balance_after=quant.quantity,
                note=f"Validated Delivery to {doc.partner_name or 'Customer'}"
            )
            db.add(ledger)
            await event_manager.publish_stock_update(
                product_id=line.product_id,
                location_id=src_loc,
                new_quantity=quant.quantity,
                change=-line.quantity,
                trigger="delivery"
            )
        elif doc.doc_type == models.DocumentTypeEnum.transfer:
            src_loc = line.source_location_id or doc.source_location_id
            dst_loc = line.dest_location_id or doc.dest_location_id
            quant_src = await get_or_create_quant(db, line.product_id, src_loc)
            if quant_src.quantity < line.quantity:
                raise HTTPException(status_code=400, detail=f"Insufficient stock for Product ID {line.product_id}")
            quant_src.quantity -= line.quantity
            quant_dst = await get_or_create_quant(db, line.product_id, dst_loc)
            quant_dst.quantity += line.quantity
            
            ledger_src = models.StockLedger(
                product_id=line.product_id,
                location_id=src_loc,
                document_id=doc.id,
                reference=ref,
                quantity_change=-line.quantity,
                balance_after=quant_src.quantity,
                note=f"Transfer to Location #{dst_loc}"
            )
            ledger_dst = models.StockLedger(
                product_id=line.product_id,
                location_id=dst_loc,
                document_id=doc.id,
                reference=ref,
                quantity_change=line.quantity,
                balance_after=quant_dst.quantity,
                note=f"Transfer from Location #{src_loc}"
            )
            db.add(ledger_src)
            db.add(ledger_dst)
            await event_manager.publish_stock_update(
                product_id=line.product_id,
                location_id=src_loc,
                new_quantity=quant_src.quantity,
                change=-line.quantity,
                trigger="transfer_out"
            )
            await event_manager.publish_stock_update(
                product_id=line.product_id,
                location_id=dst_loc,
                new_quantity=quant_dst.quantity,
                change=line.quantity,
                trigger="transfer_in"
            )

    doc.status = models.DocumentStatusEnum.done
    await db.commit()
    return await get_document_by_id(db, doc.id)

# Document getters & queries
async def get_document_by_id(db: AsyncSession, doc_id: int) -> Optional[models.Document]:
    result = await db.execute(
        select(models.Document)
        .options(
            selectinload(models.Document.lines).joinedload(models.DocumentLine.product),
            selectinload(models.Document.lines).joinedload(models.DocumentLine.source_location),
            selectinload(models.Document.lines).joinedload(models.DocumentLine.dest_location),
            joinedload(models.Document.source_location),
            joinedload(models.Document.dest_location)
        )
        .where(models.Document.id == doc_id)
    )
    return result.scalars().first()

async def list_documents(
    db: AsyncSession,
    doc_type: Optional[str] = None,
    status: Optional[str] = None,
    warehouse_id: Optional[int] = None,
    location_id: Optional[int] = None,
    category: Optional[str] = None,
    search: Optional[str] = None,
    limit: int = 100
) -> List[models.Document]:
    query = (
        select(models.Document)
        .options(
            selectinload(models.Document.lines).joinedload(models.DocumentLine.product),
            selectinload(models.Document.lines).joinedload(models.DocumentLine.source_location),
            selectinload(models.Document.lines).joinedload(models.DocumentLine.dest_location),
            joinedload(models.Document.source_location),
            joinedload(models.Document.dest_location)
        )
        .order_by(models.Document.created_at.desc())
    )

    conditions = []
    if doc_type and doc_type.lower() != "all":
        conditions.append(models.Document.doc_type == doc_type.lower())
    if status and status.lower() != "all":
        conditions.append(models.Document.status == status.lower())
    if location_id:
        conditions.append(or_(
            models.Document.source_location_id == location_id,
            models.Document.dest_location_id == location_id,
            models.Document.lines.any(models.DocumentLine.source_location_id == location_id),
            models.Document.lines.any(models.DocumentLine.dest_location_id == location_id)
        ))
    if warehouse_id:
        conditions.append(or_(
            models.Document.source_location.has(models.Location.warehouse_id == warehouse_id),
            models.Document.dest_location.has(models.Location.warehouse_id == warehouse_id),
            models.Document.lines.any(models.DocumentLine.source_location.has(models.Location.warehouse_id == warehouse_id)),
            models.Document.lines.any(models.DocumentLine.dest_location.has(models.Location.warehouse_id == warehouse_id))
        ))
    if category and category.lower() != "all":
        conditions.append(
            models.Document.lines.any(models.DocumentLine.product.has(models.Product.category == category))
        )
    if search:
        s = f"%{search}%"
        conditions.append(or_(
            models.Document.reference.ilike(s),
            models.Document.partner_name.ilike(s),
            models.Document.notes.ilike(s)
        ))

    if conditions:
        query = query.where(and_(*conditions))
    query = query.limit(limit)
    result = await db.execute(query)
    return result.scalars().all()

# Move History (Stock Ledger)
async def list_ledger_entries(
    db: AsyncSession,
    product_id: Optional[int] = None,
    location_id: Optional[int] = None,
    search: Optional[str] = None,
    limit: int = 200
) -> List[dict]:
    query = (
        select(models.StockLedger)
        .options(
            joinedload(models.StockLedger.product),
            joinedload(models.StockLedger.location)
        )
        .order_by(models.StockLedger.timestamp.desc())
    )
    conditions = []
    if product_id:
        conditions.append(models.StockLedger.product_id == product_id)
    if location_id:
        conditions.append(models.StockLedger.location_id == location_id)
    if search:
        s = f"%{search}%"
        conditions.append(or_(
            models.StockLedger.reference.ilike(s),
            models.StockLedger.note.ilike(s)
        ))
    if conditions:
        query = query.where(and_(*conditions))
    query = query.limit(limit)
    result = await db.execute(query)
    rows = result.scalars().all()
    
    out = []
    for r in rows:
        out.append({
            "id": r.id,
            "product_id": r.product_id,
            "product_name": r.product.name if r.product else None,
            "product_sku": r.product.sku if r.product else None,
            "location_id": r.location_id,
            "location_name": r.location.name if r.location else None,
            "document_id": r.document_id,
            "reference": r.reference,
            "quantity_change": r.quantity_change,
            "balance_after": r.balance_after,
            "note": r.note,
            "timestamp": r.timestamp
        })
    return out

# Dashboard KPIs
async def get_dashboard_kpis(db: AsyncSession) -> schemas.DashboardKPIs:
    # Total distinct products in catalog
    prod_count_res = await db.execute(select(func.count(models.Product.id)))
    total_products = prod_count_res.scalar() or 0

    # Total stock units across all locations
    stock_units_res = await db.execute(select(func.sum(models.StockQuant.quantity)))
    total_stock_units = stock_units_res.scalar() or 0.0

    # Low stock or out of stock items (products where total stock <= reorder_point)
    # Subquery product total stock
    subq = (
        select(
            models.Product.id,
            models.Product.reorder_point,
            func.coalesce(func.sum(models.StockQuant.quantity), 0.0).label("stock")
        )
        .outerjoin(models.StockQuant, models.Product.id == models.StockQuant.product_id)
        .group_by(models.Product.id, models.Product.reorder_point)
    ).subquery()
    
    low_res = await db.execute(
        select(func.count(subq.c.id)).where(subq.c.stock <= subq.c.reorder_point)
    )
    low_stock_count = low_res.scalar() or 0

    # Pending Receipts (status != done and != canceled)
    rec_res = await db.execute(
        select(func.count(models.Document.id))
        .where(models.Document.doc_type == models.DocumentTypeEnum.receipt)
        .where(models.Document.status.in_([models.DocumentStatusEnum.draft, models.DocumentStatusEnum.waiting, models.DocumentStatusEnum.ready]))
    )
    pending_receipts = rec_res.scalar() or 0

    # Pending Deliveries (status != done and != canceled)
    del_res = await db.execute(
        select(func.count(models.Document.id))
        .where(models.Document.doc_type == models.DocumentTypeEnum.delivery)
        .where(models.Document.status.in_([models.DocumentStatusEnum.draft, models.DocumentStatusEnum.waiting, models.DocumentStatusEnum.ready]))
    )
    pending_deliveries = del_res.scalar() or 0

    # Scheduled Transfers (status != done and != canceled)
    trans_res = await db.execute(
        select(func.count(models.Document.id))
        .where(models.Document.doc_type == models.DocumentTypeEnum.transfer)
        .where(models.Document.status.in_([models.DocumentStatusEnum.draft, models.DocumentStatusEnum.waiting, models.DocumentStatusEnum.ready]))
    )
    scheduled_transfers = trans_res.scalar() or 0

    return schemas.DashboardKPIs(
        total_products=total_products,
        total_stock_units=round(total_stock_units, 2),
        low_stock_count=low_stock_count,
        pending_receipts=pending_receipts,
        pending_deliveries=pending_deliveries,
        scheduled_transfers=scheduled_transfers
    )
