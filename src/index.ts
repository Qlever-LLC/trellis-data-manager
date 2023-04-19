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
import { assert as assertTP } from '@oada/types/trellis/service/master-data-sync/tradingpartners.js';
import config from './config.js';
import { connect } from '@oada/client';
import debug from 'debug';
import esMain from 'es-main';
import { generateTP } from './trading-partners.js';
import type { OADAClient } from '@oada/client';
import { Search } from './search.js';
import { Service } from '@oada/jobs';
import type TradingPartner from '@oada/types/trellis/service/master-data-sync/tradingpartners.js';
const log = {
  error: debug('tdm:error'),
  info: debug('tdm:info'),
  trace: debug('tdm:trace'),
};

const { token, domain } = config.get('oada');
const { name: SERVICE_NAME } = config.get('service');

//const tradingPartnerExpand = `/bookmarks/trellisfw/trading-partners/expand-index`;
const tradingPartner = `/bookmarks/trellisfw/trading-partners`;
let oada: OADAClient;

/**
 * Start-up for a given user (token)
 */
export async function run() {
  // Connect to the OADA API
  const conn = oada
    ? oada.clone(token)
    : (oada = await connect({ token, domain }));

  // Start up the in-memory cache of master data elements

  const svc = new Service({
    name: SERVICE_NAME,
    oada: conn,
  });

  // Catch errors
  try {
    // Start the jobs watching service
    await svc.start();
    // Set the job type handlers
    const m = new Search<TradingPartner>({
      //client,
      oada: conn,
      path: tradingPartner,
      name: 'trading-partners',
      service: svc,
      assert: assertTP,
      generate: generateTP,
      contentType: 'application/vnd.trellisfw.trading-partner.1+json',
    });
    await m.init();
  } catch (cError: unknown) {
    log.error(cError);
    // eslint-disable-next-line no-process-exit, unicorn/no-process-exit
    process.exit(1);
  }

  log.info('Started trellis-data-manager');
}

/*
mappings: {
      properties: {
        id: { type: 'text' },
        sapid: { type: 'text' },
        masterid: { type: 'text' },
        internalid: { type: 'text' },
        companycode: { type: 'text' },
        vendorid: { type: 'text' },
        partnerid: { type: 'text' },
        name: { type: 'text' },
        address: { type: 'text' },
        city: { type: 'text' },
        state: { type: 'text' },
        type: { type: 'text' },
        source: { type: 'text' },
        coi_emails: { type: 'text' },
        fsqa_emails: { type: 'text' },
        email: { type: 'text' },
        phone: { type: 'text' },
      },
    },
*/

if (esMain(import.meta)) {
  log.info('Starting up the service. Calling initialize');
  await run();
} else {
  log.info('Just importing fl-sync');
}