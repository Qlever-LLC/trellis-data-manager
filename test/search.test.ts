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
let svc: Service;

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
  '1abc': {
    id: '1abc',
    name: 'John Doe',
    phone: '1234567890',
    email: 'john.doe@example.com',
    address: '123 Main St.',
    city: 'Anytown',
    state: 'USA',
    externalIds: ['sap:123456789'],
    masterid: 'resources/123456789',
    key: '1abc',
  },
  '2abc': {
    id: '2abc',
    name: 'Jane Smith',
    phone: '0987654321',
    email: 'jane.smith@example.com',
    address: '456 Second St.',
    city: 'Somewhere',
    state: 'USA',
    externalIds: ['sap:987654321'],
    masterid: 'resources/987654321',
    key: '2abc',
    extra: true,
  },
};

test.before('Start up the service', async () => {
  conn = await connect({ token, domain });
  await conn.delete({
    path: `/bookmarks/test`,
  });

  svc = new Service({
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
    searchKeys: [
      {
        name: 'name',
        weight: 2,
      },
      'phone',
      'email',
      'address',
      'city',
      'state',
    ],
  });
  await search.init();
});

test.after('Clean up the service', async () => {
  await conn.delete({
    path: `/bookmarks/test`,
  });
});

test.beforeEach('Start up the service', () => {
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
  t.deepEqual(result.matches[0].item, { key: '2abc', ...search.indexObject['2abc'] });
});

test('Query should return matches if multiple are found', (t) => {
  const result = search.query({
    config: { element: { state: 'USA', email: 'h@example.com' } },
  });

  t.is(result.matches.length, 2);
  t.deepEqual(result.matches[0].item, { key: '2abc', ...search.indexObject['2abc'] });
  t.deepEqual(result.matches[1].item, { key: '1abc', ...search.indexObject['1abc'] });
});

test(`Query should return 'exact' matches if an externalId exists on an entry`, (t) => {
  const result = search.query({
    config: { element: { externalIds: ['sap:123456789'] } },
  });

  t.is(result.matches.length, 1);
  t.is(result.exact, true);
  t.deepEqual(result.matches[0].item, testObject['1abc']);
});

test(`Query should return 'exact' matches if masterid exists on an entry`, (t) => {
  const result = search.query({
    config: { element: { masterid: 'resources/123456789' } },
  });

  t.is(result.matches.length, 1);
  t.is(result.exact, true);
  t.deepEqual(result.matches[0].item, testObject['1abc']);
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
  t.deepEqual(result.matches[0].item, testObject['1abc']);
});

