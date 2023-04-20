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
import type { Tree } from '@oada/types/oada/tree/v1.js';
export const tree: Tree = {
  bookmarks: {
    _type: 'application/vnd.oada.bookmarks.1+json',
    _rev: 0,
    trellisfw: {
      '_type': 'application/vnd.trellis.1+json',
      '_rev': 0,
      'trading-partners': {
        '_type': 'application/vnd.trellisfw.trading-partners.1+json',
        '_rev': 0,
        '_meta': {
          indexings: {
            'expand-index': {
              '_type': 'application/vnd.trellisfw.trading-partners.1+json',
              '_rev': 0,
            }
          }
        },
        '*': {
          _type: 'application/vnd.trellisfw.trading-partner.1+json',
          _rev: 0,
        },
      },
    },
  },
};

export default tree;
