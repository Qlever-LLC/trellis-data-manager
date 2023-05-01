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

const SERVICE_NAME = config.get('service.name');

if (SERVICE_NAME && tree?.bookmarks?.services?.['fl-sync']) {
  tree.bookmarks.services[SERVICE_NAME] = tree.bookmarks.services['fl-sync'];
}

const info = debug('trellis-data-manager:trading-partners:info');
const error = debug('trellis-data-manager:trading-partners:error');

export const trellisTPTemplate = {
  id: '',
  sapid: '',
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
};

export interface TradingPartner {
  id: string;
  sapid: string;
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
}

export async function generateTP(data: any, oada: OADAClient) {
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
  info(`/bookmarks created for trading partner masterid: ${data.masterid}`);

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
  info(`/shared created for trading partner masterid: ${data.masterid}`);

  return {
    ...trellisTPTemplate,
    bookmarks: {
      _id: bookmarksId,
    },
    shared: {
      _id: sharedId,
    },
  };
}
