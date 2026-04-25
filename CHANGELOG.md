# Changelog — pfc-grafana

## [0.1.0] — 2026-04-25

### Added
- Grafana data source plugin for PFC-JSONL cold archives via pfc-gateway
- **Standard query mode** — `POST /query` with time range + optional JSON filter (no DuckDB required)
- **SQL query mode** — `POST /query/sql` via DuckDB + pfc extension (optional, requires DuckDB on gateway server)
- **Three return formats:** Table, Time Series, Logs
- Connection config editor — pfc-gateway URL + API key
- Query editor — file path, format selector, filter field, SQL editor, time series options
- `testDatasource()` shows gateway version + SQL mode availability
- Grafana 10+ compatible (TypeScript/React, frontend-only plugin)
- 33 unit tests (Jest) + 19 E2E pipeline tests
