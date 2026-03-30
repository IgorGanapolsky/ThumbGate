'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  escapePlistString,
  generatePlist,
  parseCronSpec,
} = require('../scripts/schedule-manager');

test('escapePlistString encodes XML metacharacters while preserving backslashes', () => {
  const input = String.raw`console.log("C:\temp\<tag>&'")`;
  const escaped = escapePlistString(input);

  assert.equal(
    escaped,
    String.raw`console.log(&quot;C:\temp\&lt;tag&gt;&amp;&#39;&quot;)`
  );
  assert.match(escaped, /C:\\temp\\/);
});

test('generatePlist escapes dynamic command, working directory, and schedule identifiers', () => {
  const plist = generatePlist({
    id: `nightly<&'"run">`,
    command: String.raw`console.log("C:\temp\<tag>&'")`,
    workingDirectory: `/tmp/thumbgate<&'"run">`,
    calendarInterval: { Hour: 9, Minute: 30 },
  });

  assert.match(plist, /<string>com\.thumbgate\.schedule\.nightly&lt;&amp;&#39;&quot;run&quot;&gt;<\/string>/);
  assert.match(plist, /<string>console\.log\(&quot;C:\\temp\\&lt;tag&gt;&amp;&#39;&quot;\)<\/string>/);
  assert.match(plist, /<string>\/tmp\/thumbgate&lt;&amp;&#39;&quot;run&quot;&gt;<\/string>/);
  assert.match(plist, /schedule-nightly&lt;&amp;&#39;&quot;run&quot;&gt;\.log/);
  assert.doesNotMatch(plist, /<string>[^<]*<tag>/);
});

test('parseCronSpec parses supported schedule formats', () => {
  assert.deepEqual(parseCronSpec('daily 9:30'), { Hour: 9, Minute: 30 });
  assert.deepEqual(parseCronSpec('weekly monday 8:15'), { Weekday: 1, Hour: 8, Minute: 15 });
  assert.deepEqual(parseCronSpec('hourly'), { Minute: 0 });
  assert.equal(parseCronSpec('nonsense'), null);
});
