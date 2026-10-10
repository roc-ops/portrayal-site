// The Lint rules page (portrayal-site#159).
//
// Every rule is rendered from assets/dist/lint-rules.json, the linter's own
// rule table (Portrayal #952), which refresh-assets.sh vendors beside the
// other indexes. Nothing about a rule is written here, so the page cannot
// drift from what the linter checks: the words for each severity token are
// this site's (site/lintcodes.js), and a token it does not know still shows,
// with a neutral label and the rule's three booleans.
//
// Each rule is an element with the code as its id, so lint.html#L53 lands on
// it; check-browser.py's check_lint_page counts the rules against the file and
// resolves every anchor.
import {splitCodes, severityOf, scopesOf, ruleMatches, retiredMatches, rankRules} from './lintcodes.js';

const SRC = 'assets/dist/lint-rules.json';
const $ = id => document.getElementById(id);

const el = (tag, attrs = {}, kids = []) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else n.setAttribute(k, v);
  }
  for (const c of [].concat(kids)) if (c) n.append(c);
  return n;
};

// The rule texts use backticks for code spans, as the schema descriptions do,
// and name other rules by code. Built as DOM nodes, never parsed as HTML. A
// code links to its entry on this page; one inside a code span stays code.
function richText(text) {
  const frag = document.createDocumentFragment();
  String(text ?? '').split(/`([^`]+)`/g).forEach((part, i) => {
    if (!part) return;
    if (i % 2) { frag.append(el('code', {class: 'sc-code', text: part})); return; }
    for (const p of splitCodes(part)) {
      frag.append(typeof p === 'string' ? document.createTextNode(p)
        : el('a', {class: 'lr-codelink', href: `#${p.code}`, text: p.code}));
    }
  });
  return frag;
}

function sevBadge(rule) {
  const s = severityOf(rule.severity, rule);
  const b = el('span', {class: `lr-sev${s.known ? '' : ' is-other'}`, 'data-sev': s.token || 'none',
                        title: s.long, text: s.label});
  return [b, s.known ? null : el('span', {class: 'lr-facts', text: `(${s.token || 'no token'}: ${s.long})`})];
}

function ruleBlock(rule) {
  const sec = el('section', {class: 'lr-rule', id: rule.code, 'data-rule': rule.code,
                             'data-scope': scopesOf(rule).join(','), 'data-severity': rule.severity ?? ''});
  sec.append(el('h2', {class: 'lr-head'}, [
    el('a', {class: 'lr-code', href: `#${rule.code}`, text: rule.code, 'aria-label': `${rule.code}, link to this rule`}),
    ...scopesOf(rule).map(s => el('span', {class: 'sc-type lr-scope', text: s})),
    ...sevBadge(rule),
  ]));
  const what = el('p', {class: 'lr-rule-text'});
  what.append(richText(rule.rule));
  sec.append(what);
  const dl = el('dl', {class: 'lr-dl'});
  for (const [label, key] of [['Why', 'why'], ['What to do', 'fix']]) {
    if (!rule[key]) continue;
    const dd = el('dd', {class: 'sc-desc', 'data-field': key});
    dd.append(richText(rule[key]));
    dl.append(el('dt', {text: label}), dd);
  }
  sec.append(dl);
  return sec;
}

function retiredBlock(r) {
  const sec = el('section', {class: 'lr-rule is-retired', id: r.code, 'data-retired': r.code});
  sec.append(el('h2', {class: 'lr-head'}, [
    el('a', {class: 'lr-code', href: `#${r.code}`, text: r.code}),
    el('span', {class: 'lr-sev is-other', text: 'Retired'}),
  ]));
  if (r.note) { const p = el('p', {class: 'sc-desc'}); p.append(richText(r.note)); sec.append(p); }
  return sec;
}

const body = $('lint-body');
let data;
try {
  const res = await fetch(SRC);
  if (!res.ok) throw new Error(`${res.status}`);
  data = await res.json();
} catch (err) {
  body.replaceChildren(el('p', {class: 'sc-loading',
    text: `Could not read ${SRC} — ${err.message}. This page must be served over HTTP.`}));
  throw err;
}
const RULES = Array.isArray(data.rules) ? data.rules.filter(r => r && typeof r.code === 'string') : [];
const RETIRED = Array.isArray(data.retired) ? data.retired.filter(r => r && typeof r.code === 'string') : [];

// The filters offer what the file has: every scope a rule names, and every
// severity token, in the order the file lists them, then any a rule uses that
// the list does not.
const scopes = [...new Set(RULES.flatMap(scopesOf))].sort();
const tokens = [...new Set([...(Array.isArray(data.severities) ? data.severities : []),
                            ...RULES.map(r => r.severity)].filter(t => typeof t === 'string' && t))];
