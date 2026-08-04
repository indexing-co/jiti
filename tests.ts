import 'dotenv/config';
import assert from 'assert';
import fs from 'fs';

import { templates } from './src/index';

BigInt.prototype['toJSON'] = function () {
  return this.toString();
};

async function runTests() {
  let failures = 0;

  for (const key in templates) {
    if (!templates[key].tests?.length) {
      continue;
    }

    console.log('Running tests for', key);
    for (const [idx, test] of templates[key].tests.entries()) {
      // Inline payloads are fixtures: they need no API_KEY, and they pin behaviour for block
      // shapes no live endpoint may serve (e.g. an ArbOS retryable on a network that is not
      // enabled in prod). Remote payloads still fetch from the API as before.
      const isRemote = typeof test.payload === 'string';
      const label = isRemote ? (test.payload as string) : `inline#${idx} ${JSON.stringify(test.params)}`;
      console.log('->', label);
      let outputPath = '';

      try {
        const payload = isRemote
          ? await fetch(test.payload as string, { headers: { 'x-api-key': process.env.API_KEY as string } }).then((r) =>
              r.json()
            )
          : test.payload;
        if (!payload) {
          console.log('Skipping test for missing payload:', label);
          continue;
        }

        const output = templates[key].transform(payload, { params: test.params });
        const name = isRemote ? (test.payload as string).split('/').pop() : `inline-${idx}`;
        outputPath = `tmp/${key}-${name}.json`;
        fs.mkdirSync('tmp', { recursive: true });
        fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
        assert.deepStrictEqual(output, test.output);
      } catch (e) {
        // Record and continue: one broken case should not hide the rest, and the run must exit
        // non-zero so CI actually fails on a regression (it previously always exited 0).
        failures++;
        console.error(`FAIL ${key} ${label}`);
        console.error(e);
        if (outputPath) {
          console.log('actual output written to', outputPath);
        }
      }
    }
  }

  return failures;
}

void runTests().then((failures) => {
  if (failures) {
    console.error(`\n${failures} test(s) failed`);
  } else {
    console.log('\nall tests passed');
  }
  process.exit(failures ? 1 : 0);
});
