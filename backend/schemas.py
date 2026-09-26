from pydantic import BaseModel, Field, EmailStr
from typing import Optional, List
from datetime import datetime
from backend.models import RoleEnum, DocumentTypeEnum, DocumentStatusEnum

# --- User Schemas ---
class UserCreate(BaseModel):
    name: Optional[str] = "Inventory User"
    email: EmailStr
    password: str
    role: RoleEnum = RoleEnum.staff

class UserResponse(BaseModel):
    id: int
    name: Optional[str]
    email: EmailStr
    role: RoleEnum
    is_active: bool
    created_at: Optional[datetime]

    class Config:
        from_attributes = True

# --- Warehouse & Location Schemas ---
class WarehouseBase(BaseModel):
    name: str
    code: Optional[str] = None
    address: Optional[str] = None

class WarehouseCreate(WarehouseBase):
    pass

class LocationBase(BaseModel):
    name: str
    warehouse_id: int
    location_type: Optional[str] = "internal"

class LocationCreate(LocationBase):
    pass

class LocationResponse(LocationBase):
    id: int

    class Config:
        from_attributes = True

class WarehouseResponse(WarehouseBase):
    id: int
    locations: List[LocationResponse] = []

    class Config:
        from_attributes = True

# --- Product Schemas ---
class ProductBase(BaseModel):
    name: str
    sku: str
    category: Optional[str] = "General"
    uom: str = "Units"
    reorder_point: float = 10.0

class ProductCreate(ProductBase):
    initial_stock: Optional[float] = 0.0
    initial_location_id: Optional[int] = None

class ProductUpdate(BaseModel):
    name: Optional[str] = None
    category: Optional[str] = None
    uom: Optional[str] = None
    reorder_point: Optional[float] = None

class StockQuantResponse(BaseModel):
    id: int
    product_id: int
    location_id: int
    quantity: float
    location_name: Optional[str] = None
    warehouse_name: Optional[str] = None

    class Config:
        from_attributes = True

class ProductResponse(ProductBase):
    id: int
    created_at: Optional[datetime]
    total_stock: float = 0.0
    is_low_stock: bool = False
    quants: List[StockQuantResponse] = []

    class Config:
        from_attributes = True

# --- Document Line Schemas ---
class DocumentLineCreate(BaseModel):
    product_id: int
    quantity: float = Field(..., gt=0)
    source_location_id: Optional[int] = None
    dest_location_id: Optional[int] = None

class DocumentLineResponse(BaseModel):
    id: int
    document_id: int
    product_id: int
    product_name: Optional[str] = None
    product_sku: Optional[str] = None
    quantity: float
    source_location_id: Optional[int] = None
    dest_location_id: Optional[int] = None
    source_location_name: Optional[str] = None
    dest_location_name: Optional[str] = None

    class Config:
        from_attributes = True

# --- Document Schemas ---
class DocumentCreate(BaseModel):
    doc_type: DocumentTypeEnum
    partner_name: Optional[str] = None
    source_location_id: Optional[int] = None
    dest_location_id: Optional[int] = None
    notes: Optional[str] = None
    status: DocumentStatusEnum = DocumentStatusEnum.draft
    lines: List[DocumentLineCreate]

class DocumentResponse(BaseModel):
    id: int
    reference: str
    doc_type: DocumentTypeEnum
    status: DocumentStatusEnum
    partner_name: Optional[str] = None
    source_location_id: Optional[int] = None
    dest_location_id: Optional[int] = None
    notes: Optional[str] = None
    created_at: datetime
    updated_at: Optional[datetime] = None
    lines: List[DocumentLineResponse] = []

    class Config:
        from_attributes = True

# Specialized Operation Request Schemas
class ReceiptCreateRequest(BaseModel):
    supplier_name: str
    dest_location_id: int
    notes: Optional[str] = None
    items: List[DocumentLineCreate]
    validate_immediately: bool = True

class DeliveryCreateRequest(BaseModel):
    customer_name: str
    source_location_id: int
    notes: Optional[str] = None
    items: List[DocumentLineCreate]
    validate_immediately: bool = True

class TransferCreateRequest(BaseModel):
    source_location_id: int
    dest_location_id: int
    notes: Optional[str] = None
    items: List[DocumentLineCreate]
    validate_immediately: bool = True

class AdjustmentCreateRequest(BaseModel):
    product_id: int
    location_id: int
    counted_quantity: float
    notes: Optional[str] = None

# --- Stock Ledger Schema ---
class StockLedgerResponse(BaseModel):
    id: int
    product_id: int
    product_name: Optional[str] = None
    product_sku: Optional[str] = None
    location_id: int
    location_name: Optional[str] = None
    document_id: Optional[int] = None
    reference: Optional[str] = None
    quantity_change: float
    balance_after: Optional[float] = None
    note: Optional[str] = None
    timestamp: datetime

    class Config:
        from_attributes = True

# --- Dashboard Schemas ---
class DashboardKPIs(BaseModel):
    total_products: int
    total_stock_units: float
    low_stock_count: int
    pending_receipts: int
    pending_deliveries: int
    scheduled_transfers: int

# --- OTP Schemas ---
class OTPVerifyRequest(BaseModel):
    email: EmailStr
    code: str

class OTPResetPasswordRequest(BaseModel):
    email: EmailStr
    code: str
    new_password: str

# --- Google Login & Password Change ---
class GoogleLoginRequest(BaseModel):
    email: EmailStr
    name: Optional[str] = "Google User"
    role: Optional[RoleEnum] = RoleEnum.staff
    google_id: Optional[str] = None

class ChangePasswordRequest(BaseModel):
    email: EmailStr
    code: str
    new_password: str

# --- Staff Operational Workbench Schemas ---
class StaffShelveRequest(BaseModel):
    product_id: int
    quantity: float = Field(..., gt=0)
    dest_location_id: int
    notes: Optional[str] = "Shelved to rack by warehouse staff"

class StaffPickRequest(BaseModel):
    document_id: int
    notes: Optional[str] = "Picked and packed by warehouse staff"

class StaffCountRequest(BaseModel):
    product_id: int
    location_id: int
    counted_quantity: float
    notes: Optional[str] = "Physical count entered by warehouse staff"

class StaffTransferRequest(BaseModel):
    product_id: int
    quantity: float = Field(..., gt=0)
    source_location_id: int
    dest_location_id: int
    notes: Optional[str] = "Inter-rack transfer executed by warehouse staff"

class StaffTaskItem(BaseModel):
    id: int
    type: str # 'shelve', 'pick', 'transfer', 'count'
    title: str
    description: str
    quantity: float
    uom: str
    location_from: Optional[str] = None
    location_to: Optional[str] = None
    document_reference: Optional[str] = None
    status: str

