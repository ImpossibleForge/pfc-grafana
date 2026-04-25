import {
  DataSourceApi,
  DataSourceInstanceSettings,
  DataQueryRequest,
  DataQueryResponse,
  FieldType,
  MutableDataFrame,
  AnnotationEvent,
  dateTime,
} from '@grafana/data';
import { getBackendSrv, isFetchError } from '@grafana/runtime';
import { lastValueFrom } from 'rxjs';

import { PfcQuery, PfcDataSourceOptions, GatewayQueryPayload } from './types';

const TS_FIELDS = ['timestamp', '@timestamp', 'ts', 'time'];

export class PfcDataSource extends DataSourceApi<PfcQuery, PfcDataSourceOptions> {
  private baseUrl: string;
  private apiKey: string;

  constructor(instanceSettings: DataSourceInstanceSettings<PfcDataSourceOptions>) {
    super(instanceSettings);
    this.baseUrl = instanceSettings.jsonData.url?.replace(/\/$/, '') ?? '';
    this.apiKey = (instanceSettings as any).secureJsonData?.apiKey ?? '';
  }

  // ── HTTP helper ────────────────────────────────────────────────────────────

  private async request<T = unknown>(path: string, method: 'GET' | 'POST', body?: unknown): Promise<T> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) {
      headers['x-api-key'] = this.apiKey;
    }

    const response = await lastValueFrom(
      getBackendSrv().fetch<T>({
        url: `${this.baseUrl}${path}`,
        method,
        headers,
        data: body,
      })
    );
    return response.data;
  }

  // ── Parse NDJSON → rows ────────────────────────────────────────────────────

  private parseNDJSON(raw: string): Record<string, unknown>[] {
    return raw
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('{'))
      .map((line) => {
        try { return JSON.parse(line); }
        catch { return null; }
      })
      .filter(Boolean) as Record<string, unknown>[];
  }

  // ── Detect timestamp field ─────────────────────────────────────────────────

  private detectTsField(row: Record<string, unknown>, hint?: string): string | null {
    if (hint && hint in row) { return hint; }
    return TS_FIELDS.find((f) => f in row) ?? null;
  }

  // ── Build table DataFrame ──────────────────────────────────────────────────

  private buildTableFrame(rows: Record<string, unknown>[], target: PfcQuery): MutableDataFrame {
    if (rows.length === 0) { return new MutableDataFrame({ refId: target.refId, fields: [] }); }

    const allKeys = Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
    const tsField = this.detectTsField(rows[0], target.timestampField);

    // Put timestamp first if present
    const orderedKeys = tsField
      ? [tsField, ...allKeys.filter((k) => k !== tsField)]
      : allKeys;

    const frame = new MutableDataFrame({
      refId: target.refId,
      name: target.file.split('/').pop() ?? target.file,
      fields: orderedKeys.map((key) => {
        if (key === tsField) {
          return { name: key, type: FieldType.time };
        }
        const sample = rows.find((r) => r[key] != null)?.[key];
        if (typeof sample === 'number') { return { name: key, type: FieldType.number }; }
        if (typeof sample === 'boolean') { return { name: key, type: FieldType.boolean }; }
        return { name: key, type: FieldType.string };
      }),
    });

    for (const row of rows) {
      const values = orderedKeys.map((key) => {
        const val = row[key];
        if (key === tsField && typeof val === 'string') {
          return dateTime(val).valueOf();
        }
        return val ?? null;
      });
      frame.appendRow(values);
    }
    return frame;
  }

  // ── Build time series DataFrames ───────────────────────────────────────────

  private buildTimeseriesFrames(rows: Record<string, unknown>[], target: PfcQuery): MutableDataFrame[] {
    if (rows.length === 0) { return []; }

    const tsField = this.detectTsField(rows[0], target.timestampField);
    if (!tsField) { return [this.buildTableFrame(rows, target)]; }

    // Determine numeric fields to plot
    const requestedFields = target.valueFields
      ? target.valueFields.split(',').map((f) => f.trim()).filter(Boolean)
      : [];

    const allNumericKeys = Object.keys(rows[0]).filter(
      (k) => k !== tsField && typeof rows.find((r) => r[k] != null)?.[k] === 'number'
    );
    const valueKeys = requestedFields.length > 0 ? requestedFields : allNumericKeys;

    return valueKeys.map((valueKey) => {
      const frame = new MutableDataFrame({
        refId: target.refId,
        name: valueKey,
        fields: [
          { name: 'Time', type: FieldType.time },
          { name: valueKey, type: FieldType.number },
        ],
      });
      for (const row of rows) {
        const ts = row[tsField];
        const val = row[valueKey];
        if (ts != null && val != null) {
          frame.appendRow([dateTime(ts as string).valueOf(), Number(val)]);
        }
      }
      return frame;
    });
  }

  // ── Main query ─────────────────────────────────────────────────────────────

  async query(options: DataQueryRequest<PfcQuery>): Promise<DataQueryResponse> {
    const { range, targets } = options;
    const from = range.from.utc().toISOString();
    const to   = range.to.utc().toISOString();

    // SQL targets need sqlQuery; standard targets need file
    const activeTargets = targets.filter((t) => {
      if (t.hide) { return false; }
      if (t.format === 'sql') { return Boolean(t.sqlQuery?.trim()); }
      return Boolean(t.file?.trim());
    });
    if (activeTargets.length === 0) { return { data: [] }; }

    const promises = activeTargets.map(async (target): Promise<MutableDataFrame[]> => {
      let rawResponse: string;

      // ── SQL mode: POST /query/sql ──────────────────────────────────────────
      if (target.format === 'sql') {
        try {
          rawResponse = await this.request<string>('/query/sql', 'POST', { sql: target.sqlQuery!.trim() });
        } catch (err) {
          if (isFetchError(err)) {
            const detail = (err.data as any)?.detail ?? JSON.stringify(err.data);
            if (err.status === 503) {
              throw new Error(`SQL mode unavailable: ${detail}`);
            }
            throw new Error(`SQL error ${err.status}: ${detail}`);
          }
          throw err;
        }
        const rows = this.parseNDJSON(typeof rawResponse === 'string' ? rawResponse : JSON.stringify(rawResponse));
        return [this.buildTableFrame(rows, { ...target, format: 'table' })];
      }

      // ── Standard mode: POST /query ─────────────────────────────────────────
      const payload: GatewayQueryPayload = {
        file: target.file.trim(),
        from_ts: from,
        to_ts: to,
      };

      if (target.filter?.trim()) {
        try { payload.filter = JSON.parse(target.filter); }
        catch { /* ignore malformed filter */ }
      }

      try {
        rawResponse = await this.request<string>('/query', 'POST', payload);
      } catch (err) {
        if (isFetchError(err)) {
          throw new Error(`pfc-gateway error ${err.status}: ${JSON.stringify(err.data)}`);
        }
        throw err;
      }

      const rows = this.parseNDJSON(typeof rawResponse === 'string' ? rawResponse : JSON.stringify(rawResponse));

      if (target.format === 'timeseries') {
        return this.buildTimeseriesFrames(rows, target);
      }
      return [this.buildTableFrame(rows, target)];
    });

    const results = await Promise.all(promises);
    const data = results.flat();
    return { data };
  }

  // ── Health check ───────────────────────────────────────────────────────────

  async testDatasource(): Promise<{ status: string; message: string }> {
    try {
      const result = await this.request<Record<string, unknown>>('/', 'GET');
      if (result?.status === 'ok') {
        const version = result.version ?? 'unknown';
        const sqlMode = result.sql_mode ? ' · SQL mode ✓' : ' · SQL mode ✗ (install DuckDB + pfc extension)';
        return { status: 'success', message: `Connected to pfc-gateway v${version}${sqlMode}` };
      }
      return { status: 'error', message: 'Gateway returned unexpected response' };
    } catch (err) {
      if (isFetchError(err)) {
        return { status: 'error', message: `Connection failed: HTTP ${err.status}` };
      }
      return { status: 'error', message: `Connection failed: ${String(err)}` };
    }
  }

  // ── Annotations ────────────────────────────────────────────────────────────

  async annotationQuery(): Promise<AnnotationEvent[]> {
    return [];
  }
}