$('scope').append(...scopes.map(s => el('option', {value: s, text: s})));
// A token's words come from severityOf, which asks hasOwnProperty: a token
// named "constructor" or "toString" is not one this site has words for.
$('severity').append(...tokens.map(t => {
  const s = severityOf(t);
  return el('option', {value: t, text: s.known ? s.label : `Other severity (${t})`});
}));

const list = el('div', {class: 'lr-list'});
const blocks = new Map(RULES.map(r => [r, ruleBlock(r)]));
list.append(...blocks.values());
const none = el('p', {class: 'sc-loading', id: 'lint-none', text: 'No rule matches.', hidden: ''});
body.replaceChildren(list, none);
const retired = new Map(RETIRED.map(r => [r, retiredBlock(r)]));
const retiredLabel = el('p', {class: 'sc-section-label', text: 'Retired codes, never reissued'});
if (RETIRED.length) body.append(retiredLabel, el('div', {class: 'lr-list'}, [...retired.values()]));

// Counts are read from the file, never typed.
const fails = RULES.filter(r => r.fails).length;
$('lintCount').textContent = String(RULES.length);
$('lintHead').replaceChildren(
  el('div', {class: 'sc-counts'}, [
    el('span', {class: 'sc-chip'}, [el('span', {class: 'sc-chip-k', text: 'rules'}), el('span', {class: 'sc-chip-v', text: String(RULES.length)})]),
    el('span', {class: 'sc-chip'}, [el('span', {class: 'sc-chip-k', text: 'can fail'}), el('span', {class: 'sc-chip-v', text: String(fails)})]),
    el('span', {class: 'sc-chip'}, [el('span', {class: 'sc-chip-k', text: 'retired'}), el('span', {class: 'sc-chip-v', text: String(RETIRED.length)})]),
    el('span', {class: 'sc-chip'}, [el('span', {class: 'sc-chip-k', text: 'format'}), el('span', {class: 'sc-chip-v', text: String(data.format)})]),
  ]));
$('lintSrc').textContent = SRC.split('/').pop();

function apply() {
  const f = {query: $('q').value, scope: $('scope').value, severity: $('severity').value};
  let shown = 0;
  for (const [r, b] of blocks) {
    const on = ruleMatches(r, f);
    b.hidden = !on;
    if (on) shown++;
  }
  // An exact code first ("L5" before L50 to L59); appending a node moves it.
  list.append(...rankRules(RULES, f.query).map(r => blocks.get(r)));
  // The retired codes answer the same search, so a filter that hides every
  // rule does not leave them listed under "No rule matches.".
  let retiredShown = 0;
  for (const [r, b] of retired) {
    const on = retiredMatches(r, f);
    b.hidden = !on;
    if (on) retiredShown++;
  }
  retiredLabel.hidden = retiredShown === 0;
  none.hidden = shown > 0 || retiredShown > 0;
  $('tally').textContent = shown === RULES.length ? `${RULES.length} rules` : `${shown} of ${RULES.length} rules`;
}

// AN ANCHOR ALWAYS LANDS. A link to lint.html#L53 from the schema page, or a
// code clicked in another rule, must show that rule even when the search or a
// filter would hide it; so the filters are cleared first, and the target is
// marked by class as well as by :target, since it was not in the document when
// the page's fragment was first resolved.
function land() {
  const id = decodeURIComponent(location.hash.slice(1));
  for (const t of document.querySelectorAll('.lr-rule.is-target')) t.classList.remove('is-target');
  const t = id && document.getElementById(id);
  if (!t || !t.classList.contains('lr-rule')) return;
  if (t.hidden) { $('q').value = ''; $('scope').value = ''; $('severity').value = ''; apply(); }
  t.classList.add('is-target');
  t.scrollIntoView({block: 'start'});
}

for (const id of ['q', 'scope', 'severity']) $(id).addEventListener(id === 'q' ? 'input' : 'change', apply);
window.addEventListener('hashchange', land);
// A link to the rule already in the address bar fires no hashchange, so a
// rule the filters hid since would stay hidden: land on the click as well.
document.addEventListener('click', e => {
  const a = e.target.closest?.('a[href^="#"]');
  if (a && a.hash && a.hash === location.hash) land();
});
apply();
land();
// The web fonts can arrive after the first landing and change the height of
// every rule above the target, which leaves it under the masthead or off the
// screen. Land again once they are in, unless the reader has moved on.
const landedAt = location.hash;
document.fonts?.ready.then(() => { if (location.hash === landedAt) land(); });
document.body.dataset.lintReady = '';
