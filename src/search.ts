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
import type { Tree } from '@oada/types/oada/tree/v1.js';
import { ChangeType } from '@oada/list-lib';
import Fuse from 'fuse.js';
//import type { FuseResultMatch } from 'fuse.js';
import { AssumeState, ListWatch } from '@oada/list-lib';
import type { Service, WorkerFunction } from '@oada/jobs';
import config from './config.js';
//@ts-ignore
import { partial } from 'match-json';
import { JsonPointer } from 'json-ptr';

const log = {
  info: debug('ts-data-manager-Search:info'),
  warn: debug('trellis-data-manager-Search:warn'),
  error: debug('trellis-data-manager-Search:error'),
};

type ElementBase = {
  masterid?: string;
};

export class Search<Element extends ElementBase> {
  tree: Tree;
  // The path of the expand-index
  expandIndexPath: string;
  // The search index containing the set of known elements
  index: any;
  // The name of the set of elements
  name: string;
  // The oada client to make requests
  oada: OADAClient;
  // The path of the list of master data elements
  path: string;
  // The set of keys used to search on the element list
  searchKeys: Array<string | { name: string; weight: number }>;
  searchKeysList: string[];
  // The associated service
  service: Service;
  // An object representation of the set of known elements for the purpose of
  // handling changes and updating the search index more easily.
  indexObject: Record<string, Element>;
  exactKeys?: string[];
  //Assert function
  assert?: any;
  generate?: any;
  merge?: any;
  // The watch on the list of known elements, tracking add/remove/update
  #watch?: ListWatch;

  constructor({
    assert,
    tree,
    generate,
    merge,
    oada,
    path,
    name,
    service,
    searchKeys,
    exactKeys,
  }: {
    tree: Tree;
    assert?: any;
    generate?: any;
    merge?: any;
    oada: OADAClient;
    path: string;
    name: string;
    service: Service;
    searchKeys?: Array<string | { name: string; weight: number }>;
    exactKeys?: string[];
  }) {
    this.assert = assert;
    this.tree = tree;
    this.generate = generate;
    this.merge = merge;
    this.name = name;
    this.oada = oada;
    this.path = path;
    this.expandIndexPath = `${path}/_meta/indexings/expand-index`;
    this.service = service;
    this.searchKeys = searchKeys ?? [];
    this.searchKeysList = this.searchKeys.map((i) => typeof(i) === 'string' ? i : i.name);
    this.exactKeys = [...new Set([...(exactKeys ?? []), 'masterid', 'externalIds'])];
    const options = {
      includeScore: true,
      keys: [...this.searchKeys, ...this.exactKeys],
      ignoreLocation: true,
      useExtendedSearch: true,
    };
    this.index = new Fuse([], options);
    this.indexObject = {};
  }

