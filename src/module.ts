import { DataSourcePlugin } from '@grafana/data';
import { PfcDataSource } from './datasource';
import { ConfigEditor } from './components/ConfigEditor';
import { QueryEditor } from './components/QueryEditor';
import { PfcQuery, PfcDataSourceOptions } from './types';

export const plugin = new DataSourcePlugin<PfcDataSource, PfcQuery, PfcDataSourceOptions>(PfcDataSource)
  .setConfigEditor(ConfigEditor)
  .setQueryEditor(QueryEditor);
