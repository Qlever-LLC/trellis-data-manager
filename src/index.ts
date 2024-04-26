/**
 * @license
 * Copyright 2022 Qlever LLC
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

// Import this _before_ pino and/or DEBUG
import '@oada/pino-debug';

// Import this first to setup the environment
//import { assert as assertTP } from '@oada/types/trellis/trading-partners/trading-partner.js';
import cloneDeep from 'clone-deep';
import { config } from './config.js';
import { connect } from '@oada/client';
import debug from 'debug';
import esMain from 'es-main';
import { generateTP } from './trading-partners.js';
import { mergeTPs } from './trading-partners.js';
import type { OADAClient } from '@oada/client';
import { Search } from './search.js';
import { Service } from '@oada/jobs';
import type TradingPartner from '@oada/types/trellis/trading-partners/trading-partner.js';
import { tree } from './tree.masterData.js';
const log = {
  error: debug('tdm:error'),
  info: debug('tdm:info'),
  trace: debug('tdm:trace'),
};

const { token, domain, connectTimeout } = config.get('oada');
const NAME = config.get('service.name');
//const concurrency = config.get('concurrency');
const PRODUCTION = config.get('production');
const SERVICE_NAME = `${PRODUCTION ? '' : 'test-'}${NAME}`;

const path = PRODUCTION
  ? `/bookmarks/trellisfw/trading-partners`
  : `/bookmarks/test/trading-partners`;
let oada: OADAClient;
tree.bookmarks!.test = cloneDeep(tree.bookmarks!.trellisfw) ?? {};

/**
 * Start-up for a given user (token)
 */
export async function run() {
  // Connect to the OADA API
  const conn = oada
    ? oada.clone(token)
    : (oada = await connect({ token, domain, timeouts: { connect: connectTimeout }}));

  // Start up the in-memory cache of master data elements

  const svc = new Service({
    name: SERVICE_NAME,
    oada: conn,
    concurrency: 1,
  });

  // Catch errors
  try {
    // Set the job type handlers
    const m = new Search<TradingPartner>({
      oada: conn,
      path,
      name: 'trading-partners',
      service: svc,
      //assert: assertTP,
      generate: generateTP,
      merge: mergeTPs,
      tree,
      // Get searchKeys from the schema somehow?
      searchKeys: [
        {
          name: 'name',
          weight: 2,
        },
        'phone',
        'email',
        'address',
        'city',
        'state',
      ],
    });
    await m.init();
    // Start the jobs watching service
    await svc.start();
  } catch (cError: unknown) {
    log.error(cError);
    // eslint-disable-next-line no-process-exit, unicorn/no-process-exit
    process.exit(1);
  }

  log.info('trellis-data-manager startup complete. It is now running...');
}

if (esMain(import.meta)) {
  log.info('Starting up the service. Calling initialize');
  await run();
} else {
  log.info('Just importing fl-sync');
}

export * as tradingPartners from './trading-partners.js';
export * as search from './search.js';