/**
 * @license
 * Copyright 2022 Qlever LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import config from './config.masterdata.js';
import debug from 'debug';
import _ from 'lodash';
import type { OADAClient } from '@oada/client';
import tree from './tree.masterData.js';
//import type TradingPartner from '@oada/types/trellis/trading-partners/trading-partner.js';

const SERVICE_NAME = config.get('service.name');

if (SERVICE_NAME && tree?.bookmarks?.services?.['fl-sync']) {
  tree.bookmarks.services[SERVICE_NAME] = tree.bookmarks.services['fl-sync'];
}

const info = debug('trellis-data-manager:trading-partners:info');
const error = debug('trellis-data-manager:trading-partners:error');

export const trellisTPTemplate = {
  id: '',
  masterid: '',
  companycode: '',
  vendorid: '',
  partnerid: '',
  name: '',
  address: '',
  city: '',
  state: '',
  type: 'CUSTOMER',
  coi_emails: '',
  fsqa_emails: '',
  email: '',
  phone: '',
  externalIds: [],
};

export interface TradingPartner {
  id: string;
  masterid: string;
  companycode?: string;
  vendorid?: string;
  partnerid?: string;
  name: string;
  address: string;
  city: string;
  state: string;
  coi_emails: string;
  fsqa_emails: string;
  email: string;
  phone: string;
  foodlogiq?: string;
  bookmarks: {
    _id: string;
  };
  shared: {
    _id: string;
  };
  externalIds: string[];
  frozen: boolean;
}

export async function generateTP(oada: OADAClient) {
  // Create bookmarks
  let bookmarks;
  try {
    const { headers } = await oada.post({
      path: `/resources`,
      data: {},
      contentType: 'application/vnd.oada.bookmarks.1+json',
    });
    bookmarks = headers['content-location'];
  } catch (error_: unknown) {
    error(error_);
    throw error_;
  }

  const bookmarksId = bookmarks!.replace(/^\//, '');
  info(`/bookmarks created for trading partner`);

  let shared;
  try {
    const { headers } = await oada.post({
      path: `/resources`,
      data: {},
      contentType: 'application/vnd.oada.bookmarks.1+json',
    });
    shared = headers['content-location'];
  } catch (error_: unknown) {
    error(error_);
    throw error_;
  }

  const sharedId = shared!.replace(/^\//, '');
  info(`/shared created for trading partner`);

  return {
    //...trellisTPTemplate,
    bookmarks: {
      _id: bookmarksId,
    },
    shared: {
      _id: sharedId,
    },
  };
}

const basePath = (string_: string) =>
  `/bookmarks/trellisfw/trading-partners/${string_}/bookmarks/trellisfw/documents`;

async function mergeDocTree(oada: OADAClient, from: string, to: string) {
  // 1. record the bookmarks/shared used originally
  // 2. merge the two trees
  const { data: docTypes } = await oada.get({ path: basePath(from) });
  const docTypeKeys = Object.keys(docTypes ?? {}).filter((k) => !k.startsWith('_'));

  for await (const type of docTypeKeys) {
    const { data: docType } = await oada.get({
      path: `${basePath(from)}/${type}`,
    });
    const docKeys = Object.keys(docType ?? {}).filter(
      (k) => !k.startsWith('_')
    );

    for await (const docKey of docKeys) {
      const { data: docs } : {data?: any}= await oada.get({ path: `${basePath(from)}/${type}` })
      await oada.put({
        path: `${basePath(to)}/${type}`,
        tree,
        data: {
          [docKey]: docs![docKey]!,
        }
      })
    }
  }
}

export interface TradingPartnerMergeJob {
  config: {
    from: string;
    to: string;
    externalIds?: string[];
  };
}

export async function mergeTPs(oada: OADAClient, job: TradingPartnerMergeJob) {
  const { from, to, externalIds } = job.config;

  // 1. record the bookmarks/shared used originally
  const { data: fromTP } = (await oada.get({
    path: `/bookmarks/trellisfw/trading-partners/${from}`,
  })) as unknown as { data: TradingPartner };

  const { data: toTP } = (await oada.get({
    path: `/bookmarks/trellisfw/trading-partners/${to}`,
  })) as unknown as { data: TradingPartner };

  //2. Update the externalId so search results begin to refer to this trading partner
  if (externalIds) {
    await oada.put({
      path: `/bookmarks/trellisfw/trading-partners/${to}`,
      data: {
        // @ts-expect-error fixme
        externalIds: [...new Set((toTP!.externalIds || []).push(externalIds))] as string[],
      },
    });
  }

  // 3. Delete the trading-partner to fail them over during
  await oada.delete({
    path: `/bookmarks/trellisfw/trading-partners/${from}`,
  });

  // 4. merge the two trees
  await mergeDocTree(oada, from, to);

  // 5. move the trading-partner bookmarks/shared so any future references point in the right place
  await oada.put({
    path: `/bookmarks/trellisfw/trading-partners/${from}`,
    data: {
      masterid: toTP.masterid,
      bookmarks: toTP.bookmarks,
      shared: toTP.shared,
      old: {
        bookmarks: fromTP.bookmarks,
        shared: fromTP.shared,
      },
      frozen: true,
    },
  });
}
