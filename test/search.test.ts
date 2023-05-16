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
import { Search } from '../dist/search.js';
import { Service } from '@oada/jobs';
import { tree } from '../dist/tree.masterData.js';
import { setTimeout } from 'node:timers/promises';

const { token, domain } = config.get('oada');

const testTree = _.cloneDeep(tree);
testTree.bookmarks!.test =
  _.cloneDeep(testTree.bookmarks!.trellisfw!['trading-partners']) ?? {};

let conn: OADAClient;

type TestElement = {
  id?: string;
  name?: string;
  phone?: string;
  email?: string;
  address?: string;
  city?: string;
  state?: string;
  externalIds?: string[];
  key?: string;
  masterid?: string;
};

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
    externalIds: ['sap:123456789'],
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
    externalIds: ['sap:987654321'],
    masterid: 'resources/987654321',
    key: '2',
    extra: true,
  },
};

test.after('Clean up the service', async () => {
  await conn.delete({
    path: `/bookmarks/test`,
  });
});

test.beforeEach('Start up the service', async () => {
  conn = await connect({ token, domain });

  await conn.delete({
    path: `/bookmarks/test`,
  });

  const svc = new Service({
    name: 'test-service',
    oada: conn,
  });
  await svc.start();

  search = new Search<TestElement>({
    name: 'test',
    oada: conn,
    path: '/bookmarks/test',
    service: svc,
    tree: testTree,
  });

  await search.init();

  search.indexObject = _.cloneDeep(testObject);
  search.setCollection(search.indexObject);
});

test('setCollection should set the index object and search index', (t) => {
  t.deepEqual(search.index._docs, Object.values(testObject));
});

test('Query should return no results if no matches are found', (t) => {
  const response = search.query({
    config: { element: { name: 'Mary Johnson' } },
  });
  t.is(response.matches.length, 0);
});

test('Query should return a match if one is found', (t) => {
  const result = search.query({ config: { element: { name: 'Jane Smith' } } });
  t.deepEqual(result.matches[0].item, { key: '2', ...search.indexObject['2'] });
});

test('Query should return matches if multiple are found', (t) => {
  const result = search.query({
    config: { element: { state: 'USA', email: 'h@example.com' } },
  });

  t.is(result.matches.length, 2);
  t.deepEqual(result.matches[0].item, { key: '2', ...search.indexObject['2'] });
  t.deepEqual(result.matches[1].item, { key: '1', ...search.indexObject['1'] });
});

test(`Query should return 'exact' matches if sap id exists on an entry`, (t) => {
  const result = search.query({
    config: { element: { externalIds: ['sap:123456789'] } },
  });

  t.is(result.matches.length, 1);
  t.is(result.exact, true);
  t.deepEqual(result.matches[0].item, testObject['1']);
});

test(`Query should return 'exact' matches if masterid exists on an entry`, (t) => {
  const result = search.query({
    config: { element: { masterid: 'resources/123456789' } },
  });

  t.is(result.matches.length, 1);
  t.is(result.exact, true);
  t.deepEqual(result.matches[0].item, testObject['1']);
});

test(`Query should return 'exact' matches if sap id and masterid both exist on an entry`, (t) => {
  const result = search.query({
    config: {
      element: {
        masterid: 'resources/123456789',
        externalIds: ['sap:123456789'],
      },
    },
  });

  t.is(result.matches.length, 1);
  t.is(result.exact, true);
  t.deepEqual(result.matches[0].item, testObject['1']);
});

test(`Query should return no 'exact' matches if sap id and masterid exist on separate entries`, (t) => {
  const result = search.query({
    config: {
      element: {
        masterid: 'resources/123456789',
        externalIds: ['sap:987654321'],
      },
    },
  });

  t.is(result.matches.length, 0);
  t.falsy(result.exact);
});

test(`Query should return matches if the input content is a perfect intersection with a match`, (t) => {
  const result = search.query({
    config: {
      element: {
        name: 'John Doe',
        phone: '1234567890',
        email: 'john.doe@example.com',
        address: '123 Main St.',
        city: 'Anytown',
        state: 'USA',
      },
    },
  });

  t.is(result.matches.length, 1);
  t.deepEqual(result.matches[0].item, testObject['1']);
});

test('setItem should add an item and return it when queried', async (t) => {
  const item = { id: '123', name: 'John Doe', phone: '123-456-7890' };
  await search.setItem({ item, pointer: item.id });
  const result = search.query({ config: { element: { name: 'John Doe' } } });
  t.is(result.matches.length, 2);
  t.is(result.matches[0].item.name, 'John Doe');
  t.is(result.matches[1].item.name, 'John Doe');
});

test('setItem should update an existing item and return it when queried', async (t) => {
  const updatedItem = { ...testObject['1'], phone: '098-765-4321' };
  await search.setItem({ item: updatedItem, pointer: updatedItem.id });
  const result = search.query({ config: { element: { name: 'John Doe' } } });
  t.deepEqual(result.matches[0].item, updatedItem);
  t.is(Object.keys(testObject).length, 2);
  t.is(search.index._docs.length, 2);
});

