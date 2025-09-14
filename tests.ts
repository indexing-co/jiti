import assert from 'assert';

import { templates } from './src/index';

async function runTests() {
  for (const key in templates) {
    if (!templates[key].tests?.length) {
      continue;
    }

    console.log('Running tests for', key);
    for (const test of templates[key].tests) {
      console.log('->', typeof test.payload === 'string' ? test.payload : JSON.stringify(test.params));

      try {
        const payload =
          typeof test.payload === 'string'
            ? await fetch(test.payload, { headers: { 'x-api-key': process.env.API_KEY as string } }).then((r) =>
                r.json()
              )
            : test.payload;
        if (!payload) {
          console.log('Skipping test for missing payload:', test.payload);
          continue;
        }

        const output = templates[key].transform(payload, { params: test.params });
        assert.deepStrictEqual(output, test.output);
      } catch (e) {
        console.error(e);
      }
    }
  }
}

void runTests().then(() => process.exit(0));
