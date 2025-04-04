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

import { config } from "./config.js";

import debug from "debug";
import Fuse from "fuse.js";
import { JsonPointer } from "json-ptr";

import type { OADAClient } from "@oada/client";
import type { Service, WorkerFunction } from "@oada/jobs";
import { Counter, Gauge } from "@oada/lib-prom";
import { ChangeType, ListWatch } from "@oada/list-lib";
import type { Tree } from "@oada/types/oada/tree/v1.js";

const log = {
  info: debug("trellis-data-manager-Search:info"),
  warn: debug("trellis-data-manager-Search:warn"),
  error: debug("trellis-data-manager-Search:error"),
};

const ensureCount = new Counter({
  name: "tdm:ensure",
  help: "Counts number of ensure() calls",
});
const queryCount = new Counter({
  name: "tdm:query",
  help: "Counts number of query() calls",
});
const generateCount = new Counter({
  name: "tdm:generate",
  help: "Counts number of generate() calls",
});
const updateCount = new Counter({
  name: "tdm:update",
  help: "Counts number of update() calls",
});
const mergeCount = new Counter({
  name: "tdm:merge",
  help: "Counts number of merge() calls",
});
const tpCount = new Gauge({
  name: "tdm:trading_partners_count",
  help: "Counts number of trading partners",
});
/* Const errorCount = new Counter({
  name: 'tdm:error',
  help: 'Counts number of errors',
});
*/

