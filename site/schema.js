// The schema browser.
//
// Renders the schema documents at runtime rather than generating pages from
// them, so the page cannot drift from what the linter actually enforces. Point
// SOURCES at a different URL - the canonical $id once the repository is public -
// and this page follows the real file with no regeneration step.
//
// The keyword surface is deliberately closed: KNOWN below is every keyword
// this viewer renders, and check-contract.py fails a refresh the day a schema
// uses one that is not on it. Anything NOT in the set is still printed as raw
// JSON rather than dropped, so a keyword added upstream shows up as something
// unstyled rather than silently going missing.
//
// Every property row carries its JSON pointer in data-ptr, and check-browser.py
// compares those against every property in the files. That is the check the
// keyword list cannot make: the viewer once knew every keyword in use and still
// never descended into a map (`views`, `configurations`, `groups`, `bays`), so
// 146 of the device schema's 230 properties were not on this page at all.

// Device first. A visitor arriving here is looking for "what is a device",
// and leading with the component contract read as though it were the device.
import {splitCodes, ruleHref} from './lintcodes.js';

const SOURCES = {
  device:    {url: 'assets/schemas/device.schema.json',    label: 'one piece of hardware'},
  component: {url: 'assets/schemas/component.schema.json', label: 'a reusable part it places'},
  // A NOS vendor LISTS the hardware it supports (Portrayal #677, listing.schema.json);
  // before that a NOS was an overlay on the hardware (overlay.schema.json). The
  // page offers whichever of the two the vendored schemas carry - see `present`.
  listing:   {url: 'assets/schemas/listing.schema.json',   label: 'a NOS vendor listing the hardware it supports'},
  // A LAB: placements in a rack, rack-face parts on a host (Portrayal #852, lab.schema.json).
  lab:       {url: 'assets/schemas/lab.schema.json',       label: 'a lab of devices placed in a rack'},
  overlay:   {url: 'assets/schemas/overlay.schema.json',   label: "an operating system's naming"},
  // The Rack Builder's file. Portrayal's since the rack core moved into the kit
  // (@portrayal/kit 0.3.0, spec/schemas/rack.schema.json), so vendored like the rest.
  rack:      {url: 'assets/schemas/rack.schema.json',      label: 'a rack built in the Rack Builder'},
  // A MARKED-UP DRAWING: what Annotate's marks normalise to (Portrayal #898, marks.schema.json).
  marks:     {url: 'assets/schemas/marks.schema.json',     label: 'a drawing marked up in Annotate'},
};

const KNOWN = new Set([
  'type', 'properties', 'required', 'description', 'enum', 'const', '$ref',
  'items', 'oneOf', 'anyOf', 'allOf', 'if', 'then', 'else', 'not',
  'additionalProperties', 'patternProperties', 'default', 'pattern', 'format',
  'minItems', 'maxItems', 'uniqueItems', 'minimum', 'maximum', 'title',
  'exclusiveMinimum', 'exclusiveMaximum', 'minProperties', 'maxProperties',
  'minLength', 'maxLength', 'propertyNames', 'dependentRequired',
  '$defs', '$id', '$schema', '$comment', 'examples', 'deprecated',
]);

const el = (tag, attrs = {}, kids = []) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k === 'html') n.innerHTML = v;
    else n.setAttribute(k, v);
  }
  for (const c of [].concat(kids)) if (c) n.append(c);
  return n;
};


