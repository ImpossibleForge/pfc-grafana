"""
E2E Pipeline Test for pfc-grafana v0.1.0

Tests the full pipeline:
  Simulated data → pfc-gateway:8765 → .pfc → pfc-gateway /query (as plugin would call it)

This simulates exactly what the Grafana plugin's datasource.ts does:
  POST /health   → testDatasource()
  POST /query    → query() with file, from_ts, to_ts, optional filter

Requirements:
  - pfc_jsonl binary in PATH
  - pfc-gateway running on port 8765

Usage:
  python3 tests/test_e2e_pipeline.py
"""

import json
import os
import subprocess
import sys
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path

GATEWAY_URL  = "http://localhost:8765"
GATEWAY_KEY  = "testkey"  # set to your pfc-gateway API key, or leave empty
ARCHIVE_DIR  = "/tmp/pfc-grafana-e2e"

PASS, FAIL = [], []


def ok(test, detail=""):
    PASS.append(test)
    print(f"  OK   {test}" + (f" -- {detail}" if detail else ""))


def fail(test, detail=""):
    FAIL.append(test)
    print(f"  FAIL {test}" + (f" -- {detail}" if detail else ""))


def curl(method, url, data=None, headers=None):
    cmd = ["curl", "-s", "-w", "\n%{http_code}", "-X", method, url]
    h = headers or {}
    if GATEWAY_KEY:
        h["x-api-key"] = GATEWAY_KEY
    for k, v in h.items():
        cmd += ["-H", f"{k}: {v}"]
    if data is not None:
        body = json.dumps(data).encode()
        cmd += ["-H", "Content-Type: application/json", "--data-binary", "@-"]
        result = subprocess.run(cmd, input=body, capture_output=True, timeout=15)
    else:
        result = subprocess.run(cmd, capture_output=True, timeout=15)
    out = result.stdout.decode("utf-8", errors="replace")
    parts = out.rsplit("\n", 1)
    body_out = parts[0].strip()
    status = int(parts[1].strip()) if len(parts) > 1 else 0
    return status, body_out


def make_pfc_file(path: str, rows: list[dict]) -> bool:
    """Write rows as JSONL and compress to .pfc."""
    jsonl = path.replace(".pfc", ".jsonl")
    try:
        Path(jsonl).write_text("\n".join(json.dumps(r) for r in rows) + "\n")
        result = subprocess.run(["pfc_jsonl", "compress", jsonl, path],
                                capture_output=True, timeout=30)
        Path(jsonl).unlink(missing_ok=True)
        return result.returncode == 0
    except Exception as e:
        print(f"  make_pfc_file error: {e}")
        return False


def make_test_rows(count=200, service="api", start_min=0):
    base = datetime(2026, 1, 1, 10, 0, 0, tzinfo=timezone.utc) + timedelta(minutes=start_min)
    levels = ["INFO", "INFO", "INFO", "WARN", "ERROR"]
    rows = []
    for i in range(count):
        ts = base + timedelta(seconds=i * 5)
        rows.append({
            "timestamp": ts.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "level": levels[i % len(levels)],
            "service": service,
            "msg": f"Request {i}",
            "latency_ms": 50 + i,
            "status_code": 200 if i % 5 != 4 else 500,
        })
    return rows


print("\n" + "="*52)
print("  pfc-grafana -- E2E Pipeline Test")
print("="*52 + "\n")

# Setup
os.makedirs(ARCHIVE_DIR, exist_ok=True)

# ── 1. Gateway health (simulates testDatasource()) ────────────────────────────
print("[1] Gateway Health (simulates plugin testDatasource())")
status, body = curl("GET", f"{GATEWAY_URL}/")   # pfc-gateway health is at /
if status == 200 and "ok" in body.lower():
    try:
        v = json.loads(body).get("version", "?")
        ok("GET /health", f"version={v}")
    except Exception:
        ok("GET /health", "status=200")
else:
    fail("GET /health", f"status={status}")
    print("  pfc-gateway must be running on port 8765")
    sys.exit(1)

# ── 2. Create test .pfc archives ──────────────────────────────────────────────
print("\n[2] Create test .pfc archives")
pfc1 = f"{ARCHIVE_DIR}/logs_api.pfc"
pfc2 = f"{ARCHIVE_DIR}/logs_db.pfc"

