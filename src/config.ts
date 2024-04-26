/**
 * @license
 * Copyright 2021 Qlever LLC
 *
 * Licensed under the Apache License, Version 2.0 (the 'License');
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an 'AS IS' BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import libConfig from '@oada/lib-config';

export const { config } = await libConfig({
  production: {
    doc: 'Whether to run with production naming/oada paths or else testing prefixes',
    default: false,
    env: 'PRODUCTION',
    arg: 'production',
  },
  service: {
    path: {
      doc: 'Base path for the service',
      default: '/bookmarks/services/trellis-data-manager',
      env: 'SERVICE_PATH',
      arg: 'service_path',
    },
    name: {
      doc: 'Name of the service; used by jobs lib; helps configuring tests separately',
      default: 'trellis-data-manager',
      env: 'SERVICE_NAME',
      arg: 'service_name',
    },
  },
  services: {
    query: {
      doc: '',
      format: Boolean,
      default: true,
      env: 'TARGET_SERVICE',
      arg: 'targetServiceService',
    },
    merge: {
      doc: 'Enable/disable subservice watching the configuration',
      format: Boolean,
      default: true,
      env: 'WATCH_CONFIG_SERVICE',
      arg: 'watchConfigService',
    },
  },
  timeouts: {
    query: {
      doc: 'Timeout duration for query jobs',
      format: 'duration',
      // The types for duration suck
      default: 86_400_000 as unknown as number,
      env: 'QUERY_TIMEOUT',
      arg: 'query-timeout',
    },
  },
  oada: {
    domain: {
      doc: 'OADA API domain',
      format: String,
      default: 'proxy',
      env: 'DOMAIN',
      arg: 'domain',
    },
    token: {
      doc: 'OADA API token',
      format: String,
      default: 'god-proxy',
      env: 'TOKEN',
      arg: 'token',
    },
    connectTimeout: {
      doc: 'OADA API connect timeout',
      format: Number,
      default: 20_000,
      env: 'CONNECT_TIMEOUT',
      arg: 'connect-timeout',
    }
  },
  concurrency: {
    doc: 'concurrency',
    format: Number,
    default: 1,
    env: 'CONCURRENCY',
    arg: 'concurrency',
  },
});
