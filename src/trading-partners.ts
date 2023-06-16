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
import type { OADAClient } from '@oada/client';
import tree from './tree.masterData.js';

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
    bookmarks: {
      _id: bookmarksId,
    },
    shared: {
      _id: sharedId,
    },
  };
}

// The tree PUTs here need to be revised. perhaps, just hack the tree...
async function mergeDocumentTree(oada: OADAClient, from: string, to: string) {
  const fromPath = `/${from}/bookmarks/trellisfw/documents`;
  const toPath = `/${to}/bookmarks/trellisfw/documents`;

  let documentTypeKeys: string[] = [];
  try {
    const { data: documentTypes } = await oada.get({ path: `${fromPath}` });
    documentTypeKeys = Object.keys(documentTypes ?? {}).filter(
      (k) => !k.startsWith('_')
    );
  } catch (error: any) {
    if (error.status !== 404) throw error;
  }

  for await (const type of documentTypeKeys) {
    try {
      const { data: documentType } = await oada.get({
        path: `${fromPath}/${type}`,
      });
      const documents = Object.fromEntries(
        Object.entries(documentType ?? {}).filter(
          ([key, _]) => !key.startsWith('_')
        )
      );
      await oada.put({
        path: `${toPath}/${type}`,
        tree,
        data: documents,
      });
    } catch (error_: any) {
      if (error_.status !== 404) throw error_;
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
  const { from, to } = job.config;

  // Record the bookmarks/shared used originally
  const { data: fromTP } = (await oada.get({
    path: `/${from}`,
  })) as unknown as { data: TradingPartner };

  const { data: toTP } = (await oada.get({
    path: `/${to}`,
  })) as unknown as { data: TradingPartner };

  await mergeDocumentTree(oada, from, to);

  // Move the trading-partner bookmarks/shared so any future references point
  // in the right place
  await oada.put({
    path: `/${from}`,
    data: {
      masterid: toTP.masterid,
      bookmarks: toTP.bookmarks,
      shared: toTP.shared,
      old: {
        masterid: fromTP.masterid,
        bookmarks: fromTP.bookmarks,
        shared: fromTP.shared,
      },
      frozen: true,
    },
  });
}
