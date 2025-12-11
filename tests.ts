import assert from 'assert';
import fs from 'fs';

process.env.IS_JITI_TEST = 'false';

import { templates } from './src/index';

BigInt.prototype['toJSON'] = function () {
  return this.toString();
};

async function runTests() {
  for (const key in templates) {
    if (!templates[key].tests?.length) {
      continue;
    }

    console.log('Running tests for', key);
    for (const test of templates[key].tests) {
      if (key !== 'filterValues') continue;
      if (typeof test.payload !== 'string' || !test.payload.includes('hyper_core')) continue;
      console.log('->', typeof test.payload === 'string' ? test.payload : JSON.stringify(test.params));
      let outputPath = '';

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
        outputPath = `tmp/${key}-${(test.payload as string).split('/').pop()}.json`;
        fs.writeFileSync(
          `tmp/${key}-${(test.payload as string).split('/').pop()}.json`,
          JSON.stringify(output, null, 2)
        );
        assert.deepStrictEqual(output, test.output);
      } catch (e) {
        console.error(e);
        console.log(outputPath);
        break;
      }
    }
  }
}

void runTests().then(() => process.exit(0));
