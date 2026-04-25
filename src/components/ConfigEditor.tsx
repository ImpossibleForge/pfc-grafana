import React, { ChangeEvent } from 'react';
import { InlineField, Input, SecretInput } from '@grafana/ui';
import { DataSourcePluginOptionsEditorProps } from '@grafana/data';
import { PfcDataSourceOptions, PfcSecureJsonData } from '../types';

interface Props extends DataSourcePluginOptionsEditorProps<PfcDataSourceOptions, PfcSecureJsonData> {}

export function ConfigEditor({ options, onOptionsChange }: Props) {
  const { jsonData, secureJsonFields, secureJsonData } = options;

  const onUrlChange = (event: ChangeEvent<HTMLInputElement>) => {
    onOptionsChange({
      ...options,
      jsonData: { ...jsonData, url: event.target.value },
    });
  };

  const onApiKeyChange = (event: ChangeEvent<HTMLInputElement>) => {
    onOptionsChange({
      ...options,
      secureJsonData: { apiKey: event.target.value },
    });
  };

  const onResetApiKey = () => {
    onOptionsChange({
      ...options,
      secureJsonFields: { ...secureJsonFields, apiKey: false },
      secureJsonData: { ...secureJsonData, apiKey: '' },
    });
  };

  return (
    <div>
      <InlineField label="pfc-gateway URL" labelWidth={20} tooltip="Base URL of your pfc-gateway instance (e.g. http://localhost:8765)">
        <Input
          width={40}
          value={jsonData.url ?? ''}
          placeholder="http://localhost:8765"
          onChange={onUrlChange}
        />
      </InlineField>

      <InlineField label="API Key" labelWidth={20} tooltip="API key configured in pfc-gateway (leave empty if no auth is set)">
        <SecretInput
          width={40}
          value={secureJsonData?.apiKey ?? ''}
          isConfigured={Boolean(secureJsonFields?.apiKey)}
          placeholder="your-api-key (optional)"
          onChange={onApiKeyChange}
          onReset={onResetApiKey}
        />
      </InlineField>
    </div>
  );
}
