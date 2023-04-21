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
//import { assert as assertTP } from '@oada/types/trellis/service/master-data-sync/tradingpartners.js';
//import { generateTP } from '../dist/trading-partners.js';
import { Search } from '../dist/search.js';
import { Service } from '@oada/jobs';
import { tree } from '../dist/tree.masterData.js';
import { setTimeout } from 'node:timers/promises';

const { token, domain } = config.get('oada');

let testTree = _.cloneDeep(tree);
testTree!.bookmarks!.test = _.cloneDeep(testTree!.bookmarks!.trellisfw!['trading-partners']) || {};

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
  masterid?: string;
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
    masterid: 'resources/123456789',
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
    masterid: 'resources/987654321',
    key: '2',
  },
};

test.beforeEach('Start up the service', async () => {
  conn = await connect({ token, domain });

  await conn.delete({
    path: `/bookmarks/test`,
  })

  const svc = new Service({
    name: 'test-service',
    oada: conn,
  })
  await svc.start();

  search = new Search<TestElement>({
    //assert: assertTP,
//    generate: generateTP,
    name: 'test',
    oada: conn,
    path: '/bookmarks/test',
    service: svc,
    tree: testTree,
  });

  await search.init();
});

test.after('Clean up the service', async () => {
  await conn.delete({
    path: `/bookmarks/test`,
  })
})

test('setCollection should set the index object and search index', (t) => {
  search.indexObject = _.cloneDeep(testObject);
  search.setCollection(search.indexObject);
  t.deepEqual(search.index._docs, Object.values(testObject));
});

test('Query should return no results if no matches are found', async (t) => {
  const res = search.query({ config: { element: { name: 'Mary Johnson' } } } as any);
  t.is(res.matches.length, 0);
});

test('Query should return a match if one is found', async (t) => {
  search.indexObject = _.cloneDeep(testObject);
  search.setCollection(search.indexObject);
  const result = search.query({ config: { element: { name: 'Jane Smith' } } });

  t.deepEqual(result.matches![0].item, { key: '2', ...search.indexObject['2'] });
});

test('Query should return matches if multiple are found', async (t) => {
  search.indexObject = _.cloneDeep(testObject);
  search.setCollection(search.indexObject);
  const result = search.query({ config: { element: { state: 'USA', email: 'h@example.com'} } });

  t.is(result.matches.length, 2);
  t.deepEqual(result.matches![0].item, {key: '2', ...search.indexObject['2']});
  t.deepEqual(result.matches![1].item, {key: '1', ...search.indexObject['1']});
});

test(`Query should return 'exact' matches if sapid exists on an entry`, async (t) => {
  search.indexObject = _.cloneDeep(testObject);
  search.setCollection(search.indexObject);
  const result = search.query({ config: { element: { sapid: '123456789' } }});

  t.is(result.matches.length, 1);
  t.is(result.exact, true);
  t.deepEqual(result.matches![0].item, testObject['1']);
});

test(`Query should return 'exact' matches if masterid exists on an entry`, async (t) => {
  search.indexObject = _.cloneDeep(testObject);
  search.setCollection(search.indexObject);
  const result = search.query({ config: { element: { masterid: 'resources/123456789' }}});

  t.is(result.matches.length, 1);
  t.is(result.exact, true);
  t.deepEqual(result.matches![0].item, testObject['1']);
});

test(`Query should return 'exact' matches if sapid and masterid both exist on an entry`, async (t) => {
  search.indexObject = _.cloneDeep(testObject);
  search.setCollection(search.indexObject);
  const result = search.query({ config: { element: {
    masterid: 'resources/123456789',
    sapid: '123456789',
  }}});

  t.is(result.matches.length, 1);
  t.is(result.exact, true);
  t.deepEqual(result.matches![0].item, testObject['1']);
});

test(`Query should return no 'exact' matches if sapid and masterid exist on separate entries`, async (t) => {
  search.indexObject = _.cloneDeep(testObject);
  search.setCollection(search.indexObject);
  const result = search.query({ config: { element: {
    masterid: 'resources/123456789',
    sapid: '987654321',
  }}});

  t.is(result.matches.length, 0);
  t.falsy(result.exact);
});

test('setItem should add an item and return it when queried', async (t) => {
  search.indexObject = _.cloneDeep(testObject);
  search.setCollection(search.indexObject);
  const item = { id: '123', name: 'John Doe', phone: '123-456-7890' };
  await search.setItem({item, pointer: item.id});
  const result = search.query({ config: { element: { name: 'John Doe' } } });
  t.is(result.matches.length, 2);
  t.deepEqual(result.matches![0].item.name, 'John Doe');
  t.deepEqual(result.matches![1].item.name, 'John Doe');
});