// Descriptions are prose written for people, and these ones use backticks for
// code spans - `data-<key>`, `power-max-w`. Rendering them as flat text left the
// backticks on screen. Built as DOM nodes rather than parsed as HTML, so the
// angle brackets inside those spans are safe by construction rather than by
// escaping.
//
// Paired backticks only. An unpaired one stays literal, because swallowing the
// rest of a sentence is worse than showing one stray character.
//
// A lint rule code in the prose (L53) links to its entry on the Lint rules
// page (portrayal-site#159). site/lintcodes.js says what counts as a code;
// check-contract.py applies the same pattern to the vendored schemas and fails
// when a code linked here has no entry in lint-rules.json. A code inside a
// code span stays code.
function richText(text) {
  const frag = document.createDocumentFragment();
  String(text).split(/`([^`]+)`/g).forEach((part, i) => {
    if (!part) return;
    if (i % 2) { frag.append(el('code', {class: 'sc-code', text: part})); return; }
    for (const p of splitCodes(part)) {
      frag.append(typeof p === 'string' ? document.createTextNode(p)
        : el('a', {class: 'sc-lint', href: ruleHref(p.code), 'data-lint': p.code, text: p.code}));
    }
  });
  return frag;
}

const descP = text => {
  const p = el('p', {class: 'sc-desc'});
  p.append(richText(text));
  return p;
};

const refName = ref => String(ref).split('/').pop();
const defId = name => `def-${name}`;

// What to print in the type slot. A node often has no `type` at all, because a
// const, an enum or a $ref carries the constraint instead.
function typeLabel(node) {
  if (!node || typeof node !== 'object') return '';
  if (node.$ref) return refName(node.$ref);
  if (node.oneOf) return 'one of';
  if (node.anyOf) return 'any of';
  if (node.const !== undefined) return 'const';
  if (node.enum) return 'enum';
  const t = node.type;
  if (Array.isArray(t)) return t.join(' | ');
  if (t === 'array') {
    const inner = node.items ? typeLabel(node.items) : '';
    return inner ? `array of ${inner}` : 'array';
  }
  // A map: an object whose keys are names the author picks - a view, a bay, a
  // configuration - and whose values all share one shape.
  if (isMap(node)) {
    const inner = typeLabel(node.additionalProperties);
    return inner ? `map of ${inner}` : 'map';
  }
  return t || '';
}

const isSchema = v => !!v && typeof v === 'object' && !Array.isArray(v);
const isMap = node => isSchema(node.additionalProperties) && !node.properties;

// JSON Pointer segments escape ~ and /, and check-browser.py builds its pointers
// the same way, so the two sides agree on a key like `a/b`.
const seg = k => String(k).replace(/~/g, '~0').replace(/\//g, '~1');

const chip = (label, value) =>
  el('span', {class: 'sc-chip'}, [
    label ? el('span', {class: 'sc-chip-k', text: label}) : null,
    el('span', {class: 'sc-chip-v', text: value}),
  ]);

// Constraints worth showing beside a property, in the order an author reads them.
function constraints(node) {
  const out = [];
  if (node.deprecated) out.push(chip('', 'deprecated'));
  if (node.const !== undefined) out.push(chip('is', JSON.stringify(node.const)));
  if (node.enum) {
    for (const v of node.enum) out.push(el('span', {class: 'sc-enum', text: String(v)}));
  }
  if (node.default !== undefined) out.push(chip('default', JSON.stringify(node.default)));
  if (node.pattern) out.push(chip('pattern', node.pattern));
  if (node.format) out.push(chip('format', node.format));
  if (node.minLength !== undefined) out.push(chip('min length', String(node.minLength)));
  if (node.maxLength !== undefined) out.push(chip('max length', String(node.maxLength)));
  if (node.minItems !== undefined) out.push(chip('min items', String(node.minItems)));
  if (node.maxItems !== undefined) out.push(chip('max items', String(node.maxItems)));
  if (node.minimum !== undefined) out.push(chip('min', String(node.minimum)));
  if (node.maximum !== undefined) out.push(chip('max', String(node.maximum)));
  // These schemas use exclusiveMinimum heavily - a millimetre cannot be zero.
  if (node.exclusiveMinimum !== undefined) out.push(chip('greater than', String(node.exclusiveMinimum)));
  if (node.exclusiveMaximum !== undefined) out.push(chip('less than', String(node.exclusiveMaximum)));
  if (node.minProperties !== undefined) out.push(chip('min keys', String(node.minProperties)));
  if (node.maxProperties !== undefined) out.push(chip('max keys', String(node.maxProperties)));
  // propertyNames constrains the KEYS of an object rather than its values: a
  // pattern, or a $ref to one.
  if (node.propertyNames) {
    const pn = node.propertyNames;
    out.push(chip('keys match', pn.pattern || (pn.$ref ? refName(pn.$ref) : JSON.stringify(pn))));
  }
  // `interface-at` means nothing without an `interface` to present there.
  for (const [k, needs] of Object.entries(node.dependentRequired || {})) {
    out.push(chip(`${k} needs`, needs.join(', ')));
  }
  if (node.uniqueItems) out.push(chip('', 'unique items'));
  if (node.additionalProperties === false) out.push(chip('', 'no other keys'));
  if (node.examples) out.push(chip('e.g.', node.examples.map(v => JSON.stringify(v)).join(', ')));
  return out;
}

// Anything the renderer does not understand, shown rather than swallowed.
function unknownKeys(node) {
  const extra = Object.keys(node).filter(k => !KNOWN.has(k));
  if (!extra.length) return null;
  const d = el('details', {class: 'sc-raw'});
  d.append(el('summary', {text: `${extra.length} key${extra.length > 1 ? 's' : ''} this viewer does not render`}));
  d.append(el('pre', {text: JSON.stringify(Object.fromEntries(extra.map(k => [k, node[k]])), null, 2)}));
  return d;
}

// A labelled sub-schema: a map's value, a branch of a oneOf, the `then` of a
// condition. Its description and constraints first, then whatever it contains.
//
// ctx says what the rows inside mean. {test: true} is an `if`: a key in its
// `required` is a key whose PRESENCE is tested, not one the author must give.
// {outcome: true} is a `then` or an `otherwise`: its `required` adds to the
// keys the author must give, so it is listed in full - a branch can require a
// key it says nothing else about (component.schema.json's otherwise requires
// `class` and `size` and has no entry for either).
function branch(head, node, depth, ptr, ctx = {}) {
  const b = el('div', {class: 'sc-branch', 'data-at': ptr});
  b.append(el('p', {class: 'sc-branch-head', text: head}));
  if (node.description) b.append(descP(node.description));
  const cons = constraints(node);
  if (cons.length) b.append(el('div', {class: 'sc-meta'}, cons));
  if (ctx.outcome && Array.isArray(node.required) && node.required.length) {
    const own = node.properties || {};
    const line = el('div', {class: 'sc-meta sc-branch-req', 'data-required': node.required.join(' ')}, [
      el('span', {class: 'sc-req', text: 'also required'}),
      ...node.required.map(k => el('code', {class: 'sc-enum', 'data-key': k, text: k,
        title: k in own ? `${k} - see its row below` : `${k} - defined above; this branch only requires it`})),
    ]);
    b.append(line);
  }
  b.append(renderNode(node, depth, ptr, ctx));
  return b;
}

// What an `if` asks, in words for the shapes these schemas use: keys that
// are given, and keys given a const (component.schema.json's `kind: kit`).
function condition(node) {
  const keys = Object.keys(node);
  const props = node.properties || {};
  const consts = Object.entries(props).filter(([, v]) => isSchema(v) && v.const !== undefined && Object.keys(v).length === 1);
  if (keys.every(k => k === 'required' || k === 'properties') && Array.isArray(node.required || [])
      && consts.length === Object.keys(props).length) {
    const given = (node.required || []).filter(k => !(k in props));
    const parts = [...consts.map(([k, v]) => `\`${k}\` is ${JSON.stringify(v.const)}`),
                   ...(given.length ? [`${given.map(k => `\`${k}\``).join(' and ')} ${given.length > 1 ? 'are' : 'is'} given`] : [])];
    if (parts.length) return `when ${parts.join(' and ')}`;
  }
  return `when it matches ${JSON.stringify(node)}`;
}

// What a `not` refuses, in words for the shapes these schemas use: keys that
// may not be given, alone or as any of several.
const onlyRequired = n => isSchema(n) && Array.isArray(n.required) && Object.keys(n).every(k => k === 'required');
const keysText = ks => ks.map(k => `\`${k}\``).join(' and ');
function negation(node) {
  if (onlyRequired(node)) return `give ${keysText(node.required)}`;
  if (Array.isArray(node.anyOf) && Object.keys(node).length === 1 && node.anyOf.every(onlyRequired))
    return `give any of ${node.anyOf.map(b => keysText(b.required)).join(', ')}`;
  return `match ${JSON.stringify(node)}`;
}

