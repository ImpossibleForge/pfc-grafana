import { DataQueryRequest, dateTime, FieldType } from '@grafana/data';
import { PfcDataSource } from '../datasource';
import { PfcQuery } from '../types';

// ── Mock @grafana/runtime ──────────────────────────────────────────────────────
const mockFetch = jest.fn();
jest.mock('@grafana/runtime', () => ({
  getBackendSrv: () => ({ fetch: mockFetch }),
  isFetchError: (err: unknown) => (err as any)?.__isFetchError === true,
}));

import { of } from 'rxjs';

function makeFetchResponse(data: unknown, status = 200) {
  return of({ data, status, ok: true, headers: {} });
}

function makeFetchError(status: number, data: unknown) {
  const err: any = new Error('fetch error');
  err.__isFetchError = true;
  err.status = status;
  err.data = data;
  return { subscribe: (obs: any) => { obs.error(err); return { unsubscribe: () => {} }; } };
}

function makeDS(url = 'http://localhost:8765', apiKey = 'testkey') {
  return new PfcDataSource({
    id: 1,
    uid: 'pfc-test',
    name: 'PFC Test',
    type: 'datasource',
    meta: {} as any,
    access: 'proxy',
    url,
    jsonData: { url },
    secureJsonData: { apiKey },
    secureJsonFields: {},
    readOnly: false,
  } as any);
}

function makeQueryOptions(targets: Array<Partial<PfcQuery>>, fromIso = '2026-01-01T10:00:00Z', toIso = '2026-01-01T11:00:00Z'): DataQueryRequest<PfcQuery> {
  return {
    requestId: 'test',
    targets: targets.map((t, i) => ({
      refId: `A${i}`,
      file: '',
      filter: '',
      format: 'table' as const,
      ...t,
    })),
    range: {
      from: dateTime(fromIso),
      to: dateTime(toIso),
      raw: { from: fromIso, to: toIso },
    },
    interval: '1m',
    intervalMs: 60000,
    maxDataPoints: 1000,
    scopedVars: {},
    timezone: 'UTC',
    app: 'dashboard',
    startTime: 0,
    rangeRaw: { from: fromIso, to: toIso },
  } as any;
}

beforeEach(() => { mockFetch.mockClear(); });

// ─────────────────────────────────────────────────────────────────────────────
// SQL mode
// ─────────────────────────────────────────────────────────────────────────────

