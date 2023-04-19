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

//import { setTimeout } from 'node:timers/promises';

import debug from 'debug';
import _ from 'lodash';

import type { JsonObject, OADAClient } from '@oada/client';

import tree from './tree.masterData.js';

const SERVICE_NAME = config.get('service.name');
// TL_TP: string = config.get('trellis.endpoints.service-tp');
const TL_TP = `/bookmarks/trellisfw/trading-partners`;
//const TL_TP_MI = `${TL_TP}/masterid-index`;
//const TL_TP_EI = `${TL_TP}/expand-index`;

//let oada: OADAClient;
if (SERVICE_NAME && tree?.bookmarks?.services?.['fl-sync']) {
  tree.bookmarks.services[SERVICE_NAME] = tree.bookmarks.services['fl-sync'];
}

const info = debug('trellis-data-manager:trading-partners:info');
const error = debug('trellis-data-manager:trading-partners:error');
//const trace = debug('trellis-data-manager:trading-partners:trace');

enum SourceType {
  Vendor = 'vendor',
  Business = 'business',
}


/**
 * updates the expand index with the information extracted
 * from the received FL business
 * @param expandIndexRecord expand index content
 */
async function updateExpandIndex(
  expandIndexRecord: ExpandIndexRecord,
  key: string,
  path: string,
  oada: OADAClient,
) {
  try {
    // Expand index
    await oada.put({
      path,
      data: {
        [key]: expandIndexRecord as unknown as JsonObject,
      },
      tree,
    });
    info('--> expand index updated. ');
  } catch (error_: unknown) {
    error({ error: error_ }, '--> error when mirroring expand index.');
  }
} // UpdateExpandIndex

interface TradingPartner {
  id: string;
  sapid: string;
  masterid: string;
  internalid: string;
  companycode?: string;
  vendorid?: string;
  partnerid?: string;
  name: string;
  address: string;
  city: string;
  state: string;
  type: string;
  source: SourceType;
  coi_emails: string;
  fsqa_emails: string;
  email: string;
  phone: string;
  foodlogiq?: string;
}
//type ITradingPartner = Record<string, TradingPartner>;
//const TradingPartners: ITradingPartner = {};

//type IExpandIndex = Record<string, ExpandIndexRecord>;

interface ExpandIndexRecord {
  id: string;
  internalid: string;
  masterid: string;
  sapid: string;
  companycode?: string;
  vendorid?: string;
  partnerid?: string;
  address: string;
  city: string;
  coi_emails: string;
  email: string;
  fsqa_emails: string;
  name: string;
  phone: string;
  state: string;
  type: string;
  source: SourceType;
  user: Bookmarks;
}

const expandIndexTemplate: ExpandIndexRecord = {
  address: '',
  city: '',
  coi_emails: '',
  email: '',
  fsqa_emails: '',
  id: '',
  internalid: '',
  masterid: '',
  name: '',
  phone: '',
  sapid: '',
  companycode: '',
  vendorid: '',
  partnerid: '',
  state: '',
  type: 'CUSTOMER',
  source: SourceType.Business,
  user: {
    bookmarks: {
      _id: '',
    },
  },
};

interface Bookmarks {
  bookmarks: {
    _id: string;
  };
}

export const trellisTPTemplate: TradingPartner = {
  id: '', // Both (vendor and business)
  sapid: '', // Business
  masterid: '', // Business
  internalid: '', // Business
  companycode: '',
  vendorid: '',
  partnerid: '',
  name: '', // Both
  address: '', // Both
  city: '', // Both
  state: '', // Both
  type: 'CUSTOMER', // Both
  source: SourceType.Business,
  coi_emails: '', // Business
  fsqa_emails: '', // Business
  email: '', // Both
  phone: '', // Both,
};
//Things this code does:
// create resource for trading partner
// link the tp into the list
// create the bookmarks for the tp
// link it in
//Things this code should do:
//create a new trading partner
//use the resource id as masterid
// use masterid as the key in the tp list
// create the bookmarks
export async function generateTP(data: any, contentType: string, oada: OADAClient, path: string) {
  info('Mirroring the business into trading partners.');
  // Create the TP resource
  let location;
  try {
    const { headers } = await oada.post({
      path: `/resources`,
      data: data as unknown as JsonObject,
      contentType,
    });
    location = headers['content-location'];
  } catch (error_: unknown) {
    error(error_);
    throw error_;
  }

  const resourceId = location!.replace(/^\//, '');
  data = {
    ...data,
    masterid: resourceId,
    id: resourceId,
  }
  // Add the masterid to the TP resource
  await oada.put({
    path: location!,
    data,
  });
  //Create the TP link
  const link = { _id: resourceId, _rev: 0 };
  const key = resourceId.replace(/^resources\//, '');
  try {
    await oada.put({
      path: `${TL_TP}`,
      data: {
        [key]: link,
      },
      tree,
    });
    info('----> business mirrored. ', `${TL_TP}/${key}`);
    // Create bookmarks endpoint for the TP
    const { headers } = await oada.put({
      path: `${TL_TP}/${key}/bookmarks`,
      data: {},
      tree,
    });
    const _bookmarks_id: string = headers?.['content-location'] ?? '';
    const _string_content = _bookmarks_id.slice(1);
    const _bookmarks_data: Bookmarks = {
      bookmarks: {
        _id: _string_content,
      },
    };

    // Now create and insert the expand index record
    const expandData: ExpandIndexRecord = {
      ..._.cloneDeep(expandIndexTemplate),
      ...data,
      type: 'CUSTOMER',
      user: _bookmarks_data,
    }

    // Updating the expand index
    info('--> updating the expand-idex ', expandData.masterid);
    await updateExpandIndex(expandData, key, path, oada);

    return expandData;
  } catch (error_: unknown) {
    error('--> error ', error_);
    throw error_ as Error;
  }
}