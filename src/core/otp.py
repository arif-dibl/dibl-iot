import os
import time
import random
import smtplib
from email.message import EmailMessage

# In-memory store for OTPs
# Format: { "email@example.com": { "otp": "123456", "expires_at": 1690000000, "purpose": "verify|reset" } }
otp_store = {}

# Expiry time for OTP in seconds (5 minutes)
OTP_EXPIRY_SECONDS = 300

def cleanup_expired_otps():
    """Removes expired OTPs from memory."""
    current_time = time.time()
    expired_keys = [k for k, v in otp_store.items() if v["expires_at"] < current_time]
    for k in expired_keys:
        del otp_store[k]

def generate_otp(email: str, purpose: str) -> str:
    """Generates a 6-digit OTP, stores it with expiry, and returns it."""
    cleanup_expired_otps()
    otp = str(random.randint(100000, 999999))
    otp_store[email] = {
        "otp": otp,
        "expires_at": time.time() + OTP_EXPIRY_SECONDS,
        "purpose": purpose
    }
    return otp

def verify_otp(email: str, otp: str, purpose: str) -> bool:
    """Verifies the given OTP against the store. Consumes it if successful."""
    cleanup_expired_otps()
    if email in otp_store:
        record = otp_store[email]
        if record["otp"] == otp and record["purpose"] == purpose:
            del otp_store[email]  # Consume the OTP so it can't be reused
            return True
    return False

def send_otp_email(to_email: str, otp: str, subject: str = "Your OTP Code"):
    """
    Sends an OTP email using standard SMTP.
    If SMTP variables are missing, it mocks the sending by printing to console.
    """
    smtp_host = os.getenv("SMTP_HOST")
    smtp_port = os.getenv("SMTP_PORT")
    smtp_user = os.getenv("SMTP_USER")
    smtp_pass = os.getenv("SMTP_PASS")

    if not all([smtp_host, smtp_port, smtp_user, smtp_pass]):
        print(f"\n[MOCK EMAIL] To: {to_email} | Subject: {subject} | OTP: {otp}")
        print("[MOCK EMAIL] Please configure SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS to send real emails.\n")
        return True

    try:
        msg = EmailMessage()
        msg.set_content(f"Your One-Time Password (OTP) is: {otp}\nThis code will expire in 5 minutes.")
        msg['Subject'] = subject
        msg['From'] = smtp_user
        msg['To'] = to_email

        with smtplib.SMTP(smtp_host, int(smtp_port)) as server:
            server.starttls()
            server.login(smtp_user, smtp_pass)
            server.send_message(msg)
        return True
    except Exception as e:
        print(f"[OTP EMAIL ERROR] Failed to send email to {to_email}: {e}")
        return False
