from sqlalchemy import Column, Integer, String, Float, Boolean, ForeignKey, DateTime, Enum, CheckConstraint, Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import enum
from backend.database import Base

class RoleEnum(str, enum.Enum):
    manager = "manager"
    staff = "staff"

class DocumentTypeEnum(str, enum.Enum):
    receipt = "receipt"
    delivery = "delivery"
    transfer = "transfer"
    adjustment = "adjustment"

class DocumentStatusEnum(str, enum.Enum):
    draft = "draft"
    waiting = "waiting"
    ready = "ready"
    done = "done"
    canceled = "canceled"

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=True)
    email = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    role = Column(Enum(RoleEnum), default=RoleEnum.staff, nullable=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

class Warehouse(Base):
    __tablename__ = "warehouses"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    code = Column(String, unique=True, index=True, nullable=True)
    address = Column(String, nullable=True)

    locations = relationship("Location", back_populates="warehouse", cascade="all, delete-orphan")

class Location(Base):
    __tablename__ = "locations"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    warehouse_id = Column(Integer, ForeignKey("warehouses.id"), nullable=False)
    location_type = Column(String, default="internal") # internal, vendor, customer, production, loss
    
    warehouse = relationship("Warehouse", back_populates="locations")
    quants = relationship("StockQuant", back_populates="location", cascade="all, delete-orphan")

class Product(Base):
    __tablename__ = "products"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    sku = Column(String, unique=True, index=True, nullable=False)
    category = Column(String, default="General")
    uom = Column(String, default="Units")  # Unit of Measure (Units, kg, m, L, etc.)
    reorder_point = Column(Float, default=10.0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    quants = relationship("StockQuant", back_populates="product", cascade="all, delete-orphan")
    ledger_entries = relationship("StockLedger", back_populates="product", cascade="all, delete-orphan")

class StockQuant(Base):
    """Current stock quantity per product per location"""
    __tablename__ = "stock_quants"

    id = Column(Integer, primary_key=True, index=True)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False)
    location_id = Column(Integer, ForeignKey("locations.id"), nullable=False)
    quantity = Column(Float, default=0.0, nullable=False)

    __table_args__ = (
        CheckConstraint('quantity >= 0', name='check_quantity_non_negative'),
    )

    product = relationship("Product", back_populates="quants")
    location = relationship("Location", back_populates="quants")

class Document(Base):
    """Receipts, Deliveries, Transfers, Adjustments"""
    __tablename__ = "documents"

    id = Column(Integer, primary_key=True, index=True)
    reference = Column(String, unique=True, index=True, nullable=False)
    doc_type = Column(Enum(DocumentTypeEnum), nullable=False)
    status = Column(Enum(DocumentStatusEnum), default=DocumentStatusEnum.draft, nullable=False)
    partner_name = Column(String, nullable=True) # Supplier (for receipt) or Customer (for delivery)
    source_location_id = Column(Integer, ForeignKey("locations.id"), nullable=True)
    dest_location_id = Column(Integer, ForeignKey("locations.id"), nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    
    source_location = relationship("Location", foreign_keys=[source_location_id])
    dest_location = relationship("Location", foreign_keys=[dest_location_id])
    lines = relationship("DocumentLine", back_populates="document", cascade="all, delete-orphan")

class DocumentLine(Base):
    __tablename__ = "document_lines"

    id = Column(Integer, primary_key=True, index=True)
    document_id = Column(Integer, ForeignKey("documents.id"), nullable=False)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False)
    quantity = Column(Float, nullable=False)
    source_location_id = Column(Integer, ForeignKey("locations.id"), nullable=True)
    dest_location_id = Column(Integer, ForeignKey("locations.id"), nullable=True)

    document = relationship("Document", back_populates="lines")
    product = relationship("Product")
    source_location = relationship("Location", foreign_keys=[source_location_id])
    dest_location = relationship("Location", foreign_keys=[dest_location_id])

class StockLedger(Base):
    """Append-only history of all stock movements (Move History)"""
    __tablename__ = "stock_ledger"

    id = Column(Integer, primary_key=True, index=True)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False)
    location_id = Column(Integer, ForeignKey("locations.id"), nullable=False)
    document_id = Column(Integer, ForeignKey("documents.id"), nullable=True)
    reference = Column(String, nullable=True)
    quantity_change = Column(Float, nullable=False) # positive for stock in, negative for stock out
    balance_after = Column(Float, nullable=True)
    note = Column(String, nullable=True)
    timestamp = Column(DateTime(timezone=True), server_default=func.now())
    
    product = relationship("Product", back_populates="ledger_entries")
    location = relationship("Location")
    document = relationship("Document")
