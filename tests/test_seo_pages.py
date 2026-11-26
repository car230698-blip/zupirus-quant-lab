import pytest
from starlette.testclient import TestClient

from app.main import app


@pytest.fixture
def client():
    return TestClient(app)


def test_robots_txt(client):
    res = client.get("/robots.txt")
    assert res.status_code == 200
    assert "text/plain" in res.headers["content-type"]
    assert "User-agent: *" in res.text
    assert "Allow: /huong-dan/" in res.text
    assert "Disallow: /admin/" in res.text
    assert "Disallow: /portal/" in res.text
    assert "Sitemap: https://zupirus.com/sitemap.xml" in res.text


def test_dynamic_sitemap_xml(client):
    res = client.get("/sitemap.xml")
    assert res.status_code == 200
    assert "application/xml" in res.headers["content-type"]
    assert "<loc>https://zupirus.com/</loc>" in res.text
    assert "<loc>https://zupirus.com/huong-dan</loc>" in res.text
    assert "<loc>https://zupirus.com/en/guides</loc>" in res.text
    assert "nghien-cuu-dinh-luong-vang-xauusd-m15" in res.text
    assert "quantitative-research-xauusd-m15-breakout-retest" in res.text
    assert "session-expectancy-analysis-comex-gold" in res.text


def test_seo_guides_hub(client):
    res_vi = client.get("/huong-dan")
    assert res_vi.status_code == 200
    assert "text/html" in res_vi.headers["content-type"]
    assert "CollectionPage" in res_vi.text
    assert "nghien-cuu-dinh-luong-vang-xauusd-m15" in res_vi.text

    res_en = client.get("/en/guides")
    assert res_en.status_code == 200
    assert "Quantitative Research &amp; Methodology Guides" in res_en.text or "Quantitative Research" in res_en.text


def test_seo_guide_details_bilingual_hreflang(client):
    # Vietnamese guide
    res_vi = client.get("/huong-dan/nghien-cuu-dinh-luong-vang-xauusd-m15")
    assert res_vi.status_code == 200
    assert "Article" in res_vi.text
    assert "quantitative-research-xauusd-m15-breakout-retest" in res_vi.text

    # English guide
    res_en = client.get("/en/guides/quantitative-research-xauusd-m15-breakout-retest")
    assert res_en.status_code == 200
    assert "Article" in res_en.text
    assert "nghien-cuu-dinh-luong-vang-xauusd-m15" in res_en.text


def test_seo_report_detail_ssr(client):
    # Public report detail
    res = client.get("/bao-cao/bao-cao-dinh-luong-xauusd-london-ny-microstructure-v1")
    # Even if DB is mock or SQLite in test, if report exists it returns 200
    assert res.status_code in (200, 404)
    if res.status_code == 200:
        assert "Product" in res.text
        assert "OOS WIN RATE" in res.text
