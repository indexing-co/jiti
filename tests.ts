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
      const payload =
        typeof test.payload === 'string' ? await _fetch(test.payload).then((r) => r.json()) : test.payload;

      const output = templates[key].transform(payload, { params: test.params });
      assert.deepStrictEqual(output, test.output);
    }
  }
}

void runTests().then(() => process.exit(0));
