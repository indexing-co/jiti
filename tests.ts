import _fetch from 'isomorphic-fetch';
import assert from 'assert';

import { templates } from './src/index';

async function runTests() {
  for (const key in templates) {
    if (!templates[key].tests?.length) {
      continue;
    }

    console.log('Running tests for', key);
    for (const test of templates[key].tests) {
      console.log('->', JSON.stringify(test.params));
      try {
        const payload =
          typeof test.payload === 'string'
            ? await _fetch(test.payload, { headers: { 'x-api-key': process.env.API_KEY as string } }).then((r) =>
                r.json()
              )
            : test.payload;

        const output = templates[key].transform(payload, { params: test.params });
        assert.deepStrictEqual(output, test.output);
      } catch (e) {
        console.error(e);
      }
    }
  }
}

void runTests().then(() => process.exit(0));
