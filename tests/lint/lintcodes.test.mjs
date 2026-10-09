import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { splitCodes, severityOf, severityFacts, scopesOf, ruleMatches, ruleHref, SEVERITY }
  from '../../site/lintcodes.js';

const codes = s => splitCodes(s).filter(p => typeof p !== 'string').map(p => p.code);
const join = parts => parts.map(p => (typeof p === 'string' ? p : p.code)).join('');

test('rule codes in prose are found, and nothing else is dropped', () => {
  const s = 'The schema holds the words (L1). Lint L169 checks it; see L53, L107.';
  assert.deepEqual(codes(s), ['L1', 'L169', 'L53', 'L107']);
  assert.equal(join(splitCodes(s)), s);
  assert.deepEqual(splitCodes(''), []);
  assert.deepEqual(splitCodes('no codes here'), ['no codes here']);
});

// The schemas name the lines of a power circuit L1, L2 and L3. The phase
// mapping is written "(L1 is A, L2 B, L3 C)"; those are lines, not rules.
test('the lines of a circuit are not rule codes', () => {
  assert.deepEqual(codes('on a three-phase wye input (L1 is A, L2 B, L3 C). Lint L169 checks'), ['L169']);
  assert.deepEqual(codes('L5 is an error'), ['L5']);
  assert.deepEqual(codes('XL53, L1000, L53a'), []);
});

test('a code links to its anchor on the Lint rules page', () => {
  assert.equal(ruleHref('L53'), 'lint.html#L53');
  assert.equal(ruleHref('L53', ''), '#L53');
});

// Portrayal's docs/format-stability.md: five tokens, and a consumer shows an
// unknown token with the rule's booleans rather than failing on it.
test('the five tokens have words, and an unknown token gets a neutral label and its booleans', () => {
  assert.deepEqual(Object.keys(SEVERITY), ['error', 'warning', 'at-verified', 'mixed', 'mixed-at-verified']);
  for (const t of Object.keys(SEVERITY)) {
    const s = severityOf(t);
    assert.equal(s.known, true);
    assert.ok(s.label && s.long && s.label !== t, `${t} has its own words`);
  }
  const rule = {severity: 'advisory', fails: false, warns: true, 'fails-at-verified': true};
  const u = severityOf(rule.severity, rule);
  assert.equal(u.known, false);
  assert.equal(u.token, 'advisory');
  assert.equal(u.label, 'Other severity');
  assert.equal(u.long, 'fails: no; warns: yes; fails when verified: yes');
  assert.equal(severityFacts({}), 'fails: no; warns: no; fails when verified: no');
  assert.equal(severityOf(undefined).known, false);
  assert.equal(severityOf('toString').known, false, 'a prototype key is not a token');
});

test('a scope list splits on commas', () => {
  assert.deepEqual(scopesOf({scope: 'component, device'}), ['component', 'device']);
  assert.deepEqual(scopesOf({scope: 'any yaml'}), ['any yaml']);
  assert.deepEqual(scopesOf({}), []);
});

const L52 = {code: 'L52', scope: 'component', rule: 'a stated power figure says where it was read from',
             why: 'Vendor power figures vary', fix: 'add the provenance key', severity: 'warning',
             fails: false, warns: true, 'fails-at-verified': false};
const L23 = {code: 'L23', scope: 'component, device', rule: 'ids are unique', why: 'a duplicate id is ambiguous',
             fix: 'rename one', severity: 'error', fails: true, warns: false, 'fails-at-verified': false};

test('search looks through every field, word by word, and the filters narrow it', () => {
  assert.ok(ruleMatches(L52, {}));
  assert.ok(ruleMatches(L52, {query: 'l52'}));
  assert.ok(ruleMatches(L52, {query: 'VENDOR provenance'}), 'why and fix');
  assert.ok(ruleMatches(L52, {query: 'warns'}), "the site's words for the severity");
  assert.ok(!ruleMatches(L52, {query: 'provenance duplicate'}), 'every word must match');
  assert.ok(ruleMatches(L23, {scope: 'device'}) && ruleMatches(L23, {scope: 'component'}));
  assert.ok(!ruleMatches(L52, {scope: 'device'}));
  assert.ok(ruleMatches(L23, {severity: 'error'}) && !ruleMatches(L52, {severity: 'error'}));
});

// The vendored file, if this checkout has one, is what the page reads.
test('every rule in the vendored lint-rules.json is searchable by its code', () => {
  let data;
  try { data = JSON.parse(readFileSync(new URL('../../assets/dist/lint-rules.json', import.meta.url))); }
  catch { return; }
  assert.ok(data.rules.length > 0);
  for (const r of data.rules) assert.ok(ruleMatches(r, {query: r.code}), r.code);
});