  async init() {
    await this.oada.ensure({
      path: this.path,
      data: {},
      tree: this.tree,
    });

    await this.oada.ensure({
      path: this.expandIndexPath,
      data: {},
      tree: this.tree,
    });

    this.#watch = new ListWatch({
      path: this.path,
      name: this.name,
      conn: this.oada,
      resume: true,
      tree: this.tree,
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
      path: `${this.expandIndexPath}`,
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
      `${this.name}-generate`,
      config.get('timeouts.query'),
      this.#generate.bind(this) as unknown as WorkerFunction
    );
    log.info(`Started ${this.name}-generate listener.`);
    this.service.on(
      `${this.name}-ensure`,
      config.get('timeouts.query'),
      this.ensure.bind(this) as unknown as WorkerFunction
    );
    log.info(`Started ${this.name}-ensure listener.`);
    this.service.on(
      `${this.name}-merge`,
      config.get('timeouts.query'),
      this.#merge.bind(this) as unknown as WorkerFunction
    );
    log.info(`Started ${this.name}-query listener.`);

  }

  setCollection(data: Record<string, Element>) {
    const collection = Object.values(data)
      .filter((value) => value !== undefined)

    this.index.setCollection(collection);
  }

  query(job: { config: { element: Element } }): QueryResult {
    const element = Object.fromEntries(
      // Remove empty string/undefined values from the object
      Object.entries(job?.config?.element || {}).filter(([k, _]) =>
        this.searchKeysList.includes(k) || this.exactKeys?.includes(k)
      )
    );
    if (!element || element === undefined || Object.keys(element).length === 0)
      throw new Error('Invalid input search element at job.config.element');

    // First find exact matches using primary keys
    const exactMatches = this.exactSearch(element);

    // Do not proceed if the only keys present are exactMatch keys
    if (
      exactMatches.matches.length > 0 ||
      !this.searchKeysList.some((k) => k in element)
    )
      return { exact: true, ...exactMatches };

    const searchResult = this.index.search(element);
    if (searchResult.matches.length === 1 && partial(searchResult.matches[0].item, job.config.element)) {
      log.info(
        `An exact match was found on the input data (100% intersection). Returning match.`
      );
      return { ...searchResult, exact: true}
    }

    // Create permutations of element keys, search them, and compile results
    return searchResult;
  }

  async ensure(job: { config: { element: Element } }): Promise<EnsureResult> {
    const queryResult = this.query(job);
    if (queryResult.matches.length > 0) {
      if (queryResult.exact) {
        if (queryResult.matches.length === 1) {
          log.info(`An exact match was found for input ${job.config.element}. Returning match.`);
          return { entry: queryResult.matches[0].item, ...queryResult };
        }
        if (queryResult.matches.length > 1) {
          log.warn(`Multiple exact matches were found for input ${job.config.element}.`);
          return { ...queryResult };
        }
      // Use partial() instead of fuse scoring here to gain more certainty...
      // TODO: Is partial here still necessary? All query-like things ought just get done in query
      } else if (queryResult.matches.length === 1 && partial(queryResult.matches[0].item, job.config.element)) {
        log.info(`An exact match was found on the input data (100% intersection). Returning match.`);
        return { entry: queryResult.matches[0].item, ...queryResult }
      }
    }
    log.info('No exact matches were found. Creating a new entry.')

    //Otherwise, create it
    let entry;
    try {
      entry = await this.#generate(job);
      if (this.assert) this.assert(entry);
    } catch (error_: unknown) {
      throw error_;
      // Undo generate steps
    }
    return { new: true, entry, ...queryResult };
  }

  // Attempt to find exact matches using identifiers
  exactSearch(element: any) {
    const exactString = (this.exactKeys ?? [])
      .filter((ek) => element[ek])
      .map((ek) =>
        typeof ek === 'string'
          ? `=${element[ek]}`
          : (element[ek].map((k: any) => `=${k}`).join(' | '))
      )
      .join(` | `);

    return this.index.search(exactString);
  }

  /*
  exactSearch(element: any) {
    let object : any = {};
    if (element.sapid) object.sapid = element.sapid;
    if (element.masterid) object.masterid = element.masterid;
    const exactMatches = this.index.search(object);
    if (exactMatches.length > 0)
      log.info(`Found match from sapid/masterid: ${object}`);
    // A hack to return exact matches only
    return exactMatches.filter(({item}: {item: any}) => partial(item, object));
  }
  */

  async setItem({item, pointer}: {item: any, pointer: string}) {
    const id = pointer.replace(/^\//, '');
    if (id === 'expand-index') return;

    item = await item;
    this.indexObject[id] = item;
    this.setCollection(this.indexObject);
  }

  async setItemExpand({item, pointer}: {item: any, pointer: string}) {
    const key = pointer.replace(/^\//, '');
    if (key === 'expand-index') return;

    item = await item;
    await this.oada.put({
      path: `${this.expandIndexPath}/${key}`,
      data: item,
    });
  }

  async removeItemExpand({pointer}: {pointer: string}) {
    const key = pointer.replace(/^\//, '');
    if (key === 'expand-index') return;
    await this.oada.delete({
      path: `${this.expandIndexPath}/${key}`,
    });
  }

  async removeItem({pointer}: {pointer: string}) {
    const id = pointer.replace(/^\//, '');
    if (id === 'expand-index') return;
    delete this.indexObject[id];
    this.setCollection(this.indexObject);
  }

  /**
   * updates the expand index with the information extracted
   * from the received FL business
   * @param data expand index content
   */
  async updateExpandIndex(
    data: any,
    key: string,
    oada: OADAClient,
  ) {
    try {
      // Expand index
      await oada.put({
        path: `${this.expandIndexPath}`,
        data: {
          [key]: data,
        },
        tree: this.tree,
      });
      log.info(`Expand index updated at ${this.expandIndexPath}/${key}.`);
    } catch (error_: unknown) {
      log.error({ error: error_ }, 'Error when mirroring expand index.');
    }
  } // UpdateExpandIndex

  async #generate(job: { config: { element: Element } }): Promise<Element> {
    let data = job?.config?.element;
    try {
      const linkData = this.generate ? await this.generate(this.oada) : {};
      // Make the key equal to the resource id instead of tree POST
      const ptr = JsonPointer.create(`${this.path}/*/_type`);
      const { headers } = await this.oada.post({
        path: `/resources`,
        data: {
          ...data,
          ...linkData,
        },
        contentType: ptr.get(this.tree) as string,
      });
      const location = headers['content-location'];
      const _id = location!.replace(/^\//, '');
      const key = location!.replace(/^\/resources\//, '');

      // Add the masterid to itself
      await this.oada.put({
        path: location!,
        data: { masterid: _id },
      });

      // Make the link
      await this.oada.put({
        path: this.path,
        data: { [key]: { _id, _rev: 0 } },
      });
      log.info(`Added item to list at: ${this.path}/${key}`);

      data = { ...data, masterid: _id };

      // Update the expand index
      // FYI: data does not contain _id so it is safe to send to
      await this.updateExpandIndex(data, key, this.oada);
      log.info('Added item to the expand-index ', data.masterid);
      //Optimistic add to collection so we don't wait for things
      await this.setItem({ pointer: key, item: data });
      return data;
    } catch (error_: unknown) {
      log.error('Generate Errored:', error_);
      throw error_;
    }
  }

  async #merge(job: {
    config: {
      from: string;
      to: string;
      externalIds?: string | string[];
    };
  }): Promise<void> {
    // Each externalid may be in use by one trading partner-- and it should be involved in the
    // merge operation
    const { externalIds } = job.config;
    let xids = externalIds ? (Array.isArray(externalIds) ? externalIds : [externalIds]) : [];
    xids = xids.filter((xid) => {
      const matches = this.index.search(`=${xid}`);
      return (
        matches.length > 1 ||
        (matches.length === 1 &&
          ![job.config.to, job.config.from].includes(
            matches[0].item.masterid
          )
        )
      );
    });

    if (xids.length > 0)
      throw new Error(
        `External IDs supplied to merge opperation are already in use by non-merging entities: ${xids}`
      );
    await this.merge(this.oada, job);
  }
}

export type EnsureResult = {
  entry?: any;
  matches?: any[];
  exact?: boolean;
  new?: boolean;
}

export type QueryResult = {
  matches: any[];
  exact?: boolean;
}
