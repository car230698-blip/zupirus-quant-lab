#!/usr/bin/env python3
"""Exercise the built portals against an isolated FastAPI instance and capture each role."""
import argparse
import hashlib
import os
from pathlib import Path
import secrets
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time
import urllib.request

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]


def select_tab(page, label):
    page.get_by_role('navigation', name='Menu chính').get_by_role('button', name=label, exact=True).click()


def sign_in(page, base, role, password):
    page.goto(base + ('/?portal=admin' if role == 'admin' else '/'))
    if role == 'user':
        page.get_by_role('button', name='Chưa có tài khoản? Đăng ký').click()
    email = 'admin@zupirus.local' if role == 'admin' else 'reviewer@example.test'
    page.get_by_label('Email', exact=True).fill(email)
    page.get_by_label('Mật khẩu', exact=True).fill(password)
    page.locator('form button[type=submit], form .quant-primary').click()
    expect(page.get_by_role('navigation', name='Menu chính')).to_be_visible()
    expect(page.get_by_text('Đang tải dữ liệu…', exact=True)).to_have_count(0)


def seed_order(db_path):
    now = time.time()
    with sqlite3.connect(db_path) as connection:
        account_id, = connection.execute("""
            SELECT a.id FROM accounts a JOIN users u ON u.id = a.user_id
            WHERE u.email = 'reviewer@example.test' AND a.login = '123456'
        """).fetchone()
        connection.execute("""
            INSERT INTO signals(id, source, side, price, sl, tp, created, expires)
            VALUES ('ui-verification-order', 'DEMO', 'BUY', 2600, 2590.12, 2630.34, ?, ?)
        """, (now, now + 900))
        connection.execute("""
            INSERT INTO dispatches(account_id, signal_id, state, reason, created, updated)
            VALUES (?, 'ui-verification-order', 'unknown', 'ui-verification-reason', ?, ?)
        """, (account_id, now, now))


def verify_user(page, base, db_path):
    select_tab(page, 'Tài khoản MT5')
    page.get_by_label('Số đăng nhập MT5').fill('123456')
    page.get_by_label('Máy chủ MT5').fill('Broker-Test')
    page.get_by_role('button', name='Tạo & Sinh Mã Ghép Nối', exact=False).click()
    expect(page.get_by_text('Mã dùng một lần:', exact=False)).to_be_visible()
    page.get_by_role('button', name='Bật Sao Chép').click()
    expect(page.get_by_role('button', name='Tạm Dừng Sao Chép')).to_be_visible()
    seed_order(db_path)
    select_tab(page, 'Lịch sử lệnh')
    with page.expect_response(lambda response: 'state=unknown' in response.url and response.ok):
        page.get_by_label('Lọc theo trạng thái').select_option('unknown')
    expect(page.get_by_text('ui-verification-reason', exact=True).first).to_be_visible()
    expect(page.get_by_text('$2590.12 / $2630.34', exact=True).first).to_be_visible()
    select_tab(page, 'Trợ lý AI')
    with page.expect_response(lambda response: response.url.endswith('/api/chat/assistant')) as stream:
        page.get_by_role('button', name='Xem số dư và vốn danh mục').click()
    assert stream.value.header_value('x-vercel-ai-ui-message-stream') == 'v1'
    expect(page.get_by_role('log').get_by_text('Trợ lý quy tắc', exact=False)).to_be_visible()
    assert page.request.get(base + '/api/admin/orders').status == 403