describe('query — SQL mode', () => {
  it('routes SQL format to /query/sql', async () => {
    const ds = makeDS();
    mockFetch.mockReturnValueOnce(makeFetchResponse('{"total":200}\n'));
    await ds.query(makeQueryOptions([{
      format: 'sql' as any,
      file: '',
      sqlQuery: "SELECT COUNT(*) AS total FROM pfc_scan('test.pfc')",
    }]));
    const callArgs = mockFetch.mock.lastCall![0];
    expect(callArgs.url).toContain('/query/sql');
    expect(callArgs.data.sql).toContain('pfc_scan');
  });

  it('returns table frame from SQL result', async () => {
    const ds = makeDS();
    mockFetch.mockReturnValueOnce(makeFetchResponse('{"level":"INFO","cnt":120}\n{"level":"ERROR","cnt":40}\n'));
    const resp = await ds.query(makeQueryOptions([{
      format: 'sql' as any,
      file: '',
      sqlQuery: "SELECT json_extract_string(line, '$.level') AS level, COUNT(*) AS cnt FROM pfc_scan('test.pfc') GROUP BY level",
    }]));
    expect(resp.data).toHaveLength(1);
    expect((resp.data[0] as any).length).toBe(2);
  });

  it('skips SQL target when sqlQuery is empty', async () => {
    const ds = makeDS();
    const resp = await ds.query(makeQueryOptions([{
      format: 'sql' as any,
      file: '',
      sqlQuery: '',
    }]));
    expect(resp.data).toHaveLength(0);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('throws descriptive error when SQL mode unavailable (503)', async () => {
    const ds = makeDS();
    mockFetch.mockReturnValueOnce(makeFetchError(503, { detail: 'DuckDB binary not found' }));
    await expect(ds.query(makeQueryOptions([{
      format: 'sql' as any,
      file: '',
      sqlQuery: "SELECT 1",
    }]))).rejects.toThrow('SQL mode unavailable');
  });

  it('throws SQL error on 400', async () => {
    const ds = makeDS();
    mockFetch.mockReturnValueOnce(makeFetchError(400, { detail: 'Parser Error: syntax error' }));
    await expect(ds.query(makeQueryOptions([{
      format: 'sql' as any,
      file: '',
      sqlQuery: "SELECT * FROM INVALID SYNTAX",
    }]))).rejects.toThrow('SQL error 400');
  });

  it('testDatasource shows sql_mode status', async () => {
    const ds = makeDS();
    mockFetch.mockReturnValueOnce(makeFetchResponse({ status: 'ok', version: '0.3.0', sql_mode: true }));
    const result = await ds.testDatasource();
    expect(result.status).toBe('success');
    expect(result.message).toContain('SQL mode ✓');
  });

  it('testDatasource shows sql_mode unavailable', async () => {
    const ds = makeDS();
    mockFetch.mockReturnValueOnce(makeFetchResponse({ status: 'ok', version: '0.3.0', sql_mode: false }));
    const result = await ds.testDatasource();
    expect(result.status).toBe('success');
    expect(result.message).toContain('SQL mode ✗');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Health Check
// ─────────────────────────────────────────────────────────────────────────────

describe('testDatasource', () => {
  it('returns success when gateway responds ok', async () => {
    const ds = makeDS();
    mockFetch.mockReturnValueOnce(makeFetchResponse({ status: 'ok', version: '0.2.0' }));
    const result = await ds.testDatasource();
    expect(result.status).toBe('success');
    expect(result.message).toContain('0.2.0');
  });

  it('returns error when gateway returns unexpected response', async () => {
    const ds = makeDS();
    mockFetch.mockReturnValueOnce(makeFetchResponse({ status: 'unknown' }));
    const result = await ds.testDatasource();
    expect(result.status).toBe('error');
  });

  it('returns error on HTTP error', async () => {
    const ds = makeDS();
    mockFetch.mockReturnValueOnce(makeFetchError(401, { message: 'unauthorized' }));
    const result = await ds.testDatasource();
    expect(result.status).toBe('error');
    expect(result.message).toContain('401');
  });

  it('returns error on network failure', async () => {
    const ds = makeDS();
    mockFetch.mockReturnValueOnce({
      subscribe: (obs: any) => { obs.error(new Error('ECONNREFUSED')); return { unsubscribe: () => {} }; }
    });
    const result = await ds.testDatasource();
    expect(result.status).toBe('error');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// NDJSON Parsing → Table DataFrames
// ─────────────────────────────────────────────────────────────────────────────

describe('query — table format', () => {
  it('parses NDJSON into table dataframe', async () => {
    const ds = makeDS();
    const ndjson = [
      '{"timestamp":"2026-01-01T10:00:00Z","level":"INFO","service":"api","latency_ms":50}',
      '{"timestamp":"2026-01-01T10:00:01Z","level":"ERROR","service":"db","latency_ms":200}',
    ].join('\n');
    mockFetch.mockReturnValueOnce(makeFetchResponse(ndjson));

    const resp = await ds.query(makeQueryOptions([{ file: '/tmp/test.pfc', format: 'table' }]));
    expect(resp.data).toHaveLength(1);
    const frame = resp.data[0] as any;
    expect(frame.length).toBe(2);
    const tsField = frame.fields.find((f: any) => f.name === 'timestamp');
    expect(tsField?.type).toBe(FieldType.time);
    const latField = frame.fields.find((f: any) => f.name === 'latency_ms');
    expect(latField?.type).toBe(FieldType.number);
  });

  it('returns empty frame when no rows', async () => {
    const ds = makeDS();
    mockFetch.mockReturnValueOnce(makeFetchResponse(''));
    const resp = await ds.query(makeQueryOptions([{ file: '/tmp/test.pfc', format: 'table' }]));
    expect(resp.data).toHaveLength(1);
    expect((resp.data[0] as any).length).toBe(0);
  });

  it('skips non-JSON lines in NDJSON', async () => {
    const ds = makeDS();
    const ndjson = [
      'not json',
      '{"timestamp":"2026-01-01T10:00:00Z","level":"INFO"}',
      '',
      '{"timestamp":"2026-01-01T10:00:01Z","level":"WARN"}',
    ].join('\n');
    mockFetch.mockReturnValueOnce(makeFetchResponse(ndjson));
    const resp = await ds.query(makeQueryOptions([{ file: '/tmp/test.pfc', format: 'table' }]));
    expect((resp.data[0] as any).length).toBe(2);
  });

  it('auto-detects @timestamp field', async () => {
    const ds = makeDS();
    const ndjson = '{"@timestamp":"2026-01-01T10:00:00Z","msg":"test"}';
    mockFetch.mockReturnValueOnce(makeFetchResponse(ndjson));
    const resp = await ds.query(makeQueryOptions([{ file: '/tmp/test.pfc', format: 'table' }]));
    const frame = resp.data[0] as any;
    const tsField = frame.fields.find((f: any) => f.name === '@timestamp');
    expect(tsField?.type).toBe(FieldType.time);
  });

  it('handles boolean fields correctly', async () => {
    const ds = makeDS();
    const ndjson = '{"timestamp":"2026-01-01T10:00:00Z","active":true,"count":42}';
    mockFetch.mockReturnValueOnce(makeFetchResponse(ndjson));
    const resp = await ds.query(makeQueryOptions([{ file: '/tmp/test.pfc', format: 'table' }]));
    const frame = resp.data[0] as any;
    const boolField = frame.fields.find((f: any) => f.name === 'active');
    expect(boolField?.type).toBe(FieldType.boolean);
  });

  it('handles string fields correctly', async () => {
    const ds = makeDS();
    const ndjson = '{"timestamp":"2026-01-01T10:00:00Z","level":"INFO","msg":"hello world"}';
    mockFetch.mockReturnValueOnce(makeFetchResponse(ndjson));
    const resp = await ds.query(makeQueryOptions([{ file: '/tmp/test.pfc', format: 'table' }]));
    const frame = resp.data[0] as any;
    const msgField = frame.fields.find((f: any) => f.name === 'msg');
    expect(msgField?.type).toBe(FieldType.string);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Time Series format
// ─────────────────────────────────────────────────────────────────────────────

describe('query — timeseries format', () => {
  it('creates one frame per numeric field', async () => {
    const ds = makeDS();
    const ndjson = [
      '{"timestamp":"2026-01-01T10:00:00Z","cpu":10.5,"mem":2048}',
      '{"timestamp":"2026-01-01T10:01:00Z","cpu":15.2,"mem":3000}',
    ].join('\n');
    mockFetch.mockReturnValueOnce(makeFetchResponse(ndjson));
    const resp = await ds.query(makeQueryOptions([{ file: '/tmp/test.pfc', format: 'timeseries' }]));
    expect(resp.data.length).toBeGreaterThanOrEqual(2);
    const names = resp.data.map((f: any) => f.name);
    expect(names).toContain('cpu');
    expect(names).toContain('mem');
  });

  it('respects valueFields filter', async () => {
    const ds = makeDS();
    const ndjson = [
      '{"timestamp":"2026-01-01T10:00:00Z","cpu":10.5,"mem":2048,"disk":500}',
    ].join('\n');
    mockFetch.mockReturnValueOnce(makeFetchResponse(ndjson));
    const resp = await ds.query(makeQueryOptions([{
      file: '/tmp/test.pfc',
      format: 'timeseries',
      valueFields: 'cpu,disk',
    }]));
    const names = resp.data.map((f: any) => f.name);
    expect(names).toContain('cpu');
    expect(names).toContain('disk');
    expect(names).not.toContain('mem');
  });

  it('falls back to table if no timestamp field found', async () => {
    const ds = makeDS();
    const ndjson = '{"level":"INFO","cpu":10.5}';
    mockFetch.mockReturnValueOnce(makeFetchResponse(ndjson));
    const resp = await ds.query(makeQueryOptions([{ file: '/tmp/test.pfc', format: 'timeseries' }]));
    expect(resp.data).toHaveLength(1);
  });

  it('uses custom timestamp field hint', async () => {
    const ds = makeDS();
    const ndjson = '{"event_time":"2026-01-01T10:00:00Z","cpu":10.5}';
    mockFetch.mockReturnValueOnce(makeFetchResponse(ndjson));
    const resp = await ds.query(makeQueryOptions([{
      file: '/tmp/test.pfc',
      format: 'timeseries',
      timestampField: 'event_time',
    }]));
    expect(resp.data.length).toBeGreaterThanOrEqual(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Filter handling
// ─────────────────────────────────────────────────────────────────────────────

describe('query — filter handling', () => {
  it('sends valid JSON filter to gateway', async () => {
    const ds = makeDS();
    mockFetch.mockReturnValueOnce(makeFetchResponse('{"timestamp":"2026-01-01T10:00:00Z","level":"ERROR"}'));
    await ds.query(makeQueryOptions([{ file: '/tmp/test.pfc', filter: '{"level":"ERROR"}' }]));
    const callArgs = mockFetch.mock.lastCall![0];
    expect(callArgs.data.filter).toEqual({ level: 'ERROR' });
  });

  it('ignores malformed JSON filter gracefully', async () => {
    const ds = makeDS();
    mockFetch.mockReturnValueOnce(makeFetchResponse('{"timestamp":"2026-01-01T10:00:00Z","level":"INFO"}'));
    await expect(ds.query(makeQueryOptions([{ file: '/tmp/test.pfc', filter: 'not-json' }]))).resolves.toBeDefined();
    const callArgs = mockFetch.mock.lastCall![0];
    expect(callArgs.data.filter).toBeUndefined();
  });

  it('sends empty filter when filter is empty string', async () => {
    const ds = makeDS();
    mockFetch.mockReturnValueOnce(makeFetchResponse('{"timestamp":"2026-01-01T10:00:00Z","level":"INFO"}'));
    await ds.query(makeQueryOptions([{ file: '/tmp/test.pfc', filter: '' }]));
    const callArgs = mockFetch.mock.lastCall![0];
    expect(callArgs.data.filter).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Edge cases & Resilience
// ─────────────────────────────────────────────────────────────────────────────

describe('query — resilience', () => {
  it('skips hidden targets', async () => {
    const ds = makeDS();
    const resp = await ds.query(makeQueryOptions([{ file: '/tmp/test.pfc', hide: true }]));
    expect(resp.data).toHaveLength(0);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns empty data when no active targets', async () => {
    const ds = makeDS();
    const resp = await ds.query(makeQueryOptions([]));
    expect(resp.data).toHaveLength(0);
  });

  it('handles multiple targets independently', async () => {
    const ds = makeDS();
    mockFetch
      .mockReturnValueOnce(makeFetchResponse('{"timestamp":"2026-01-01T10:00:00Z","level":"INFO"}'))
      .mockReturnValueOnce(makeFetchResponse('{"timestamp":"2026-01-01T10:00:01Z","level":"WARN"}'));
    const resp = await ds.query(makeQueryOptions([
      { file: '/tmp/file1.pfc' },
      { file: '/tmp/file2.pfc' },
    ]));
    expect(resp.data).toHaveLength(2);
  });

  it('sends from_ts and to_ts to gateway', async () => {
    const ds = makeDS();
    mockFetch.mockReturnValueOnce(makeFetchResponse(''));
    await ds.query(makeQueryOptions([{ file: '/tmp/test.pfc' }], '2026-01-01T10:00:00Z', '2026-01-01T11:00:00Z'));
    const callArgs = mockFetch.mock.lastCall![0];
    expect(callArgs.data.from_ts).toContain('2026-01-01');
    expect(callArgs.data.to_ts).toContain('2026-01-01');
  });

  it('throws on gateway HTTP error', async () => {
    const ds = makeDS();
    mockFetch.mockReturnValueOnce(makeFetchError(404, { detail: 'file not found' }));
    await expect(ds.query(makeQueryOptions([{ file: '/tmp/missing.pfc' }]))).rejects.toThrow('404');
  });

  it('sends api key as x-api-key header', async () => {
    const ds = makeDS('http://localhost:8765', 'my-secret-key');
    mockFetch.mockReturnValueOnce(makeFetchResponse({ status: 'ok', version: '0.2.0' }));
    await ds.testDatasource();
    const callArgs = mockFetch.mock.lastCall![0];
    expect(callArgs.headers['x-api-key']).toBe('my-secret-key');
  });

  it('works without api key', async () => {
    const ds = makeDS('http://localhost:8765', '');
    mockFetch.mockReturnValueOnce(makeFetchResponse({ status: 'ok', version: '0.2.0' }));
    const result = await ds.testDatasource();
    expect(result.status).toBe('success');
    const callArgs = mockFetch.mock.lastCall![0];
    expect(callArgs.headers['x-api-key']).toBeUndefined();
  });

  it('annotationQuery returns empty array', async () => {
    const ds = makeDS();
    const result = await ds.annotationQuery();
    expect(result).toEqual([]);
  });

  it('handles 100 rows without error', async () => {
    const ds = makeDS();
    const rows = Array.from({ length: 100 }, (_, i) =>
      `{"timestamp":"2026-01-01T10:${String(i).padStart(2,'0')}:00Z","level":"INFO","value":${i}}`
    ).join('\n');
    mockFetch.mockReturnValueOnce(makeFetchResponse(rows));
    const resp = await ds.query(makeQueryOptions([{ file: '/tmp/test.pfc', format: 'table' }]));
    expect((resp.data[0] as any).length).toBe(100);
  });
});
