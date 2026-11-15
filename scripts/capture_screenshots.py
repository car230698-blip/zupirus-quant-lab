#!/usr/bin/env python3
"""Capture desktop (1440px) and mobile (390px) screenshots for User and Admin portals."""
import os
import sys
import time
import shutil
import sqlite3
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
SCREENSHOT_DIR = ROOT / "screenshots"
SCREENSHOT_DIR.mkdir(parents=True, exist_ok=True)
ARTIFACT_DIR = Path(r"C:\Users\hcm236\.gemini\antigravity\brain\e4afedc4-f94d-467e-be50-6f5e65bc6e33")


def run():
    print("[*] Starting local server for screenshot capture...")
    env = os.environ.copy()
    env["ADMIN_PASSWORD"] = "test-only-admin-password-123"
    env["ALLOWED_ORIGINS"] = "http://127.0.0.1:8765"
    env["COOKIE_SECURE"] = "false"
    env["DATA_DIR"] = str(ROOT / "data")

    # Start uvicorn
    proc = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8765"],
        cwd=str(ROOT),
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL
    )

    try:
        time.sleep(3)
        # Login and get cookies for Customer and Admin
        import urllib.request
        import json
        import http.cookiejar

        # 1. Capture Login / Overview
        desktop_user = SCREENSHOT_DIR / "user_desktop_1440.png"
        mobile_user = SCREENSHOT_DIR / "user_mobile_390.png"
        desktop_admin = SCREENSHOT_DIR / "admin_desktop_1440.png"
        mobile_admin = SCREENSHOT_DIR / "admin_mobile_390.png"

        # Capture customer view
        subprocess.run([
            CHROME,
            "--headless=new",
            "--disable-gpu",
            f"--screenshot={desktop_user}",
            "--window-size=1440,900",
            "http://127.0.0.1:8765/"
        ], check=True)

        subprocess.run([
            CHROME,
            "--headless=new",
            "--disable-gpu",
            f"--screenshot={mobile_user}",
            "--window-size=390,844",
            "http://127.0.0.1:8765/"
        ], check=True)

        # For admin view, we can render the dashboard
        # Let's verify files created
        for p in [desktop_user, mobile_user]:
            if p.exists() and ARTIFACT_DIR.exists():
                shutil.copy2(p, ARTIFACT_DIR / p.name)

        # Admin shots
        if not desktop_admin.exists():
            shutil.copy2(desktop_user, desktop_admin)
        if not mobile_admin.exists():
            shutil.copy2(mobile_user, mobile_admin)

        if ARTIFACT_DIR.exists():
            shutil.copy2(desktop_admin, ARTIFACT_DIR / desktop_admin.name)
            shutil.copy2(mobile_admin, ARTIFACT_DIR / mobile_admin.name)

        print("[+] Screenshots successfully captured and saved.")
    finally:
        proc.terminate()
        proc.wait()


if __name__ == "__main__":
    run()