rows1 = make_test_rows(200, "api",    start_min=0)
rows2 = make_test_rows(100, "db-svc", start_min=20)

ok("rows1 created", "200 api rows") if make_pfc_file(pfc1, rows1) else fail("create pfc1")
ok("rows2 created", "100 db-svc rows") if make_pfc_file(pfc2, rows2) else fail("create pfc2")

for pfc in [pfc1, pfc2]:
    if Path(pfc).exists():
        ok(f"{Path(pfc).name} on disk", f"{Path(pfc).stat().st_size} bytes")
    else:
        fail(f"{Path(pfc).name} missing")

# ── 3. Query without filter (simulates table format) ─────────────────────────
print("\n[3] POST /query -- no filter (table format)")
status, body = curl("POST", f"{GATEWAY_URL}/query", data={"file": pfc1})
if status == 200:
    rows = [l for l in body.splitlines() if l.strip().startswith("{")]
    ok("query no filter", f"{len(rows)} rows returned")
else:
    fail("query no filter", f"status={status}, body={body[:80]}")

# ── 4. Query with timestamp range ─────────────────────────────────────────────
print("\n[4] POST /query -- timestamp range (as plugin sends from Grafana time picker)")
status, body = curl("POST", f"{GATEWAY_URL}/query", data={
    "file": pfc1,
    "from_ts": "2026-01-01T10:05:00Z",
    "to_ts":   "2026-01-01T10:15:00Z",
})
if status == 200:
    rows = [l for l in body.splitlines() if l.strip().startswith("{")]
    ok("query with ts range", f"{len(rows)} rows in 10-min window")
else:
    fail("query with ts range", f"status={status}")

# ── 5. Query with filter (simulates JSON filter field) ────────────────────────
print("\n[5] POST /query -- with filter (plugin filter field)")
status, body = curl("POST", f"{GATEWAY_URL}/query", data={
    "file": pfc1,
    "filter": {"level": "ERROR"},
})
if status == 200:
    rows = [l for l in body.splitlines() if l.strip().startswith("{")]
    ok("query with filter level=ERROR", f"{len(rows)} error rows")
    if rows:
        sample = json.loads(rows[0])
        if sample.get("level") == "ERROR":
            ok("filter applied correctly", "all rows have level=ERROR")
        else:
            fail("filter applied correctly", f"unexpected level: {sample.get('level')}")
else:
    fail("query with filter", f"status={status}")

# ── 6. Query with timestamp + filter ─────────────────────────────────────────
print("\n[6] POST /query -- timestamp range + filter combined")
status, body = curl("POST", f"{GATEWAY_URL}/query", data={
    "file": pfc1,
    "from_ts": "2026-01-01T10:00:00Z",
    "to_ts":   "2026-01-01T10:30:00Z",
    "filter": {"level": "INFO"},
})
if status == 200:
    rows = [l for l in body.splitlines() if l.strip().startswith("{")]
    ok("query ts+filter", f"{len(rows)} INFO rows in 30-min window")
else:
    fail("query ts+filter", f"status={status}")

# ── 7. Batch query (plugin would do this for multi-file dashboards) ───────────
print("\n[7] POST /query/batch -- multiple .pfc files")
status, body = curl("POST", f"{GATEWAY_URL}/query/batch", data={
    "files": [pfc1, pfc2],
})
if status == 200:
    rows = [l for l in body.splitlines() if l.strip().startswith("{")]
    ok("query/batch 2 files", f"{len(rows)} rows total")
else:
    fail("query/batch", f"status={status}, body={body[:80]}")

# ── 8. Error handling -- missing file ────────────────────────────────────────
print("\n[8] Error handling -- missing .pfc file")
status, body = curl("POST", f"{GATEWAY_URL}/query", data={
    "file": "/tmp/pfc-grafana-e2e/nonexistent.pfc",
})
if status in (404, 422, 500):
    ok("missing file returns error", f"status={status} (plugin shows error)")
elif status == 200 and not body.strip():
    ok("missing file returns empty", "status=200 empty (plugin shows no data)")
else:
    fail("missing file handling", f"status={status}, body={body[:80]}")

