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

import config from '../dist/config.js';
import test from 'ava';
import { run } from '../dist/index.js';
import { connect, JobEventType, JobsRequest } from '@oada/client';
//import type { OADAClient } from '@oada/client';
import type { JsonObject, OADAClient } from '@oada/client';

const { token, domain } = config.get('oada');
const { name: SERVICE_NAME } = config.get('service');
let conn: OADAClient;
const pending = `/bookmarks/services/${SERVICE_NAME}/jobs/pending`;

test.before('Start up the service', async () => {
  conn = await connect({ token, domain });

  let { data: jobs } = (await conn.get({
    path: pending,
  })) as { data: JsonObject };
  jobs = Object.fromEntries(
    Object.entries(jobs).filter(([key]) => !key.startsWith('_'))
  );
  for await (const key of Object.keys(jobs)) {
    await conn.delete({
      path: `${pending}/${key}`,
    });
  }

  await run();
});

test.skip('Example Test', async (t) => {
  const jr = new JobsRequest({
    oada: conn,
    job: {
      type: 'trading-partners',
      service: SERVICE_NAME,
      config: {
        element: {
          city: 'Testing',
          address: '444 Test Street',
          email: 'testemail@gmail.com',
          id: 'resources/test111111111',
          name: 'Centricity Test Company, LLC',
          phone: '000-111-2222',
          sapid:
            'fd30697387c306ee33506f78e0b8265fc89a90385c005adc0ddec5894aea6f1f',
          type: 'CUSTOMER',
        },
      },
    },
  });

  jr.on(JobEventType.Result, async (job) => {
    // @ts-ignore
    t.is(job.result, '60d21c1a9c09d3000f6e0a2d');
  });

  await new Promise((resolve) => setTimeout(resolve, 20_000));
});

test.skip('Ensure should not work if the element fails the type assertion', async (t) => {
  const jr = new JobsRequest({
    oada: conn,
    job: {
      type: 'trading-partners-ensure',
      service: SERVICE_NAME,
      config: {
        element: {
          city: 'Sedalia',
          address: '623 W Benton St',
          email: 'coldfrontscheduling@gmail.com',
          id: 'resources/1x0gHMF7alkUlS62hzuC6ktHAwx',
          name: 'Cold Front Logistics, LLC',
          phone: '660-553-5157',
          sapid:
            'fd30697387c306ee33506f78e0b8265fc89a90385c005adc0ddec5894aea6f1f',
          type: 'CUSTOMER',
        },
      },
    },
  });

  jr.on(JobEventType.Status, async (job) => {
    // @ts-ignore
    t.is(job.status, 'failure');
  });

  await new Promise((resolve) => setTimeout(resolve, 20_000));
});

test.skip('Ensure should work if the element passes the type assertion', async (t) => {
  const jr = new JobsRequest({
    oada: conn,
    job: {
      type: 'trading-partners-ensure',
      service: SERVICE_NAME,
      config: {
        element: {
          city: 'Sedalia',
          address: '623 W Benton St',
          email: 'coldfrontscheduling@gmail.com',
          id: 'resources/1x0gHMF7alkUlS62hzuC6ktHAwx',
          name: 'Cold Front Logistics, LLC',
          phone: '660-553-5157',
          sapid:
            'fd30697387c306ee33506f78e0b8265fc89a90385c005adc0ddec5894aea6f1f',
          type: 'CUSTOMER',
        },
      },
    },
  });

  jr.on(JobEventType.Status, async (job) => {
    // @ts-ignore
    t.is(job.status, 'success');
  });

  await new Promise((resolve) => setTimeout(resolve, 20_000));
});

