from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from datetime import timedelta
from pydantic import BaseModel, EmailStr
from typing import Optional

from backend import models, schemas, auth
from backend.database import get_db

router = APIRouter(prefix="/auth", tags=["Authentication"])

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login", auto_error=False)

class LoginJsonRequest(BaseModel):
    email: EmailStr
    password: str

@router.post("/register", response_model=schemas.UserResponse)
async def register(user_in: schemas.UserCreate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(models.User).where(models.User.email == user_in.email))
    existing_user = result.scalars().first()
    if existing_user:
        raise HTTPException(status_code=400, detail="Email already registered")
        
    hashed_password = auth.get_password_hash(user_in.password)
    db_user = models.User(
        name=user_in.name,
        email=user_in.email,
        hashed_password=hashed_password,
        role=user_in.role
    )
    db.add(db_user)
    await db.commit()
    await db.refresh(db_user)
    return db_user

@router.post("/login")
async def login(form_data: OAuth2PasswordRequestForm = Depends(), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(models.User).where(models.User.email == form_data.username))
    user = result.scalars().first()
    
    if not user or not auth.verify_password(form_data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
        
    access_token_expires = timedelta(minutes=auth.ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = auth.create_access_token(
        data={"sub": user.email, "role": user.role}, expires_delta=access_token_expires
    )
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": {
            "id": user.id,
            "name": user.name or user.email.split('@')[0],
            "email": user.email,
            "role": user.role
        }
    }

@router.post("/login-json")
async def login_json(req: LoginJsonRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(models.User).where(models.User.email == req.email))
    user = result.scalars().first()
    
    if not user or not auth.verify_password(req.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password"
        )
        
    access_token_expires = timedelta(minutes=auth.ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = auth.create_access_token(
        data={"sub": user.email, "role": user.role}, expires_delta=access_token_expires
    )
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": {
            "id": user.id,
            "name": user.name or user.email.split('@')[0],
            "email": user.email,
            "role": user.role
        }
    }

@router.post("/google-login")
async def google_login(req: schemas.GoogleLoginRequest, db: AsyncSession = Depends(get_db)):
    """Sign In with Google. Auto-registers user with specified role if first time."""
    result = await db.execute(select(models.User).where(models.User.email == req.email))
    user = result.scalars().first()
    
    if not user:
        import secrets
        random_pw = secrets.token_urlsafe(16)
        hashed_password = auth.get_password_hash(random_pw)
        user = models.User(
            name=req.name or req.email.split("@")[0].capitalize(),
            email=req.email,
            hashed_password=hashed_password,
            role=req.role or models.RoleEnum.staff
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)
    else:
        changed = False
        if req.role and user.role != req.role:
            user.role = req.role
            changed = True
        if req.name and (not user.name or user.name == "Inventory User"):
            user.name = req.name
            changed = True
        if changed:
            await db.commit()
            await db.refresh(user)
    
    access_token_expires = timedelta(minutes=auth.ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = auth.create_access_token(
        data={"sub": user.email, "role": user.role}, expires_delta=access_token_expires
    )
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": {
            "id": user.id,
            "name": user.name or user.email.split('@')[0],
            "email": user.email,
            "role": user.role
        }
    }

@router.post("/change-password")
async def change_password(req: schemas.ChangePasswordRequest, db: AsyncSession = Depends(get_db)):
    """Change or reset password using OTP code verification."""
    from backend.events import event_manager
    stored_code = await event_manager.get_cache(f"otp:{req.email}")
    if not stored_code:
        raise HTTPException(status_code=400, detail="OTP expired or not found. Please request a new OTP.")
        
    if stored_code != req.code:
        raise HTTPException(status_code=400, detail="Invalid OTP code.")
        
    result = await db.execute(select(models.User).where(models.User.email == req.email))
    user = result.scalars().first()
    if not user:
        raise HTTPException(status_code=404, detail="User with this email not found.")
        
    user.hashed_password = auth.get_password_hash(req.new_password)
    await db.commit()
    await event_manager.delete_cache(f"otp:{req.email}")
    
    return {"message": "Password changed successfully. You may now sign in with your new password."}

async def get_current_user(token: Optional[str] = Depends(oauth2_scheme), db: AsyncSession = Depends(get_db)) -> Optional[models.User]:
    if not token:
        return None
    try:
        payload = auth.jwt.decode(token, auth.SECRET_KEY, algorithms=[auth.ALGORITHM])
        email: str = payload.get("sub")
        if email is None:
            return None
    except Exception:
        return None
    result = await db.execute(select(models.User).where(models.User.email == email))
    return result.scalars().first()

@router.get("/me")
async def get_me(user: Optional[models.User] = Depends(get_current_user)):
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return {
        "id": user.id,
        "name": user.name,
        "email": user.email,
        "role": user.role,
        "created_at": user.created_at
    }
