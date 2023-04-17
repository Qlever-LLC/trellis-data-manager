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

import _ from 'lodash';
import config from '../dist/config.js';
import test from 'ava';
import { connect } from '@oada/client';
import type { OADAClient } from '@oada/client';
import { assert as assertTP } from '@oada/types/trellis/service/master-data-sync/tradingpartners.js';
import { generateTP } from '../dist/trading-partners.js';
import { Search } from '../dist/search.js';
import { Service } from '@oada/jobs';
import { tree } from '../dist/tree.js';
import { setTimeout } from 'node:timers/promises';

const { token, domain } = config.get('oada');

let testTree = _.cloneDeep(tree);
testTree.bookmarks.test = _.cloneDeep(testTree.bookmarks.trellisfw['trading-partners']);

let conn: OADAClient;

type TestElement = {
  id?: string;
  name?: string;
  phone?: string;
  email?: string;
  address?: string;
  city?: string;
  state?: string;
  sapid?: string;
  key?: string;
}

let search: Search<TestElement>;

const testObject = {
  '1': {
    id: '1',
    name: 'John Doe',
    phone: '1234567890',
    email: 'john.doe@example.com',
    address: '123 Main St.',
    city: 'Anytown',
    state: 'USA',
    sapid: '123456789',
    key: '1',
  },
  '2': {
    id: '2',
    name: 'Jane Smith',
    phone: '0987654321',
    email: 'jane.smith@example.com',
    address: '456 Second St.',
    city: 'Somewhere',
    state: 'USA',
    sapid: '987654321',
    key: '2',
  },
};

test.before('Start up the service', async () => {
  conn = await connect({ token, domain });

  const svc = new Service({
    name: 'test-service',
    oada: conn,
  })
  await svc.start();

  search = new Search<TestElement>({
    assert: assertTP,
    generate: generateTP,
    name: 'test',
    oada: conn,
    path: '/bookmarks/test',
    service: svc,
    contentType: 'application/vnd.trellisfw.trading-partner.1+json',
  });

  search.indexObject = _.cloneDeep(testObject);
  await search.init();
});

test.after('Clean up the service', async () => {
  await conn.delete({
    path: `/bookmarks/test/test11111`,
  })
})

test('setCollection should set the index object and search index', (t) => {
  search.setCollection(search.indexObject);
  t.deepEqual(search.indexObject, {
    '1': {
      id: '1',
      name: 'John Doe',
      phone: '1234567890',
      email: 'john.doe@example.com',
      address: '123 Main St.',
      city: 'Anytown',
      state: 'USA',
      sapid: '123456789',
      key: '1',
    },
    '2': {
      id: '2',
      name: 'Jane Smith',
      phone: '0987654321',
      email: 'jane.smith@example.com',
      address: '456 Second St.',
      city: 'Somewhere',
      state: 'USA',
      sapid: '987654321',
      key: '2',
    },
  });
});

test('should throw an error if no matches are found', async (t) => {
  try {
    await search.query({ config: { element: { name: 'Mary Johnson' } } } as any);
  } catch (error) {
    t.deepEqual(error, new Error('No matches found'));
  }
});

test('should return a match if one is found', async (t) => {
  search.setCollection(search.indexObject);
  const result = (await search.query({ config: { element: { name: 'Jane Smith' } } } as any)) as any[];

  t.deepEqual(result![0].item, { key: '2', ...search.indexObject['2'] });
});

test('should return matches if multiple are found', async (t) => {
  search.setCollection(search.indexObject);
  const result = (await search.query({ config: { element: { state: 'USA', email: 'h@example.com'} } } as any)) as any[];

  t.is(result.length, 2);
  t.deepEqual(result![0].item, {key: '2', ...search.indexObject['2']});
  t.deepEqual(result![1].item, {key: '1', ...search.indexObject['1']});
});

