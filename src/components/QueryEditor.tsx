import React, { ChangeEvent } from 'react';
import { InlineField, Input, Select, TextArea } from '@grafana/ui';
import { QueryEditorProps, SelectableValue } from '@grafana/data';
import { PfcDataSource } from '../datasource';
import { PfcDataSourceOptions, PfcQuery, defaultQuery } from '../types';

type Props = QueryEditorProps<PfcDataSource, PfcQuery, PfcDataSourceOptions>;

const FORMAT_OPTIONS: Array<SelectableValue<string>> = [
  { label: 'Table', value: 'table', description: 'All fields as columns' },
  { label: 'Time Series', value: 'timeseries', description: 'Numeric fields plotted over time' },
  { label: 'Logs', value: 'logs', description: 'Log lines with timestamp' },
  { label: 'SQL', value: 'sql', description: 'Run SQL via DuckDB + pfc extension (requires DuckDB on gateway server)' },
];

export function QueryEditor({ query, onChange, onRunQuery }: Props) {
  const q = { ...defaultQuery, ...query };

  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    onChange({ ...q, file: event.target.value });
  };

  const onFilterChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    onChange({ ...q, filter: event.target.value });
  };

  const onFormatChange = (value: SelectableValue<string>) => {
    onChange({ ...q, format: (value.value as PfcQuery['format']) ?? 'table' });
    onRunQuery();
  };

  const onTimestampFieldChange = (event: ChangeEvent<HTMLInputElement>) => {
    onChange({ ...q, timestampField: event.target.value });
  };

  const onValueFieldsChange = (event: ChangeEvent<HTMLInputElement>) => {
    onChange({ ...q, valueFields: event.target.value });
  };

  const onSqlQueryChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    onChange({ ...q, sqlQuery: event.target.value });
  };

  return (
    <div>
      {q.format !== 'sql' && (
        <InlineField
          label="PFC File"
          labelWidth={16}
          tooltip="Local path or S3 URI to a .pfc archive (e.g. /var/lib/pfc/logs.pfc or s3://bucket/logs.pfc)"
          grow
        >
          <Input
            value={q.file}
            placeholder="/var/lib/pfc/logs_20260101.pfc  or  s3://my-bucket/logs.pfc"
            onChange={onFileChange}
            onBlur={onRunQuery}
          />
        </InlineField>
      )}

      <InlineField
        label="Format"
        labelWidth={16}
        tooltip="How to return data to Grafana"
      >
        <Select
          width={20}
          options={FORMAT_OPTIONS}
          value={q.format}
          onChange={onFormatChange}
        />
      </InlineField>

      {q.format !== 'sql' && (
        <InlineField
          label="Filter (JSON)"
          labelWidth={16}
          tooltip='Optional: filter rows by field value, e.g. {"level": "ERROR", "service": "api"}'
          grow
        >
          <TextArea
            value={q.filter ?? ''}
            placeholder='{"level": "ERROR"}'
            rows={2}
            onChange={onFilterChange}
            onBlur={onRunQuery}
          />
        </InlineField>
      )}

      {q.format === 'sql' && (
        <InlineField
          label="SQL Query"
          labelWidth={16}
          tooltip="SQL query using DuckDB with pfc extension. Use pfc_scan('/path/to/file.pfc') as table source."
          grow
        >
          <TextArea
            value={q.sqlQuery ?? ''}
            placeholder={"SELECT json_extract_string(line, '$.level') AS level,\n       COUNT(*) AS cnt\nFROM pfc_scan('/var/lib/pfc/logs.pfc')\nGROUP BY level ORDER BY cnt DESC"}
            rows={5}
            onChange={onSqlQueryChange}
            onBlur={onRunQuery}
          />
        </InlineField>
      )}

      {q.format === 'timeseries' && (
        <>
          <InlineField
            label="Timestamp Field"
            labelWidth={16}
            tooltip="Field to use as time axis (auto-detected: timestamp, @timestamp, ts, time)"
          >
            <Input
              width={24}
              value={q.timestampField ?? ''}
              placeholder="auto-detect"
              onChange={onTimestampFieldChange}
              onBlur={onRunQuery}
            />
          </InlineField>

          <InlineField
            label="Value Fields"
            labelWidth={16}
            tooltip="Comma-separated numeric fields to plot (empty = all numeric fields)"
          >
            <Input
              width={40}
              value={q.valueFields ?? ''}
              placeholder="usage_user, usage_idle (empty = all numeric)"
              onChange={onValueFieldsChange}
              onBlur={onRunQuery}
            />
          </InlineField>
        </>
      )}
    </div>
  );
}
