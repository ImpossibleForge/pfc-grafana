# pfc-grafana

> Grafana data source plugin for [PFC-JSONL](https://github.com/ImpossibleForge/pfc-jsonl) cold archives — query `.pfc` files directly from Grafana dashboards via [pfc-gateway](https://github.com/ImpossibleForge/pfc-gateway).

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Grafana](https://img.shields.io/badge/Grafana-10%2B-orange.svg)](https://grafana.com)
[![PFC-JSONL](https://img.shields.io/badge/pfc--jsonl-v3.4.4-blue.svg)](https://github.com/ImpossibleForge/pfc-jsonl)

Visualize historical logs and metrics stored as `.pfc` archives in Grafana — without loading them into a database. Block-level timestamp filtering means only the relevant data is decompressed.

```
Telegraf / Fluent Bit / Vector
        ↓
  pfc-gateway:8765  ←──── pfc-grafana plugin
  .pfc archives on S3            ↓
                          Grafana Dashboard
```

---

## Why pfc-grafana?

| Pain | Solution |
|---|---|
| Historical logs/metrics live in cold storage, invisible in Grafana | Query `.pfc` archives directly — no hot DB needed |
| Full decompression for every query is too slow | Block-level index: only relevant time windows are read |
| DuckDB power users want SQL in Grafana | Optional SQL mode via `POST /query/sql` |

---

## Requirements

- [pfc-gateway](https://github.com/ImpossibleForge/pfc-gateway) v0.3.0+ running
- Grafana 10.0+
- `.pfc` archives created by any PFC ingest tool (pfc-fluentbit, pfc-vector, pfc-telegraf, etc.)

---

## Installation

### From Grafana Plugin Catalog (recommended)

```bash
grafana cli plugins install impossibleforge-pfc-datasource
```

### Manual install

```bash
# Download and extract to Grafana plugins directory
cd /var/lib/grafana/plugins
curl -L https://github.com/ImpossibleForge/pfc-grafana/releases/latest/download/impossibleforge-pfc-datasource.zip \
  -o pfc-grafana.zip && unzip pfc-grafana.zip
systemctl restart grafana-server
```

---

## Configuration

1. In Grafana: **Connections → Data Sources → Add → PFC-JSONL**
2. Set **pfc-gateway URL**: `http://localhost:8765`
3. Set **API Key** (if your gateway uses authentication)
4. Click **Save & Test** — shows gateway version and SQL mode status

---

## Query Modes

### Standard mode (no DuckDB required)

Select **Table**, **Time Series**, or **Logs** format.

- **PFC File**: path to `.pfc` archive (local or `s3://bucket/key.pfc`)
- **Filter**: optional JSON filter `{"level": "ERROR"}` — only matching rows returned
- Grafana time picker sets the time range automatically

### SQL mode (requires DuckDB on gateway server)

Select **SQL** format and write any DuckDB SQL query:

```sql
-- Log level breakdown
SELECT json_extract_string(line, '$.level') AS level,
       COUNT(*) AS cnt
FROM pfc_scan('/var/lib/pfc/logs_20260101.pfc')
GROUP BY level ORDER BY cnt DESC;

-- Avg latency per service (Time Series compatible)
SELECT json_extract_string(line, '$.timestamp') AS timestamp,
       json_extract_string(line, '$.service') AS service,
       json_extract(line, '$.latency_ms')::FLOAT AS latency_ms
FROM pfc_scan('/var/lib/pfc/logs.pfc')
ORDER BY timestamp;
```

`sql_mode: true` appears in the **Save & Test** output when DuckDB + pfc extension are available.

**Enable SQL mode on pfc-gateway:**
```bash
# Install DuckDB
curl -L https://github.com/duckdb/duckdb/releases/latest/download/duckdb_cli-linux-amd64.gz \
  | gunzip > /usr/local/bin/duckdb && chmod +x /usr/local/bin/duckdb
# Install pfc extension
duckdb -c "INSTALL pfc FROM community;"
```

---

## Full Pipeline Example

```
Telegraf → pfc-telegraf:8767 → .pfc files on /var/lib/pfc/
                                        ↓
                               pfc-gateway:8765
                                        ↓
                               pfc-grafana plugin
                                        ↓
                               Grafana Dashboard
```

---

## Related Projects

| Project | Role |
|---|---|
| [pfc-jsonl](https://github.com/ImpossibleForge/pfc-jsonl) | Core compression binary |
| [pfc-gateway](https://github.com/ImpossibleForge/pfc-gateway) | HTTP query + ingest API (required) |
| [pfc-duckdb](https://github.com/ImpossibleForge/pfc-duckdb) | DuckDB community extension |
| [pfc-fluentbit](https://github.com/ImpossibleForge/pfc-fluentbit) | Fluent Bit → PFC |
| [pfc-vector](https://github.com/ImpossibleForge/pfc-vector) | Vector.dev → PFC |
| [pfc-telegraf](https://github.com/ImpossibleForge/pfc-telegraf) | Telegraf → PFC |
| [pfc-otel-collector](https://github.com/ImpossibleForge/pfc-otel-collector) | OpenTelemetry → PFC |
| [pfc-kafka-consumer](https://github.com/ImpossibleForge/pfc-kafka-consumer) | Kafka → PFC |

---

## Disclaimer

pfc-grafana is an independent open-source project and is not affiliated with, endorsed by, or associated with Grafana Labs or the Grafana project.

## License

pfc-grafana (this repository) is released under the MIT License — see [LICENSE](LICENSE).

The PFC-JSONL binary (pfc_jsonl) is proprietary software — free for personal and open-source use. Commercial use requires a license: info@impossibleforge.com