const COMBINERS = [
  ['oneOf', 'exactly one of these'],
  ['anyOf', 'at least one of these'],
  ['allOf', 'and all of these'],
];

// Everything a schema node contains, at every position a sub-schema can sit.
// ptr is the node's JSON pointer, and it is what every property row is stamped
// with - check-browser.py walks the file the same way and fails on a property
// this function never reached.
function renderNode(node, depth, ptr, ctx = {}) {
  const frag = document.createDocumentFragment();
  if (!isSchema(node)) return frag;

  if (node.$ref) {
    const name = refName(node.$ref);
    frag.append(el('p', {class: 'sc-ref'}, [
      document.createTextNode('defined by '),
      el('a', {href: `#${defId(name)}`, class: 'sc-ref-link', text: name}),
    ]));
  }

  // $comment is written for whoever maintains the schema, and it is often the
  // only place a non-obvious shape is explained - so show it, marked as such.
  if (node.$comment) {
    const p = el('p', {class: 'sc-desc sc-note'}, [el('span', {class: 'sc-note-k', text: 'schema note '})]);
    p.append(richText(node.$comment));
    frag.append(p);
  }

  if (node.properties) frag.append(propertyList(node, depth, ptr, ctx));

  for (const [pat, sub] of Object.entries(node.patternProperties || {})) {
    frag.append(branch(`each key matching ${pat}`, sub, depth + 1,
                       `${ptr}/patternProperties/${seg(pat)}`, ctx));
  }

  if (isSchema(node.additionalProperties)) {
    frag.append(branch(node.properties ? 'each other key' : 'each key',
                       node.additionalProperties, depth + 1, `${ptr}/additionalProperties`, ctx));
  }

  // An array's shape lives on its items. Rendered in place rather than as a
  // labelled branch: "a list of these" is already in the type slot.
  if (isSchema(node.items)) {
    const it = node.items;
    if (it.description) frag.append(descP(it.description));
    const inner = constraints(it);
    if (inner.length) frag.append(el('div', {class: 'sc-meta'}, inner));
    frag.append(renderNode(it, depth, `${ptr}/items`, ctx));
  }

  // Last, because each of these refines the shape above it: a oneOf picks
  // between shapes, an allOf layers a rule onto one key of a map, an if/else
  // tightens a property when another is present.
  for (const [kw, label] of COMBINERS) {
    if (!Array.isArray(node[kw])) continue;
    const wrap = el('div', {class: 'sc-oneof'});
    node[kw].forEach((b, i) => {
      wrap.append(branch(`${label} — option ${i + 1}${typeLabel(b) ? ` — ${typeLabel(b)}` : ''}`,
                         b, depth + 1, `${ptr}/${kw}/${i}`, ctx));
    });
    frag.append(wrap);
  }

  // A NEGATION (`not`): a shape the node must not have. The schemas use it
  // to take keys away - `trays` on any view but `top`, `at` or `diameter` on
  // a tray's slack that is not stored - so it is said in those words where it
  // is only `required` keys, and its keys are shown as tested (their presence
  // is what is refused), stamped with their /not/ pointers.
  if (isSchema(node.not)) {
    const wrap = el('div', {class: 'sc-oneof sc-cond', 'data-negated': ptr || '/'});
    const head = el('p', {class: 'sc-branch-head'});
    head.append(richText(`must not: ${negation(node.not)}`));
    wrap.append(head);
    wrap.append(branch('the shape it must not have', node.not, depth + 1, `${ptr}/not`, {test: true}));
    frag.append(wrap);
  }

  // A CONDITION. The `if` is a schema too, and the properties it tests are
  // properties of this node: they are shown under "condition", stamped with
  // their /if/ pointers, as the `then` and `otherwise` branches are with theirs.
  // The block is set apart by a rule down its left (sc-cond) and carries the
  // pointer of the node it conditions in data-conditional.
  if (isSchema(node.if)) {
    const wrap = el('div', {class: 'sc-oneof sc-cond', 'data-conditional': ptr || '/'});
    const when = el('p', {class: 'sc-branch-head'});
    when.append(richText(`conditional: ${condition(node.if)}`));
    wrap.append(when);
    if (node.if.properties) wrap.append(branch('condition — the keys it tests', node.if, depth + 1, `${ptr}/if`, {test: true}));
    if (isSchema(node.then)) wrap.append(branch('then', node.then, depth + 1, `${ptr}/then`, {outcome: true}));
    if (isSchema(node.else)) wrap.append(branch('otherwise', node.else, depth + 1, `${ptr}/else`, {outcome: true}));
    frag.append(wrap);
  }

  const raw = unknownKeys(node);
  if (raw) frag.append(raw);
  return frag;
}

