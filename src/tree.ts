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
// import type { Tree } from '@oada/list-lib';

export const tree: Record<string, any> = {
  bookmarks: {
    _type: 'application/vnd.oada.bookmarks.1+json',
    _rev: 0,
    trellisfw: {
      '_type': 'application/vnd.oada.trellisfw.1+json',
      '_rev': 0,
      'trading-partners': {
        '_type': 'application/vnd.oada.trading-partners.1+json',
        '_rev': 0,
        '*': {
          _type: 'application/vnd.oada.trading-partner.1+json',
          _rev: 0,
          bookmarks: {
            _type: 'application/vnd.oada.bookmarks.1+json',
            _rev: 0,
          },
        },
      },
      '*': {
        '_type': 'application/json',
        '_rev': 0,
        '*': {
          _type: 'application/vnd.oada.trading-partner.1+json',
          _rev: 0,
          bookmarks: {
            _type: 'application/vnd.oada.bookmarks.1+json',
            _rev: 0,
          },
        },
      }
    },
    services: {
      _type: 'application/vnd.oada.services.1+json',
      _rev: 0,
    },
  },
};

export default tree;
