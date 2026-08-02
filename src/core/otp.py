import random
import string
import time
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
import os
from typing import Dict, Tuple

# Simple in-memory store for OTPs (email -> (otp, expiry_time, intent))
# In a production environment, use Redis or a database.
otp_store: Dict[str, Tuple[str, float, str]] = {}

OTP_EXPIRY_SECONDS = 300  # 5 minutes

# SMTP Configuration (should be in env vars or config.py)
SMTP_HOST = os.getenv("SMTP_HOST", "")
SMTP_PORT = int(os.getenv("SMTP_PORT", 587))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASS = os.getenv("SMTP_PASS", "")

def generate_otp(email: str, intent: str) -> str:
    """Generate a 6-digit OTP for a specific intent (verify or reset)."""
    otp = ''.join(random.choices(string.digits, k=6))
    expiry = time.time() + OTP_EXPIRY_SECONDS
    otp_store[email] = (otp, expiry, intent)
    return otp

def verify_otp(email: str, otp: str, intent: str) -> bool:
    """Verify if the OTP is correct, unexpired, and matches the intent."""
    if email in otp_store:
        stored_otp, expiry, stored_intent = otp_store[email]
        if time.time() < expiry and stored_otp == otp and stored_intent == intent:
            del otp_store[email]  # Invalidate OTP after successful use
            return True
    return False

def send_otp_email(email: str, otp: str, subject: str):
    """Send the OTP via email."""
    body = f"""
    Hello,
    
    Your One-Time Password (OTP) for the DIBL IOT platform is:
    
    {otp}
    
    This code will expire in 5 minutes. If you did not request this, please ignore this email.
    """
    
    if not SMTP_HOST or not SMTP_USER or not SMTP_PASS:
        # Fallback for local testing if SMTP is not configured
        print("="*40)
        print(f"MOCK EMAIL TO: {email}")
        print(f"SUBJECT: {subject}")
        print(f"BODY:\n{body}")
        print("="*40)
        return

    try:
        msg = MIMEMultipart()
        msg['From'] = SMTP_USER
        msg['To'] = email
        msg['Subject'] = subject
        msg.attach(MIMEText(body, 'plain'))
        
        server = smtplib.SMTP(SMTP_HOST, SMTP_PORT)
        server.starttls()
        server.login(SMTP_USER, SMTP_PASS)
        server.send_message(msg)
        server.quit()
    except Exception as e:
        print(f"Failed to send OTP email: {e}")