test('setItem should update an existing item and return it when queried', async (t) => {
  search.indexObject = _.cloneDeep(testObject);
  search.setCollection(search.indexObject);
  const updatedItem = { ...testObject['1'], phone: '098-765-4321' };
  await search.setItem({ item: updatedItem, pointer: updatedItem.id });
  const result = search.query({ config: { element: { name: 'John Doe' } } });
  t.deepEqual(result.matches![0].item, updatedItem);
  t.is(Object.keys(testObject).length, 2);
  t.is(search.index._docs.length, 2);
});

test('removeItem should remove an item and not return it when queried', async (t) => {
  search.indexObject = _.cloneDeep(testObject);
  search.setCollection(search.indexObject);
  await search.removeItem({pointer: testObject['1'].id});
  const result = search.query({ config: { element: { name: 'John Doe' } } });
  t.is(result.matches.length, 0);
});

/* assertion really cannot fail so long as items are created from the base template...
test('should create an entry if none exist when ensuring', async (t) => {
  const item = { name: 'Jane Doe', phone: '123-456-7890' };
  // @ts-ignore
  const err = await t.throwsAsync(async () => await search.ensure({ config: { element: item } }))
  t.deepEqual(err!.message,'assertion failed');
});
*/

test('Adding an item to the list resource should land it in the collection', async (t) => {
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

test('Removing an item from the list resource should prevent it from being returned', async (t) => {
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

test('Ensure should return the created thing if it does not exist', async (t) => {
  // Setup things
  const item1 = { id: '765', name: 'Sam Doe', phone: '777-777-7777' };
  // Run ensure
  const result = await search.ensure({
    config: {
      element: item1
    },
  });

  //Test
  t.is(result.new, true);
  t.assert(result.entry);
  t.is(result.entry.id, item1.id);
  t.is(result.entry.phone, item1.phone);
  t.is(result.entry.name, item1.name);
});

test('Ensure should return exact matches based on masterid only', async (t) => {
  // Setup things
  const item1 = { id: '765', name: 'Sam Doe', phone: '777-777-7777', masterid: 'resources/abc123' };
  await search.ensure({ config: { element: item1 }});

  // Call ensure on the thing we want to test
  const item2 = { id: '777', name: 'Sam D.', phone: '111-111-1111', masterid: 'resources/abc123' };
  const result = await search.ensure({ config: { element: item2 }});

  //Test
  t.is(result.exact, true);
  t.falsy(result.new);
  t.assert(result.entry);
  t.is(result.entry.phone, item1.phone);
  t.is(result.entry.name, item1.name);
  t.is(result.entry.id, item1.id);
  t.assert(result.entry.masterid);
});

test('Ensure should return exact matches based on sapid only', async (t) => {
  // Setup things
  const item1 = { id: '765', name: 'Sam Doe', phone: '777-777-7777', sapid: 'test111', masterid: 'resources/abc123' };
  await search.ensure({ config: { element: item1 }});

  // Call ensure on the thing we want to test
  const item2 = { id: '777', name: 'Sam D.', phone: '111-111-1111', sapid: 'test111' };
  const result = await search.ensure({ config: { element: item2 }});

  //Test
  t.falsy(result.new);
  t.assert(result.entry);
  t.is(result.exact, true);
  t.is(result.entry.phone, item1.phone);
  t.is(result.entry.name, item1.name);
  t.is(result.entry.id, item1.id);
});

test('Ensure should return exact matches if the input is 100% intersection with an existing entry (non-sapid/masterid keys)', async (t) => {
  // Setup things
  const item1 = { id: '765', name: 'Sam Doe', phone: '777-777-7777', sapid: 'test111' };
  await search.ensure({ config: { element: item1 }});

  // Call ensure on the thing we want to test
  const item2 = { name: 'Sam Doe', phone: '777-777-7777' };
  const result = await search.ensure({ config: { element: item2 }});

  //Test
  t.falsy(result.new);
  t.assert(result.entry);
  t.is(result.exact, true);
  t.is(result.entry.phone, item1.phone);
  t.is(result.entry.name, item1.name);
  t.is(result.entry.sapid, item1.sapid);
  t.is(result.entry.id, item1.id);
  t.assert(result.entry.masterid);

});

test('Ensure should return multiple exact matches on sapid', async (t) => {
  // Setup things
  const sapid = 'abc123';
  const item1 = { name: 'Sam Doe', phone: '777-777-7777', city: 'Testville', sapid};
  const item2 = { id: '777', name: 'Sam D.', phone: '111-111-1111', sapid };
  search.indexObject = {'111': item1, '222': item2 };
  search.setCollection(search.indexObject);
  const result = await search.ensure({ config: { element: { sapid }}});

  //Test
  t.falsy(result.new);
  t.assert(result.exact);
  t.assert(result.matches);
  t.is(result.matches!.length, 2);
  t.is(result.matches![0].item.sapid, sapid);
  t.is(result.matches![1].item.sapid, sapid);
});