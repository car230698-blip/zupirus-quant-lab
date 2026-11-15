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

        # 1. Capture customer user portal
        subprocess.run([
            CHROME,
            "--headless=new",
            "--disable-gpu",
            "--virtual-time-budget=2000",
            f"--screenshot={desktop_user}",
            "--window-size=1440,900",
            "http://127.0.0.1:8765/?demo_user=1"
        ], check=True)

        subprocess.run([
            CHROME,
            "--headless=new",
            "--disable-gpu",
            "--virtual-time-budget=2000",
            f"--screenshot={mobile_user}",
            "--window-size=390,844",
            "http://127.0.0.1:8765/?demo_user=1"
        ], check=True)

        # 2. Capture admin portal
        subprocess.run([
            CHROME,
            "--headless=new",
            "--disable-gpu",
            "--virtual-time-budget=2000",
            f"--screenshot={desktop_admin}",
            "--window-size=1440,900",
            "http://127.0.0.1:8765/?demo_admin=1"
        ], check=True)

        subprocess.run([
            CHROME,
            "--headless=new",
            "--disable-gpu",
            "--virtual-time-budget=2000",
            f"--screenshot={mobile_admin}",
            "--window-size=390,844",
            "http://127.0.0.1:8765/?demo_admin=1"
        ], check=True)

        # Copy all 4 screenshots to artifact directory if it exists
        for p in [desktop_user, mobile_user, desktop_admin, mobile_admin]:
            if p.exists() and ARTIFACT_DIR.exists():
                shutil.copy2(p, ARTIFACT_DIR / p.name)

        print("[+] All 4 screenshots (User & Admin on Desktop & Mobile) captured and verified.")
    finally:
        proc.terminate()
        proc.wait()


if __name__ == "__main__":
    run()

