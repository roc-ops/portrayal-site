// Lint rule codes, in the words this site uses for them (portrayal-site#159).
//
// Pure: no DOM, no fetch, so node --test runs it (tests/lint/). Shared by the
// Lint rules page, which renders assets/dist/lint-rules.json, and by the
// schema page, which links every rule code its descriptions mention.

// A RULE CODE IN PROSE: L followed by one to three digits. The schemas also
// name the lines of a power circuit L1, L2 and L3, and write the phase mapping
// as "L1 is A, L2 B, L3 C"; a code followed by " is A", " B" or " C" is that
// line and not a rule, so it is not linked. A conductor list such as
// `[L1, N]` sits in a code span, which is never linked.
//
// check-contract.py reads this literal and applies it to the vendored
// schemas, so the codes it requires lint-rules.json to carry are exactly the
// ones this site links. Keep it a single-line regex literal.
export const LINT_CODE = /\bL(\d{1,3})\b(?!(?: is)? [A-C]\b)/g;

// Split prose into text and rule codes, in order. A code is {code: 'L53'};
// text is a plain string. Nothing is dropped: joining the parts gives back
// the input.
export function splitCodes(text) {
  const s = String(text ?? '');
  const out = [];
  let last = 0;
  for (const m of s.matchAll(new RegExp(LINT_CODE.source, 'g'))) {
    if (m.index > last) out.push(s.slice(last, m.index));
    out.push({code: m[0]});
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}

// Where a rule's entry is on the Lint rules page.
export const ruleHref = (code, page = 'lint.html') => `${page}#${code}`;

// THE SEVERITY TOKENS, in this site's words. Portrayal's
// docs/format-stability.md defines five and says a new one does not raise the
// file's format, so a token not listed here must still show: it gets a neutral
// label, and the rule's three booleans are spelled out beside it.
export const SEVERITY = {
  'error': {
    label: 'Fails',
    long: 'Every finding fails the lint.',
  },
  'warning': {
    label: 'Warns',
    long: 'Every finding is a warning; the lint passes.',
  },
  'at-verified': {
    label: 'Warns, fails when verified',
    long: 'A finding warns on a device still being drawn and fails on a device that claims maturity: verified.',
  },
  'mixed': {
    label: 'Fails or warns',
    long: 'Some findings fail and others only warn; the message in the lint run says which.',
  },
  'mixed-at-verified': {
    label: 'Fails, or warns until verified',
    long: 'Some findings always fail; the others warn until the device claims maturity: verified.',
  },
};

const yesNo = b => (b ? 'yes' : 'no');

// The three booleans, in words, for a token this site has no words for.
export function severityFacts(rule) {
  return `fails: ${yesNo(rule?.fails)}; warns: ${yesNo(rule?.warns)}; ` +
         `fails when verified: ${yesNo(rule?.['fails-at-verified'])}`;
}

// {token, label, long, known} for a rule's severity token.
export function severityOf(token, rule) {
  const t = typeof token === 'string' && token ? token : '';
  const k = Object.prototype.hasOwnProperty.call(SEVERITY, t) ? SEVERITY[t] : null;
  if (k) return {token: t, label: k.label, long: k.long, known: true};
  return {token: t, label: 'Other severity', long: rule ? severityFacts(rule) : '', known: false};
}

// A rule's scope is one word or several, comma-separated ("component, device").
export const scopesOf = rule =>
  String(rule?.scope ?? '').split(',').map(s => s.trim()).filter(Boolean);

// Everything a search looks through, lower-cased: the code, its scopes, the
// rule, why, what to do, and the severity in both the file's token and this
// site's words.
export function haystack(rule) {
  const sev = severityOf(rule?.severity, rule);
  return [rule?.code, rule?.scope, rule?.rule, rule?.why, rule?.fix, rule?.severity, sev.label, sev.long]
    .filter(v => typeof v === 'string').join('\n').toLowerCase();
}

// Does a rule pass the search box and the two filters? Every word of the
// query must appear somewhere in the rule; an empty filter passes all.
export function ruleMatches(rule, {query = '', scope = '', severity = ''} = {}) {
  if (scope && !scopesOf(rule).includes(scope)) return false;
  if (severity && rule?.severity !== severity) return false;
  const words = String(query).toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const h = haystack(rule);
  return words.every(w => h.includes(w));
}