//TODO: What behavior do we want here?? no 'exact' matches might be nice, but
// the code is currently written as OR
test.skip(`Query should return no 'exact' matches if sap id and masterid exist on separate entries`, (t) => {
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

//TODO: Sounds nice, but this one has also been eliminated to simplify overall behavior
test.skip(`Query should return matches if the input content is a perfect intersection with a match`, (t) => {
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
  t.deepEqual(result.matches[0].item, testObject['1abc']);
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
  const updatedItem = { ...testObject['1abc'], phone: '098-765-4321' };
  await search.setItem({ item: updatedItem, pointer: updatedItem.id });
  const result = search.query({ config: { element: { name: 'John Doe' } } });
  t.deepEqual(result.matches[0].item, updatedItem);
  t.is(Object.keys(testObject).length, 2);
  t.is(search.index._docs.length, 2);
});

test('removeItem should remove an item and not return it when queried', async (t) => {
  await search.removeItem({ pointer: testObject['1abc'].id });
  const result = search.query({ config: { element: { name: 'John Doe' } } });
  t.is(result.matches.length, 0);
});

test('Items removed from the list should likewise get removed from the expand index', async (t) => {
  await search.removeItem({ pointer: testObject['1abc'].id });
  await search.removeItemExpand({ pointer: testObject['1abc'].id });
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

  await setTimeout(4000);

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
  const { entry } = await search.ensure({ config: { element: item1 } });

  const item2 = {
    id: '777',
    name: 'Sam D.',
    phone: '111-111-1111',
    masterid: entry.masterid,
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

// This particular test is really testing what happens in a bad state. It should be a separate problem.
test.skip(`Ensure should create a new thing if multiple 'exact' matches come back`, async (t) => {
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

test(`Ensure should return multiple 'exact' matches if that occurs.`, async (t) => {
  // Setup things
  const item1 = {
    name: 'Sam Doe',
    phone: '777-777-7777',
    city: 'Testville',
    externalIds: [`sap:abc123`],
  };
  const item2 = {
    id: '777',
    name: 'Sam D.',
    phone: '111-111-1111',
    externalIds: ['sap:def456'],
  };
  search.indexObject = {
    '111': item1,
    '222': item2,
  };
  search.setCollection(search.indexObject);
  const both = item1.externalIds.concat(item2.externalIds);
  const result = await search.ensure({
    config: {
      element: { externalIds: both },
    },
  });

  t.falsy(result.new);
  t.assert(result.exact);
  t.assert(result.matches);
  t.is(result.matches!.length, 2);
  t.true(both.includes(result.matches![0].item.externalIds[0]));
  t.true(both.includes(result.matches![1].item.externalIds[0]));
});

test('Generate should throw if an input external id is already in use', async (t) => {
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
  t.true(err?.message.startsWith('The supplied External IDs are already in use: sap:12345678'));
});

test('Merge should take two entries and make them one', async (t) => {
  t.timeout(25_000);

  search.indexObject = {};
  search.setCollection(search.indexObject);
  await search.generateElement({ config: { element: testObject['1abc'] } });
  await search.generateElement({ config: { element: testObject['2abc'] } });
  await setTimeout(2000);

  await search.mergeElements({
    config: {
      to: search.index._docs[0].masterid,
      from: search.index._docs[1].masterid,
    },
  });

  t.is(search.index._docs.length, 1);
  t.is(search.index._docs[0].name, testObject['1abc'].name);
  t.is(search.index._docs[0].address, testObject['1abc'].address);
  t.is(search.index._docs[0].city, testObject['1abc'].city);
  t.is(search.index._docs[0].state, testObject['1abc'].state);
  t.is(search.index._docs[0].phone, testObject['1abc'].phone);
  t.assert(search.index._docs[0].extra);
  t.true(search.index._docs[0].externalIds.includes('sap:123456789'));
  t.true(search.index._docs[0].externalIds.includes('sap:987654321'));
});

test('Update should take additional data and add it to the element', async (t) => {
  t.timeout(25_000);

  search.indexObject = {};
  search.setCollection(search.indexObject);
  await search.generateElement({ config: { element: testObject['1abc'] } });
  await search.update({
    config: {
      element: {
        masterid: search.index._docs[0].masterid,
        externalIds: ['test:777777'],
      },
    },
  });

  t.assert(search.index._docs[0]);
  t.true(search.index._docs[0].externalIds.includes('test:777777'));
  t.true(
    search.index._docs[0].externalIds.includes(testObject['1abc'].externalIds[0])
  );
});

test('Update should error if masterid is missing', async (t) => {
  t.timeout(25_000);

  search.indexObject = {};
  search.setCollection(search.indexObject);
  await search.generateElement({ config: { element: testObject['1abc'] } });
  const err = await t.throwsAsync(
    async () =>
    await search.update({
      config: {
        element: {
          externalIds: ['test:777777'],
        },
      },
    })
  );

  t.is(err?.message, 'masterid required for update operation.');
});

test('The expand-index should get reset based on the items in the main search path', async (t) => {
  search.indexObject = {};
  await conn.put({
    path: `${search.path}/${testObject['1abc'].id}`,
    data: testObject['1abc'],
    tree: testTree,
  });
  await conn.put({
    path: `${search.path}/${testObject['2abc'].id}`,
    data: testObject['2abc'],
    tree: testTree,
  });

  await setTimeout(7_000);
  // Re-init the search to update the expand-index
  await search.init();

  await setTimeout(7_000);

  const { data: results } = (await conn.get({
    path: `${search.expandIndexPath}`,
  })) as { data: Record<string, TestElement> };

  t.assert(results[testObject['1abc'].id]);
  t.assert(results[testObject['2abc'].id]);
});