interface ElementBase {
  masterid?: string;
  externalIds?: readonly string[];
}

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
  // Assert function
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
    this.searchKeysList = this.searchKeys.map((index) =>
      typeof index === "string" ? index : index.name,
    );
    this.exactKeys = Array.from(
      new Set(["masterid", "externalIds"].concat(exactKeys ?? [])),
    );
    const options = {
      includeScore: true,
      keys: [...this.searchKeys, ...this.exactKeys],
      ignoreLocation: true,
      useExtendedSearch: true,
    };
    this.index = new Fuse([], options);
    this.indexObject = {};
    const { _type } = new JsonPointer(this.path).get(this.tree) as {
      _type: string;
    };
    const expandPtr = new JsonPointer(this.expandIndexPath);
    expandPtr.set(this.tree, { _type });
  }

  async init() {
    await this.oada.ensure({
      path: this.path,
      data: {},
      tree: this.tree,
    });

    // Wipe out, then recreate the expand-index to ensure it
    // is aligned with the trading-partner list
    try {
      await this.oada.delete({
        path: this.expandIndexPath,
      });

      await this.oada.ensure({
        path: this.expandIndexPath,
        data: {},
        tree: this.tree,
      });
    } catch (error) {
      console.log(error);
    }

    this.#watch = new ListWatch({
      path: this.path,
      name: this.name,
      conn: this.oada,
      resume: false,
      tree: this.tree,
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
      Object.entries(data).filter(([k, _]) => !k.startsWith("_")),
    );

    this.indexObject = data;
    this.setCollection(this.indexObject);

    this.service.on(
      `${this.name}-query`,
      config.get("timeouts.query"),
      this.query.bind(this) as unknown as WorkerFunction,
    );
    log.info(`Started ${this.name}-query listener.`);
    this.service.on(
      `${this.name}-generate`,
      config.get("timeouts.query"),
      this.generateElement.bind(this) as unknown as WorkerFunction,
    );
    log.info(`Started ${this.name}-generate listener.`);
    this.service.on(
      `${this.name}-ensure`,
      config.get("timeouts.query"),
      this.ensure.bind(this) as unknown as WorkerFunction,
    );
    log.info(`Started ${this.name}-ensure listener.`);
    this.service.on(
      `${this.name}-merge`,
      config.get("timeouts.query"),
      this.mergeElements.bind(this) as unknown as WorkerFunction,
    );
    log.info(`Started ${this.name}-merge listener.`);
    this.service.on(
      `${this.name}-update`,
      config.get("timeouts.query"),
      this.update.bind(this) as unknown as WorkerFunction,
    );
    log.info(`Started ${this.name}-update listener.`);
  }

  setCollection(data: Record<string, Element>) {
    tpCount.set(Object.keys(data).length);
    const collection = Object.values(data).filter(
      (value) => value !== undefined,
    );

    this.index.setCollection(collection);
  }

  query(job: { config: { element: Element } }): QueryResult {
    queryCount.inc();
    let element = Object.fromEntries(
      // Remove non-searchable keys
      Object.entries(job?.config?.element || {}).filter(
        ([k, _]) =>
          this.searchKeysList.includes(k) || this.exactKeys?.includes(k),
      ),
    );
    if (!element || element === undefined || Object.keys(element).length === 0)
      throw new Error(
        "Query Error: Invalid input search element at job.config.element",
      );

    // First find exact matches using primary keys
    const exactMatches = this.exactSearch(element);

    if (exactMatches.length > 0) return { exact: true, matches: exactMatches };
    element = Object.fromEntries(
      Object.entries(element || {}).filter(([_, v]) => !Array.isArray(v)),
    );

    // TODO: Create permutations of element keys, search them, and compile results...
    return { matches: this.index.search(element) };
  }

  async ensure(job: { config: { element: Element } }): Promise<EnsureResult> {
    ensureCount.inc();
    const queryResult = this.query(job);
    if (queryResult.matches.length > 0) {
      if (queryResult.exact) {
        if (queryResult.matches.length === 1) {
          log.info("An exact match was found. Returning match.");
          return {
            entry: queryResult.matches[0].item,
            ...queryResult,
            new: false,
          };
        }

        if (queryResult.matches.length > 1) {
          log.warn("Multiple exact matches were found. Returning matches.");
          return {
            ...queryResult,
            new: false,
          };
        }
      }
    } else {
      log.info("No exact matches were found. Creating a new entry.");
    }

    // Otherwise, create it
    // TODO: try catch with steps to undo the generate if necessary?
    const entry = await this.generateElement(job);
    if (this.assert) this.assert(entry);
    return { new: true, entry, ...queryResult };
  }

  // Attempt to find exact matches using identifiers
  exactSearch(element: any): any[] {
    const exactString = (this.exactKeys ?? [])
      .filter((ek) => element[ek])
      .map((ek) =>
        typeof element[ek] === "string"
          ? `=${element[ek]}`
          : element[ek].map((k: any) => `=${k}`).join(" | "),
      )
      .join(" | ");

    return this.index.search(exactString);
  }

  async setItem({ item, pointer }: { item: any; pointer: string }) {
    const id = pointer.replace(/^\//, "");
    if (id === "expand-index") return;

    item = await item;
    this.indexObject[id] = item;
    this.setCollection(this.indexObject);
  }

  async setItemExpand({ item, pointer }: { item: any; pointer: string }) {
    const key = pointer.replace(/^\//, "");
    if (key === "expand-index" || key.startsWith("_")) return;

    item = await item;

    item = Object.fromEntries(
      Object.entries(item).filter(([k, _]) => !k.startsWith("_")),
    );
    try {
      await this.oada.put({
        path: `${this.expandIndexPath}/${key}`,
        data: item,
      });
    } catch (error) {
      console.log(error);
    }
  }

  async removeItemExpand({ pointer }: { pointer: string }) {
    const key = pointer.replace(/^\//, "");
    if (key === "expand-index") return;
    await this.oada.delete({
      path: `${this.expandIndexPath}/${key}`,
    });
  }

  async removeItem({ pointer }: { pointer: string }) {
    const id = pointer.replace(/^\//, "");
    if (id === "expand-index") return;
    delete this.indexObject[id];
    this.setCollection(this.indexObject);
  }

  /**
   * Updates the expand index with the information extracted
   * from the received FL business
   * @param data expand index content
   */
  async updateExpandIndex(data: any, key: string, oada: OADAClient) {
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
      log.error({ error: error_ }, "Error when mirroring expand index.");
    }
  } // UpdateExpandIndex

  async mergeElements(job: {
    config: {
      from: string;
      to: string;
    };
  }): Promise<void> {
    mergeCount.inc();
    const { from, to } = job.config;
    const { data: toElement } = (await this.oada.get({
      path: `/${to}`,
    })) as unknown as { data: Element };
    const { data: fromElement } = (await this.oada.get({
      path: `/${from}`,
    })) as unknown as { data: Element };

    // Provide an opportunity for some additional merge steps
    const data = this.merge
      ? await this.merge(this.oada, job)
      : // Combine the two elements generically; take the union of the content, but
        // take the TO values over the FROM values; concat the externalIds
        {
          ...fromElement,
          ...toElement,
          externalIds: Array.from(new Set(toElement.externalIds ?? [])).concat(
            fromElement.externalIds ?? [],
          ),
        };
    await this.oada.put({
      path: `/${to}`,
      data,
    });
    await this.setItem({
      pointer: data.masterid.replace(/^resources\//, ""),
      item: data,
    });

    // Delete the element to fail over any queries during the merge
    const fromKey = from.replace(/^resources/, "");
    await this.oada.delete({
      path: `${this.path}${fromKey}`,
    });

    // Optimistic removal
    await this.removeItemExpand({ pointer: fromKey });
    await this.removeItem({ pointer: fromKey });
  }

  async update(job: {
    config: {
      element: Element;
    };
  }): Promise<Element> {
    updateCount.inc();
    const { element } = job.config;
    if (!element.masterid) {
      throw new Error("masterid required for update operation.");
    }

    const queryResult = this.index.search(`=${element.masterid}`);
    if (!queryResult) throw new Error("Entry with masterid not found");
    // Validate that new externalIds are not in use.
    if (element.externalIds && element.externalIds.length > 0) {
      const invalidExternalIds = (element.externalIds ?? [])
        .filter((xid) => !queryResult[0].item.externalIds.includes(xid))
        .filter((xid) =>
          this.index
            .search(`=${xid}`)
            .some((hit: any) => hit.item.masterid !== element.masterid),
        );
      // Don't throw, just remove the invalid ones and report out the results
      if (invalidExternalIds.length > 0)
        log.warn(
          `The supplied External IDs are already in use: ${invalidExternalIds.join(", ")}`,
        );

      element.externalIds = Array.from(
        new Set([
          ...(queryResult[0].item.externalIds ?? []),
          ...element.externalIds.filter(
            (xid) => !invalidExternalIds.includes(xid),
          ),
        ]),
      );
    }

    await this.oada.put({
      path: `/${element.masterid}`,
      // @ts-expect-error type BS with client
      data: element,
    });
    // Optimistic add to collection so we don't wait for things
    const { data } = await this.oada.get({
      path: `/${element.masterid}`,
    });
    await this.setItem({
      pointer: element.masterid.replace(/^resources\//, ""),
      item: data,
    });
    return data as unknown as Element;
  }

  async generateElement(job: {
    config: { element: Element };
  }): Promise<Element> {
    generateCount.inc();
    let data = job?.config?.element;
    // Each externalid may be in use by one trading partner
    const externalIds = (data.externalIds ?? []).filter(
      (xid) => this.index.search(`=${xid}`).length > 0,
    );

    if (externalIds.length > 0)
      throw new Error(
        `The supplied External IDs are already in use: ${externalIds}`,
      );

    try {
      const linkData = this.generate ? await this.generate(this.oada) : {};
      // Make the key equal to the resource id instead of tree POST
      const ptr = JsonPointer.create(`${this.path}/*/_type`);
      const { headers } = await this.oada.post({
        path: "/resources",
        data: {
          ...data,
          ...linkData,
        },
        contentType: ptr.get(this.tree) as string,
      });
      const location = headers["content-location"];
      const _id = location!.replace(/^\//, "");
      const key = location!.replace(/^\/resources\//, "");

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
      log.info("Added item to the expand-index ", data.masterid);
      // Optimistic add to collection so we don't wait for things
      await this.setItem({ pointer: key, item: data });
      return data;
    } catch (error_: unknown) {
      log.error("Generate Errored:", error_);
      throw error_;
    }
  }
}

export interface EnsureResult {
  entry?: any;
  matches?: any[];
  exact?: boolean;
  new?: boolean;
}

export interface QueryResult {
  matches: any[];
  exact?: boolean;
}