test('removeItem should remove an item and not return it when queried', async (t) => {
  await search.removeItem({ pointer: testObject['1'].id });
  const result = search.query({ config: { element: { name: 'John Doe' } } });
  t.is(result.matches.length, 0);
});

test('Adding an item to the list resource should land it in the collection', async (t) => {
  const data = {
    id: '765',
    name: 'Sam Doe',
    phone: '777-777-7777',
    externalIds: ['sap:test111'],
    masterid: 'resources/abc123',
  };
  await conn.put({
    path: `${search.path}/${data.id}`,
    data,
    tree: testTree,
  });

  await setTimeout(3000);

  const searchObject = Object.fromEntries(
    Object.entries(search.index._docs[0]).filter(
      ([key]) => !key.startsWith('_')
    )
  );
  t.deepEqual(searchObject, data);
});

test('Removing an item from the list resource should prevent it from being returned', async (t) => {
  const data = {
    id: '765',
    name: 'Sam Doe',
    phone: '777-777-7777',
    externalIds: ['sap:test111'],
    masterid: 'resources/abc123',
  };
  await conn.put({
    path: `${search.path}/${data.id}`,
    data,
    tree: testTree,
  });

  await setTimeout(3000);
  t.is(search.index._docs.length, Object.values(testObject).length + 1);
  await conn.delete({
    path: `${search.path}/${data.id}`,
  });

  await setTimeout(3000);

  t.is(search.index._docs.length, Object.values(testObject).length);
});

test('Ensure should return the created thing if it does not exist', async (t) => {
  const item1 = { id: '765', name: 'Sam Doe', phone: '777-777-7777' };
  const result = await search.ensure({
    config: {
      element: item1,
    },
  });

  t.is(result.new, true);
  t.assert(result.entry);
  t.is(result.entry.id, item1.id);
  t.is(result.entry.phone, item1.phone);
  t.is(result.entry.name, item1.name);
});

test(`Ensure should return 'exact' matches based only on exact match keys`, async (t) => {
  const item1 = {
    id: '765',
    name: 'Sam Doe',
    phone: '777-777-7777',
    masterid: 'resources/abc123',
  };
  await search.ensure({ config: { element: item1 } });

  const item2 = {
    id: '777',
    name: 'Sam D.',
    phone: '111-111-1111',
    masterid: 'resources/abc123',
  };
  const result = await search.ensure({ config: { element: item2 } });

  t.is(result.exact, true);
  t.falsy(result.new);
  t.assert(result.entry);
  t.is(result.entry.phone, item1.phone);
  t.is(result.entry.name, item1.name);
  t.is(result.entry.id, item1.id);
  t.assert(result.entry.masterid);
});

test(`Ensure should create a new thing if multiple 'exact' matches come back`, async (t) => {
  // Setup things
  const sapid = 'abc123';
  const externalIds = [`sap:${sapid}`];
  const item1 = {
    name: 'Sam Doe',
    phone: '777-777-7777',
    city: 'Testville',
    externalIds,
  };
  const item2 = {
    id: '777',
    name: 'Sam D.',
    phone: '111-111-1111',
    externalIds,
  };
  search.indexObject = {
    '111': item1,
    '222': item2,
  };
  search.setCollection(search.indexObject);
  const result = await search.ensure({ config: { element: { externalIds } } });

  t.truthy(result.new);
  t.assert(result.exact);
  t.assert(result.matches);
  t.is(result.matches!.length, 2);
  t.is(result.matches![0].item.externalIds, externalIds);
  t.is(result.matches![1].item.sapid, externalIds);
});

test.only('Generate should throw if an input external id is already in use', async (t) => {
  const err = await t.throwsAsync(
    async () => await search.generateElement({
    config: {
      element: {
        id: '3',
        name: 'Sam Doe',
        phone: '1234567890',
        email: 'sam.doe@example.com',
        address: '123 Main St.',
        city: 'Anytown',
        state: 'USA',
        masterid: 'resources/777777777',
        key: '3',
        externalIds: ['sap:123456789'],
      },
    },
  }));
  t.true(err?.message.startsWith('External IDs supplied to merge'));
});

test('Merge should take two entries and make them one', async (t) => {
  await search.mergeElements({
    config: {
      to: 'resources/123456789',
      from: 'resources/987654321',
    },
  });

  t.is(search.index._docs.length, 1);
  t.is(search.index._docs[0].item.masterid, testObject['1'].masterid);
  t.is(search.index._docs[0].item.name, testObject['1'].name);
  t.is(search.index._docs[0].item.address, testObject['1'].address);
  t.is(search.index._docs[0].item.city, testObject['1'].city);
  t.is(search.index._docs[0].item.state, testObject['1'].state);
  t.is(search.index._docs[0].item.phone, testObject['1'].phone);
  t.truthy(
    search.index._docs[0].item.externalIds.includes([
      'sap:123456789',
      'sap:987654321',
    ])
  );
  t.assert(search.index._docs[0].item.extra);
});
