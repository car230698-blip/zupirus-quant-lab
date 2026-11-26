"""Launch guide seed: DRAFT EURUSD methodology with committed PDFs."""
from pathlib import Path

from app.domains.quant.launch_guide import REPORT_ID, PRICE_USD, ensure_launch_guide_seeded
from app.db import tx


def test_launch_guide_seeds_as_draft_with_price(client):
    with tx() as c:
        ensure_launch_guide_seeded(c)
        row = c.execute(
            "SELECT id, status, price_usd, sample_pdf_path, full_pdf_path, title FROM research_reports WHERE id = ?",
            (REPORT_ID,),
        ).fetchone()
    assert row is not None
    status = row["status"] if hasattr(row, "keys") else row[1]
    price = float(row["price_usd"] if hasattr(row, "keys") else row[2])
    sample = row["sample_pdf_path"] if hasattr(row, "keys") else row[3]
    full = row["full_pdf_path"] if hasattr(row, "keys") else row[4]
    title = row["title"] if hasattr(row, "keys") else row[5]
    assert status == "DRAFT"
    assert price == PRICE_USD
    assert "EURUSD" in title or "Asia" in title or "Á" in title
    assert Path(sample).exists() and Path(sample).stat().st_size > 1000
    assert Path(full).exists() and Path(full).stat().st_size > Path(sample).stat().st_size

    # Not public until admin publishes
    pub = client.get("/api/v1/reports")
    assert pub.status_code == 200
    assert not any(item.get("id") == REPORT_ID for item in pub.json().get("items", []))


def test_launch_guide_seed_does_not_overwrite_operator_price(client):
    with tx() as c:
        ensure_launch_guide_seeded(c)
        c.execute(
            "UPDATE research_reports SET price_usd = 27.0, version = 'v2.0' WHERE id = ?",
            (REPORT_ID,),
        )
        ensure_launch_guide_seeded(c)
        row = c.execute(
            "SELECT price_usd, version FROM research_reports WHERE id = ?",
            (REPORT_ID,),
        ).fetchone()
    price = float(row["price_usd"] if hasattr(row, "keys") else row[0])
    version = row["version"] if hasattr(row, "keys") else row[1]
    assert price == 27.0
    assert version == "v2.0"