// The collapsed summary for a nested block: how much is inside it.
function countProps(node, seen = 0) {
  if (!isSchema(node)) return seen;
  if (node.properties) return Object.keys(node.properties).length;
  if (isSchema(node.items)) return countProps(node.items);
  if (isSchema(node.additionalProperties)) return countProps(node.additionalProperties);
  return seen;
}

// A property whose schema is `false` matches nothing: the key may not appear.
// It is how an `otherwise` takes keys away (component.schema.json's root
// forbids `motion`, `travel` and the rest unless `kind` is "kit"), and printed
// as a plain key it read as the opposite.
function propertyList(schema, depth, ptr, ctx = {}) {
  const req = new Set(schema.required || []);
  const list = el('div', {class: 'sc-props'});
  for (const [name, prop] of Object.entries(schema.properties || {})) {
    const here = `${ptr}/properties/${seg(name)}`;
    const forbidden = prop === false;
    // Inside an `if`, `required` asks whether the key is there: tested, not demanded.
    const tested = ctx.test && req.has(name);
    const required = !ctx.test && !forbidden && req.has(name);
    const row = el('div', {class: `sc-prop${forbidden ? ' is-forbidden' : ''}`, 'data-ptr': here});
    if (forbidden) row.dataset.forbidden = '';
    const head = el('div', {class: 'sc-prop-head'}, [
      el('code', {class: `sc-name${required ? ' is-req' : ''}`, text: name}),
      typeLabel(prop) ? el('span', {class: 'sc-type', text: typeLabel(prop)}) : null,
      required ? el('span', {class: 'sc-req', text: 'required'}) : null,
      tested ? el('span', {class: 'sc-req sc-tested', text: 'tested: present',
                           title: 'the condition holds only when this key is given'}) : null,
      forbidden ? el('span', {class: 'sc-req sc-forbidden', text: 'not allowed',
                              title: 'its schema is false: this key may not appear here'}) : null,
    ]);
    row.append(head);
    if (!isSchema(prop)) { list.append(row); continue; }
    if (prop.description) row.append(descP(prop.description));
    const cons = constraints(prop);
    if (cons.length) row.append(el('div', {class: 'sc-meta'}, cons));

    const nested = renderNode(prop, depth + 1, here, ctx);
    const n = countProps(prop);
    if (n) {
      // Collapsible below the top level: a device manifest nests six deep and
      // opening all of it at once buries the shape it is meant to show.
      const d = el('details', {class: 'sc-nest'});
      if (depth < 1) d.setAttribute('open', '');
      const each = isMap(prop) ? 'each key: ' : prop.type === 'array' ? 'each item: ' : '';
      d.append(el('summary', {text: `${each}${n} propert${n === 1 ? 'y' : 'ies'}`}));
      d.append(nested);
      row.append(d);
    } else if (nested.childNodes.length) {
      row.append(nested);
    }
    list.append(row);
  }
  return list;
}

