import asyncio
from backend.database import engine, AsyncSessionLocal, Base
from backend import models, auth

async def seed_data(drop=False):
    # 1. Ensure all tables exist in PostgreSQL
    async with engine.begin() as conn:
        if drop:
            await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    print("Database tables ensured successfully in PostgreSQL!")

    async with AsyncSessionLocal() as db:
        # 2. Users (Inventory Manager and Warehouse Staff)
        manager = models.User(
            name="Khushi Saharan (Manager)",
            email="manager@stocksense.com",
            hashed_password=auth.get_password_hash("admin123"),
            role=models.RoleEnum.manager,
            is_active=True
        )
        staff = models.User(
            name="Alex Rivera (Warehouse Staff)",
            email="staff@stocksense.com",
            hashed_password=auth.get_password_hash("staff123"),
            role=models.RoleEnum.staff,
            is_active=True
        )
        db.add_all([manager, staff])
        await db.flush()

        # 3. Warehouses & Locations
        wh1 = models.Warehouse(name="Main Warehouse", code="WH-MAIN", address="Industrial Area Phase 1")
        wh2 = models.Warehouse(name="Warehouse 2", code="WH-NORTH", address="Logistics Hub North")
        db.add_all([wh1, wh2])
        await db.flush()

        loc_store = models.Location(name="Main Store", warehouse_id=wh1.id, location_type="internal")
        loc_prod = models.Location(name="Production Rack", warehouse_id=wh1.id, location_type="internal")
        loc_rack_a = models.Location(name="Rack A", warehouse_id=wh1.id, location_type="internal")
        loc_rack_b = models.Location(name="Rack B", warehouse_id=wh1.id, location_type="internal")
        loc_wh2 = models.Location(name="Storage Yard", warehouse_id=wh2.id, location_type="internal")
        db.add_all([loc_store, loc_prod, loc_rack_a, loc_rack_b, loc_wh2])
        await db.flush()

        # 4. Products
        p_steel = models.Product(name="Steel Rods", sku="STL-ROD-01", category="Raw Materials", uom="kg", reorder_point=50.0)
        p_chair = models.Product(name="Office Chair", sku="FURN-CH-01", category="Furniture", uom="Units", reorder_point=20.0)
        p_desk = models.Product(name="Steel Desk", sku="FURN-DK-99", category="Furniture", uom="Units", reorder_point=10.0)
        p_frame = models.Product(name="Steel Frame", sku="CMP-FRM-05", category="Components", uom="Units", reorder_point=15.0)
        p_bolts = models.Product(name="Industrial Bolts", sku="HDW-BLT-100", category="Hardware", uom="Pcs", reorder_point=100.0)
        db.add_all([p_steel, p_chair, p_desk, p_frame, p_bolts])
        await db.flush()

        # 5. Initial Stock Quants
        # Steel Rods: 100 kg in Main Store
        q1 = models.StockQuant(product_id=p_steel.id, location_id=loc_store.id, quantity=100.0)
        # Office Chair: 150 units in Main Store
        q2 = models.StockQuant(product_id=p_chair.id, location_id=loc_store.id, quantity=150.0)
        # Steel Desk: 2 units in Main Store (Low stock! Alert!)
        q3 = models.StockQuant(product_id=p_desk.id, location_id=loc_store.id, quantity=2.0)
        # Steel Frame: 40 units in Production Rack
        q4 = models.StockQuant(product_id=p_frame.id, location_id=loc_prod.id, quantity=40.0)
        # Industrial Bolts: 500 pcs in Rack A
        q5 = models.StockQuant(product_id=p_bolts.id, location_id=loc_rack_a.id, quantity=500.0)
        db.add_all([q1, q2, q3, q4, q5])
        await db.flush()

        # Initial Opening Stock Ledger Entries
        db.add_all([
            models.StockLedger(product_id=p_steel.id, location_id=loc_store.id, reference="OP-INV-001", quantity_change=100.0, balance_after=100.0, note="Opening inventory"),
            models.StockLedger(product_id=p_chair.id, location_id=loc_store.id, reference="OP-INV-002", quantity_change=150.0, balance_after=150.0, note="Opening inventory"),
            models.StockLedger(product_id=p_desk.id, location_id=loc_store.id, reference="OP-INV-003", quantity_change=2.0, balance_after=2.0, note="Opening inventory (Low stock)"),
            models.StockLedger(product_id=p_frame.id, location_id=loc_prod.id, reference="OP-INV-004", quantity_change=40.0, balance_after=40.0, note="Opening inventory"),
            models.StockLedger(product_id=p_bolts.id, location_id=loc_rack_a.id, reference="OP-INV-005", quantity_change=500.0, balance_after=500.0, note="Opening inventory"),
        ])

        # 6. Sample Documents (Receipts, Deliveries, Transfers)
        # Pending Receipt from Tata Steel
        doc_rec = models.Document(
            reference="WH/IN/0001",
            doc_type=models.DocumentTypeEnum.receipt,
            status=models.DocumentStatusEnum.ready,
            partner_name="Tata Steel Ltd",
            dest_location_id=loc_store.id,
            notes="Scheduled inbound batch of steel rods"
        )
        db.add(doc_rec)
        await db.flush()
        db.add(models.DocumentLine(document_id=doc_rec.id, product_id=p_steel.id, quantity=50.0, dest_location_id=loc_store.id))

        # Pending Delivery to Apex Corp
        doc_del = models.Document(
            reference="WH/OUT/0001",
            doc_type=models.DocumentTypeEnum.delivery,
            status=models.DocumentStatusEnum.ready,
            partner_name="Apex Corp",
            source_location_id=loc_store.id,
            notes="Sales Order #8821 for 10 office chairs"
        )
        db.add(doc_del)
        await db.flush()
        db.add(models.DocumentLine(document_id=doc_del.id, product_id=p_chair.id, quantity=10.0, source_location_id=loc_store.id))

        # Scheduled Internal Transfer: Main Store -> Production Rack
        doc_trans = models.Document(
            reference="WH/INT/0001",
            doc_type=models.DocumentTypeEnum.transfer,
            status=models.DocumentStatusEnum.waiting,
            source_location_id=loc_store.id,
            dest_location_id=loc_prod.id,
            notes="Move 25 kg steel rods to production line"
        )
        db.add(doc_trans)
        await db.flush()
        db.add(models.DocumentLine(document_id=doc_trans.id, product_id=p_steel.id, quantity=25.0, source_location_id=loc_store.id, dest_location_id=loc_prod.id))

        await db.commit()
        print("StockSense seeded successfully with realistic data, users, warehouses, and operations!")

if __name__ == "__main__":
    asyncio.run(seed_data())
