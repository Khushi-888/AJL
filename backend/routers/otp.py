from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
import pyotp

from backend.events import event_manager
from backend.database import get_db
from backend import models, schemas, auth

router = APIRouter(prefix="/otp", tags=["OTP Password Reset"])

@router.post("/generate/{email}")
async def generate_otp(email: str, db: AsyncSession = Depends(get_db)):
    """Generate a TOTP for password reset and store it with 5-minute expiry."""
    # Check if user exists
    result = await db.execute(select(models.User).where(models.User.email == email))
    user = result.scalars().first()
    if not user:
        raise HTTPException(status_code=404, detail="No user found with this email address.")

    totp = pyotp.TOTP(pyotp.random_base32(), digits=6, interval=300)
    code = totp.now()
    
    # Store in cache (Redis or MemoryBus fallback) for 300 seconds
    await event_manager.set_cache(f"otp:{email}", 300, code)
    
    return {
        "message": f"OTP successfully sent to {email}",
        "code": code, # Included for ease of testing / development
        "expires_in_seconds": 300
    }

@router.post("/verify")
async def verify_otp(req: schemas.OTPVerifyRequest):
    """Verify the OTP."""
    stored_code = await event_manager.get_cache(f"otp:{req.email}")
    if not stored_code:
        raise HTTPException(status_code=400, detail="OTP expired or not requested.")
        
    if stored_code != req.code:
        raise HTTPException(status_code=400, detail="Invalid OTP code.")
        
    return {"message": "OTP verified successfully. You may now reset your password."}

@router.post("/reset-password")
async def reset_password(req: schemas.OTPResetPasswordRequest, db: AsyncSession = Depends(get_db)):
    """Verify OTP and update user password in PostgreSQL."""
    stored_code = await event_manager.get_cache(f"otp:{req.email}")
    if not stored_code:
        raise HTTPException(status_code=400, detail="OTP expired or not found. Please request a new OTP.")
        
    if stored_code != req.code:
        raise HTTPException(status_code=400, detail="Invalid OTP code.")

    result = await db.execute(select(models.User).where(models.User.email == req.email))
    user = result.scalars().first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")

    user.hashed_password = auth.get_password_hash(req.new_password)
    await db.commit()
    await event_manager.delete_cache(f"otp:{req.email}")
    
    return {"message": "Password has been successfully reset. You can now log in with your new password."}