function renderSchema(doc, key) {
  const head = document.getElementById('schemaHead');
  const body = document.getElementById('schema-body');
  head.replaceChildren();
  body.replaceChildren();

  const req = (doc.required || []).length;
  const props = Object.keys(doc.properties || {}).length;
  const defs = Object.keys(doc.$defs || {}).length;

  head.append(
    el('h2', {class: 'sc-title', text: doc.title || key}),
    el('p', {class: 'sc-id mono', text: doc.$id || ''}),
    doc.description ? descP(doc.description) : null,
    el('div', {class: 'sc-counts'}, [
      chip('properties', String(props)),
      chip('required', String(req)),
      defs ? chip('shared definitions', String(defs)) : null,
      ...constraints(doc),
    ]),
  );

  body.append(el('p', {class: 'sc-section-label', text: 'Properties'}));
  body.append(renderNode(doc, 0, ''));

  if (defs) {
    body.append(el('p', {class: 'sc-section-label', text: 'Shared definitions'}));
    for (const [name, def] of Object.entries(doc.$defs)) {
      const block = el('section', {class: 'sc-def', id: defId(name)});
      block.append(el('h3', {class: 'sc-def-name'}, [
        el('code', {text: name}),
        typeLabel(def) ? el('span', {class: 'sc-type', text: typeLabel(def)}) : null,
      ]));
      if (!isSchema(def)) { body.append(block); continue; }
      if (def.description) block.append(descP(def.description));
      const cons = constraints(def);
      if (cons.length) block.append(el('div', {class: 'sc-meta'}, cons));
      block.append(renderNode(def, 0, `/$defs/${seg(name)}`));
      body.append(block);
    }
  }
}