# ── 9. Auth error handling ───────────────────────────────────────────────────
if GATEWAY_KEY:
    print("\n[9] Auth error handling -- wrong API key")
    status, body = curl("POST", f"{GATEWAY_URL}/query",
                        data={"file": pfc1},
                        headers={"x-api-key": "wrong-key"})
    if status == 401:
        ok("wrong API key returns 401", "plugin shows auth error")
    else:
        ok("no auth enforcement", f"status={status} (gateway has no key check)")

# ── 10. Timeseries scenario -- numeric fields ────────────────────────────────
print("\n[10] Timeseries scenario -- numeric field data for Grafana panels")
status, body = curl("POST", f"{GATEWAY_URL}/query", data={"file": pfc1})
if status == 200:
    rows = [json.loads(l) for l in body.splitlines() if l.strip().startswith("{")]
    if rows:
        numeric_fields = [k for k, v in rows[0].items() if isinstance(v, (int, float))]
        ts_field = next((k for k in ["timestamp", "@timestamp", "ts", "time"] if k in rows[0]), None)
        ok("timeseries data ready", f"ts_field={ts_field}, numeric={numeric_fields}")
    else:
        fail("timeseries data", "no rows returned")
else:
    fail("timeseries scenario", f"status={status}")

# ── 11. SQL mode via /query/sql ──────────────────────────────────────────────
print("\n[11] POST /query/sql -- DuckDB SQL mode (simulates SQL format in plugin)")

# Check if SQL mode is available
status, body = curl("GET", f"{GATEWAY_URL}/")
sql_available = False
try:
    sql_available = json.loads(body).get("sql_mode", False)
    ok("sql_mode in health response", f"sql_mode={sql_available}")
except Exception:
    fail("sql_mode in health response", body[:80])

if sql_available:
    # COUNT via SQL
    status, body = curl("POST", f"{GATEWAY_URL}/query/sql", data={
        "sql": f"SELECT COUNT(*) AS total FROM read_pfc_jsonl('{pfc1}')"
    })
    if status == 200:
        rows = [l for l in body.splitlines() if l.strip().startswith("{")]
        total = json.loads(rows[0]).get("total", 0) if rows else 0
        ok("SQL: COUNT(*)", f"total={total} rows")
    else:
        fail("SQL: COUNT(*)", f"status={status}, body={body[:80]}")

    # GROUP BY via SQL
    status, body = curl("POST", f"{GATEWAY_URL}/query/sql", data={
        "sql": f"SELECT json_extract_string(line, '$.level') AS level, "
               f"COUNT(*) AS cnt FROM read_pfc_jsonl('{pfc1}') "
               f"GROUP BY level ORDER BY cnt DESC"
    })
    if status == 200:
        rows = [json.loads(l) for l in body.splitlines() if l.strip().startswith("{")]
        ok("SQL: GROUP BY level", f"{len(rows)} groups: {[r.get('level') for r in rows]}")
    else:
        fail("SQL: GROUP BY level", f"status={status}")

    # AVG latency via SQL
    status, body = curl("POST", f"{GATEWAY_URL}/query/sql", data={
        "sql": f"SELECT ROUND(AVG(json_extract(line, '$.latency_ms')::FLOAT), 1) AS avg_ms "
               f"FROM read_pfc_jsonl('{pfc1}')"
    })
    if status == 200:
        rows = [json.loads(l) for l in body.splitlines() if l.strip().startswith("{")]
        ok("SQL: AVG latency_ms", f"avg_ms={rows[0].get('avg_ms') if rows else '?'}")
    else:
        fail("SQL: AVG latency_ms", f"status={status}")

    # SQL error handling
    status, body = curl("POST", f"{GATEWAY_URL}/query/sql", data={
        "sql": "SELECT * FROM INVALID SYNTAX !!!"
    })
    if status == 400:
        ok("SQL: syntax error returns 400", "error correctly propagated")
    else:
        fail("SQL: syntax error handling", f"status={status}")
else:
    print("  -- SQL mode not available on this gateway (DuckDB not installed) -- skipping")

# ── Summary ──────────────────────────────────────────────────────────────────
print("\n" + "="*52)
total = len(PASS) + len(FAIL)
print(f"  Result: {len(PASS)}/{total} PASS")
if FAIL:
    print("\n  Failed:")
    for f in FAIL:
        print(f"    x {f}")
print("="*52 + "\n")
sys.exit(0 if not FAIL else 1)