test('Should add an item and return it when queried', async (t) => {
  const item = { id: '123', name: 'John Doe', phone: '123-456-7890' };
  await search.setItem({item, pointer: item.id});
  const result = (await search.query({ config: { element: { name: 'John Doe' } } })) as any[];
  t.is(result.length, 2);
  t.deepEqual(result![0].item.name, 'John Doe');
  t.deepEqual(result![1].item.name, 'John Doe');
});

test('should update an item and return it when queried', async (t) => {
  search.indexObject = _.cloneDeep(testObject);
  search.setCollection(search.indexObject);
  const updatedItem = { ...testObject['1'], phone: '098-765-4321' };
  await search.setItem({ item: updatedItem, pointer: updatedItem.id });
  const result = (await search.query({ config: { element: { name: 'John Doe' } } })) as any[];
  t.deepEqual(result![0].item, updatedItem);
});

test('should remove an item and not return it when queried', async (t) => {
  search.indexObject = _.cloneDeep(testObject);
  search.setCollection(search.indexObject);
  await search.removeItem({pointer: testObject['1'].id});
  const result = (await search.query({ config: { element: { name: 'John Doe' } } })) as any[];
  t.is(result.length, 0);
});

test('should throw an error when querying with no matches', async (t) => {
  search.indexObject = _.cloneDeep(testObject);
  search.setCollection(search.indexObject);
  // @ts-ignore
  const err = await t.throwsAsync(async () => await search.query({ config: { element: { name: 'Bob Vila' } } }));
  t.deepEqual(err!.message,'No matches found');
});

test('should throw an error when ensuring with multiple matches', async (t) => {
  const item1 = { id: '123', name: 'John Doe', phone: '123-456-7890' };
  const item2 = { id: '456', name: 'John Doe', phone: '098-765-4321' };
  await search.setItem({pointer: item1.id, item: item1});
  await search.setItem({pointer: item2.id, item: item2});
  // @ts-ignore
  const err = await t.throwsAsync(async () => await search.ensure({ config: { element: { name: 'John Doe' } } }))
  t.deepEqual(err!.message,'multiple matches found');
});

/* assertion really cannot fail so long as items are created from the base template...
test.only('should create an entry if none exist when ensuring', async (t) => {
  const item = { name: 'Jane Doe', phone: '123-456-7890' };
  // @ts-ignore
  const err = await t.throwsAsync(async () => await search.ensure({ config: { element: item } }))
  t.deepEqual(err!.message,'assertion failed');
});
*/

test('Adding an item to the expand index should land it in the collection', async (t) => {
  const key = 'test11111';
  const data = {
    city: 'Testing',
    address: '444 Test Street',
    email: 'testemail@gmail.com',
    id: 'resources/test111111111',
    name: 'Centricity Test Company, LLC',
    phone: '000-111-2222',
    sapid:
      'fd30697387c306ee33506f78e0b8265fc89a90385c005adc0ddec5894aea6f1f',
    type: 'CUSTOMER',
  };
  await conn.put({
    path: `${search.path}/${key}`,
    data,
    tree: testTree,
  });

  await setTimeout(3_000);

  const searchObj = Object.fromEntries(
    Object.entries(search.index._docs[0]).filter(([key]) => !key.startsWith('_'))
  );
  t.deepEqual(searchObj, { ...data, key });
});

test.only('Removing an item from the expand index should prevent it from being returned', async (t) => {
  const key = 'test11111';
  const data = {
    city: 'Testing',
    address: '444 Test Street',
    email: 'testemail@gmail.com',
    id: 'resources/test111111111',
    name: 'Centricity Test Company, LLC',
    phone: '000-111-2222',
    sapid:
      'fd30697387c306ee33506f78e0b8265fc89a90385c005adc0ddec5894aea6f1f',
    type: 'CUSTOMER',
  };
  await conn.put({
    path: `${search.path}/${key}`,
    data,
    tree: testTree,
  });

  await setTimeout(3_000);

  await conn.delete({
    path: `${search.path}/${key}`,
  });

  await setTimeout(3_000);

  t.deepEqual(search.index._docs.length, 0);
});