async function show(key) {
  const {url, label} = SOURCES[key];
  document.querySelectorAll('.show-tabs button').forEach(b =>
    b.setAttribute('aria-selected', String(b.dataset.schema === key)));
  document.getElementById('schemaSrc').textContent = url.split('/').pop();
  document.getElementById('schemaHint').textContent =
    `What Portrayal knows about ${label}. Rendered from the schema file, not transcribed from it.`;
  const body = document.getElementById('schema-body');
  body.replaceChildren(el('p', {class: 'sc-loading', text: 'Reading the schema…'}));
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status}`);
    renderSchema(await res.json(), key);
    if (location.hash) document.querySelector(location.hash)?.scrollIntoView();
  } catch (err) {
    body.replaceChildren(el('p', {class: 'sc-loading',
      text: `Could not read ${url} — ${err.message}. This page must be served over HTTP.`}));
  }
}

// A TAB FOR EACH SCHEMA THE SITE CARRIES, AND NONE FOR ONE IT DOES NOT.
// refresh-assets.sh lists the vendored files in assets/schemas/index.json; a
// tab whose file is not listed is hidden. Asking for the file instead would be
// a 404 on every visit for whichever of overlay/listing is not here. Without
// an index every tab shows, as it did before there was one.
const listed = await fetch('assets/schemas/index.json').then(r => (r.ok ? r.json() : null))
  .then(d => (d && Array.isArray(d.schemas) ? new Set(d.schemas) : null)).catch(() => null);
const have = Object.fromEntries(Object.entries(SOURCES).map(([k, {url}]) =>
  [k, !url.startsWith('assets/schemas/') || !listed || listed.has(url.split('/').pop())]));
document.querySelectorAll('.show-tabs button').forEach(b => {
  b.hidden = !have[b.dataset.schema];
  b.onclick = () => { show(b.dataset.schema); };
});
const asked = new URLSearchParams(location.search).get('doc');
show(asked in SOURCES && have[asked] ? asked : 'device');
