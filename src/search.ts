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

import debug from 'debug';
import type { OADAClient } from '@oada/client';
import { ChangeType } from '@oada/list-lib';
import Fuse from 'fuse.js';
//import type { FuseResultMatch } from 'fuse.js';
import { AssumeState, ListWatch } from '@oada/list-lib';
import type { Service, WorkerFunction } from '@oada/jobs';
import config from './config.js';
import tree from './tree.js';

const log = {
  info: debug('ts-data-manager-Search:info'),
  warn: debug('trellis-data-manager-Search:warn'),
  error: debug('trellis-data-manager-Search:error'),
};

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
    log.info(`Started ${this.name}-query listener.`);
    this.service.on(
      `${this.name}-create`,
      config.get('timeouts.query'),
      this.create.bind(this) as unknown as WorkerFunction
    );
    log.info(`Started ${this.name}-create listener.`);
    this.service.on(
      `${this.name}-ensure`,
      config.get('timeouts.query'),
      this.ensure.bind(this) as unknown as WorkerFunction
    );
    log.info(`Started ${this.name}-ensure listener.`);
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
      throw new Error('Invalid input search element at job.config.element');

    // First find exact matches using primary keys
    if (element.sapid ?? element.id) {
      const exactMatches = this.exactSearch(element);
      if (exactMatches.length > 0) return exactMatches;
    }

    // Finally, try regular search
    return this.index.search(element);
  }

  ensure(job: { config: { element: Element } }) {
    const matches = this.query(job);
    if (matches.length > 0) {
      return { matches, new: false };
    }
    return { new: true, entry: this.create(job) };
  }

  exactSearch(element: any) {
    if (element.sapid) {
      const exactMatches = this.index.search({ sapid: element.sapid });
      if (exactMatches.length === 1) {
        log.info(`Found exact match from sapid ${element.sapid}`);
        return exactMatches;
      }
    }
    if (element.id) {
      const exactMatches = this.index.search({ id: element.id });
      if (exactMatches.length === 1) {
        log.info(`Found exact match from id ${element.id}`);
        return exactMatches;
      }
    }
    return []
  }

  async create(job: { config: { element: Element } }) {
    // Run the exact match portion of the search
    const exactMatches = this.exactSearch(job.config.element);
    if (exactMatches.length === 1) {
      log.warn(`Cannot create new item. Exact matches on 'sapid' or 'id' already exist for input ${job.config.element}`);
      return exactMatches[0];
    } else if (exactMatches.length > 1) {
      throw new Error(`Cannot create new item. Multiple exact matches on 'sapid' or 'id' already exist for input ${job.config.element}`);
    }

    // Verify matches do not collide

    let stuff: any;
    try {
      stuff = await this.generate(job.config.element, this.contentType, this.oada, this.path);
      this.assert(stuff);
    } catch (error_: unknown) {
      throw error_;
      // Undo generate steps
    }
    return stuff;
  }

  async setItem({item, pointer}: {item: any, pointer: string}) {
    const id = pointer.replace(/^\//, '');
    if (id === 'expand-index') return;

    item = await item;
    this.indexObject[id] = item;
    this.setCollection(this.indexObject);
  }

  async setItemExpand({item, pointer}: {item: any, pointer: string}) {
    const id = pointer.replace(/^\//, '');
    if (id === 'expand-index') return;

    item = await item;
    await this.oada.put({
      path: `${this.path}/expand-index/${id}`,
      data: item,
    });
  }

  async removeItemExpand({pointer}: {pointer: string}) {
    const id = pointer.replace(/^\//, '');
    if (id === 'expand-index') return;
    await this.oada.delete({
      path: `${this.path}/expand-index/${id}`,
    });
  }

  async removeItem({pointer}: {pointer: string}) {
    const id = pointer.replace(/^\//, '');
    if (id === 'expand-index') return;
    delete this.indexObject[id];
    this.setCollection(this.indexObject);
  }
}