def verify_admin(page):
    select_tab(page, 'Hoạt động agent')
    with page.expect_response(lambda response: '/api/admin/orders?' in response.url and 'state=expired' in response.url):
        page.get_by_label('Lọc theo trạng thái lệnh').select_option('expired')
    page.get_by_role('button', name='Sự kiện và tác vụ').click()
    page.get_by_label('Lọc trạng thái hoạt động').select_option('resume')
    page.get_by_role('button', name='Lệnh toàn hệ thống').click()
    expect(page.get_by_label('Lọc theo trạng thái lệnh')).to_have_value('expired')
    page.get_by_label('Lọc theo trạng thái lệnh').select_option('unknown')
    expect(page.get_by_text('ui-verification-reason', exact=True)).to_be_visible()
    page.get_by_label('Lọc theo trạng thái lệnh').select_option('all')
    select_tab(page, 'Điều hành')
    page.get_by_role('button', name='Ngắt cấp lệnh', exact=True).click()
    expect(page.get_by_role('button', name='Mở lại cấp lệnh', exact=True)).to_be_visible()
    page.get_by_role('button', name='Mở lại cấp lệnh', exact=True).click()
    expect(page.get_by_text('Đã mở cấp lệnh ở cấp hệ thống.', exact=False)).to_be_visible()
    select_tab(page, 'Phê duyệt')
    with page.expect_response(lambda response: response.url.endswith('/api/chat/admin-agent')) as stream:
        page.get_by_role('button', name='Xem tóm tắt ứng viên', exact=True).click()
    assert stream.value.header_value('x-vercel-ai-ui-message-stream') == 'v1'
    select_tab(page, 'Lịch rủi ro')
    page.locator('#risk-title').fill('Sự kiện xác minh giao diện')
    page.locator('#risk-when').fill('2031-01-01T12:00')
    page.get_by_role('button', name='Thêm Khung Giờ Chặn', exact=False).click()
    row = page.get_by_role('row').filter(has_text='Sự kiện xác minh giao diện')
    expect(row).to_be_visible()
    row.get_by_role('button', name='Sửa', exact=True).click()
    expect(page.locator('#risk-edit-when')).to_have_value('2031-01-01T12:00')
    page.locator('#risk-edit-title').fill('Đã chỉnh sửa sự kiện')
    page.get_by_role('button', name='Lưu', exact=False).click()
    edited = page.get_by_role('row').filter(has_text='Đã chỉnh sửa sự kiện')
    expect(edited).to_be_visible()
    page.once('dialog', lambda dialog: dialog.accept())
    edited.get_by_role('button', name='Xóa', exact=True).click()
    expect(edited).to_have_count(0)


def capture(base, output, password, db_path):
    actual_images = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(executable_path=os.getenv('CHROMIUM_PATH') or None)
        for role in ('user', 'admin'):
            context = browser.new_context(viewport={'width': 1440, 'height': 900})
            page = context.new_page()
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            sign_in(page, base, role, password)
            if role == 'user':
                verify_user(page, base, db_path)
            else:
                verify_admin(page)

            for width, height, viewport in [(1440, 900, 'desktop'), (390, 844, 'mobile')]:
                page.set_viewport_size({'width': width, 'height': height})
                navigation = page.get_by_role('navigation', name='Menu chính')
                for button in navigation.get_by_role('button').all():
                    button.click()
                    expect(button).to_have_attribute('aria-current', 'page')
                    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), (
                        role, viewport, button.inner_text()
                    )
                navigation.get_by_role('button').first.click()
                expect(page.get_by_role('heading', level=1)).to_have_text(
                    'Tổng quan danh mục' if role == 'user' else 'Điều hành hệ thống'
                )
                if page.get_by_role('button', name='Đóng thông báo').count():
                    page.get_by_role('button', name='Đóng thông báo').click()
                path = output / f'{role}_{viewport}_{width}.png'
                page.screenshot(path=path)
                actual_images.append(hashlib.sha256(path.read_bytes()).hexdigest())
            assert not errors, errors
            context.close()
        browser.close()
    assert len(set(actual_images)) == 4, 'Each role and viewport must have a distinct capture.'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', type=Path, default=ROOT / 'artifacts' / 'portal-review')
    output = parser.parse_args().out
    if not (ROOT / 'dist' / 'index.html').is_file():
        parser.error('Build the React interface with npm run build first.')
    output.mkdir(parents=True, exist_ok=True)
    with socket.socket() as probe:
        probe.bind(('127.0.0.1', 0))
        port = probe.getsockname()[1]
    base = f'http://127.0.0.1:{port}'
    password = secrets.token_urlsafe(24)
    with tempfile.TemporaryDirectory(prefix='zupirus-portal-') as data:
        env = {
            **os.environ, 'DATA_DIR': data, 'DATABASE_URL': '', 'REDIS_URL': '',
            'AI_API_KEY': '', 'LANGSMITH_API_KEY': '', 'COOKIE_SECURE': 'false',
            'ADMIN_EMAIL': 'admin@zupirus.local', 'ADMIN_PASSWORD': password, 'ALLOWED_ORIGINS': base,
        }
        process = subprocess.Popen(
            [sys.executable, '-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', str(port)],
            cwd=ROOT, env=env, stdout=subprocess.DEVNULL,
        )
        try:
            for _ in range(100):
                try:
                    with urllib.request.urlopen(base + '/healthz', timeout=1):
                        break
                except OSError:
                    time.sleep(0.1)
            else:
                raise RuntimeError('Local backend did not start.')
            capture(base, output, password, Path(data) / 'lab.sqlite3')
        finally:
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
    print(f'PASS: two signed-in roles, desktop and mobile; four captures in {output}')


if __name__ == '__main__':
    main()
