import { DataQuery, DataSourceJsonData } from '@grafana/data';

export interface PfcQuery extends DataQuery {
  /** Path to .pfc file — local path or s3://bucket/key.pfc (not used in SQL mode) */
  file: string;
  /** Optional: filter rows by field value, e.g. {"level": "ERROR"} */
  filter?: string;
  /** Return format */
  format: 'table' | 'timeseries' | 'logs' | 'sql';
  /** SQL query string (only used when format === 'sql') */
  sqlQuery?: string;
  /** Field to use as timestamp (default: auto-detect timestamp/ts/@timestamp) */
  timestampField?: string;
  /** Fields to plot as time series (comma-separated, empty = all numeric) */
  valueFields?: string;
}

export const defaultQuery: Partial<PfcQuery> = {
  file: '',
  filter: '',
  format: 'table',
  sqlQuery: '',
  timestampField: '',
  valueFields: '',
};

export interface PfcDataSourceOptions extends DataSourceJsonData {
  /** pfc-gateway base URL, e.g. http://localhost:8765 */
  url: string;
}

export interface PfcSecureJsonData {
  /** pfc-gateway API key */
  apiKey?: string;
}

export interface GatewayQueryPayload {
  file: string;
  from_ts?: string;
  to_ts?: string;
  filter?: Record<string, unknown>;
}
