/**
 * @license
 * Copyright 2022 Qlever LLC
 *
 * Licensed under the Apache License, Version 2.0 (the 'License');
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an 'AS IS' BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type { Json, OADAClient } from '@oada/client';
import { ChangeType } from '@oada/list-lib';
import Fuse from 'fuse.js';
import { AssumeState, ListWatch } from '@oada/list-lib';
import type { Service, WorkerFunction } from '@oada/jobs';
import config from './config.js';
import tree from './tree.js';

type ElementBase = {
  id?: string;
};

export class Search<Element extends ElementBase> {
  //Assert function
  assert: any;
  contentType: string;
  generate: any;
  // The search index containing the set of known elements
  index: any;
  // The name of the set of elements
  name: string;
  // The oada client to make requests
  oada: OADAClient;
  // The path of the list of master data elements
  path: string;
  // The set of keys used to search on the element list
  searchKeys: any[];
  searchKeysList: any[];
  // The associated service
  service: Service;
  // An object representation of the set of known elements for the purpose of
  // handling changes and updating the search index more easily.
  indexObject: Record<string, Element>;
  // The watch on the list of known elements, tracking add/remove/update
  #watch?: ListWatch;

  constructor({
    assert,
    contentType,
    generate,
    oada,
    path,
    name,
    service,
  }: {
    assert: any;
    contentType: string;
    generate: any;
    oada: OADAClient;
    path: string;
    name: string;
    service: Service;
  }) {
    this.assert = assert;
    this.contentType = contentType;
    this.generate = generate;
    this.name = name;
    this.oada = oada;
    this.path = path;
    this.service = service;
    this.searchKeys = [{name: 'name', weight: 2}, 'phone', 'email', 'address', 'city', 'state', 'sapid', 'id', 'key'];
    this.searchKeysList = this.searchKeys.map((i) => typeof(i) === 'string' ? i : i.name);
    const options = {
      includeScore: true,
      keys: this.searchKeys,
      ignoreLocation: true,
    };
    this.index = new Fuse([], options);
    this.indexObject = {};
  }

  async init() {
    this.#watch = new ListWatch({
      path: this.path,
      name: this.name,
      conn: this.oada,
      resume: true,
      tree,
      itemsPath: `$.*`,
      onNewList: AssumeState.Handled,
    });

    // Handle Adds
    this.#watch.on(ChangeType.ItemAdded, this.setItem.bind(this));
    this.#watch.on(ChangeType.ItemAdded, this.setItemExpand.bind(this));

    // Handle Adds
    this.#watch.on(ChangeType.ItemChanged, this.setItem.bind(this));
    this.#watch.on(ChangeType.ItemChanged, this.setItemExpand.bind(this));

    // Handle Deletes
    this.#watch.on(ChangeType.ItemRemoved, this.removeItem.bind(this));
    this.#watch.on(ChangeType.ItemRemoved, this.removeItemExpand.bind(this));

    // Grab the current set of things and load them up
    let { data } = (await this.oada.get({
      path: `${this.path}/expand-index`,
    })) as unknown as { data: Record<string, Element> };

    data = Object.fromEntries(
      Object.entries(data).filter(([k, _]) => !k.startsWith('_'))
    );

    this.indexObject = data;
    this.setCollection(this.indexObject);

    this.service.on(
      `${this.name}-query`,
      config.get('timeouts.query'),
      this.query.bind(this) as unknown as WorkerFunction
    );
    this.service.on(
      `${this.name}-create`,
      config.get('timeouts.query'),
      this.create.bind(this) as unknown as WorkerFunction
    );
    this.service.on(
      `${this.name}-ensure`,
      config.get('timeouts.query'),
      this.ensure.bind(this) as unknown as WorkerFunction
    );
  }

  setCollection(data: Record<string, Element>) {
    const collection = Object.entries(data)
      .filter(([_, value]) => value !== undefined)
      .map(([key, value]) => ({ key, ...value }));

    this.index.setCollection(collection);
  }

  query(job: { config: { element: Element } }) {
    const element = Object.fromEntries(
      // Remove empty string/undefined values from the object
      Object.entries(job?.config?.element || {}).filter(([k, _]) =>
        this.searchKeysList.includes(k)
      )
    );
    if (!element || element === undefined || Object.keys(element).length === 0)
      throw new Error('No matches found');
    const matches = this.index.search(element);
    if (matches.length > 0) return matches as Json;

    throw new Error('No matches found');
  }

  ensure(job: { config: { element: Element } }) {
    let matches: any;
    try {
      matches = this.query(job);
    } catch (error: unknown) {}
    if (!matches) return { new: true, entry: this.create(job)};
    if (matches.length === 1) {
      return { entry: matches![0] as Json, new: false };
    } else {
      throw new Error('multiple matches found');
    }
  }

  async create(job: { config: { element: Element } }) {
    let stuff: any;
    try {
      stuff = await this.generate(job.config.element, this.contentType, this.path, this.oada);
      this.assert(stuff);
    } catch (error: unknown) {
      // Undo generate steps
    }
  }

  async setItem({item, pointer}: {item: any, pointer: string}) {
    let id = pointer.replace(/^\//, '');
    if (id === 'expand-index') return;

    item = await item;
    this.indexObject[id] = item;
    this.setCollection(this.indexObject);
  }

  async setItemExpand({item, pointer}: {item: any, pointer: string}) {
    let id = pointer.replace(/^\//, '');
    if (id === 'expand-index') return;

    item = await item;
    await this.oada.put({
      path: `${this.path}/expand-index/${id}`,
      data: item
    })
  }

  async removeItemExpand({pointer}: {pointer: string}) {
    let id = pointer.replace(/^\//, '');
    if (id === 'expand-index') return;
    await this.oada.delete({
      path: `${this.path}/expand-index/${id}`,
    })
  }

  async removeItem({pointer}: {pointer: string}) {
    let id = pointer.replace(/^\//, '');
    if (id === 'expand-index') return;
    delete this.indexObject[id];
    this.setCollection(this.indexObject);
  }
}