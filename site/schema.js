// The schema browser.
//
// Renders the schema documents at runtime rather than generating pages from
// them, so the page cannot drift from what the linter actually enforces. Point
// SOURCES at a different URL - the canonical $id once the repository is public -
// and this page follows the real file with no regeneration step.
//
// The keyword surface is deliberately closed, and it is small because these
// schemas are: type, properties, required, description, enum, const, $ref,
// items, oneOf, additionalProperties, default, pattern, format, minItems, title.
// No allOf, no if/then/else, no patternProperties. Anything NOT in that set is
// printed as raw JSON instead of being dropped, so a keyword added upstream
// shows up as something unstyled rather than silently going missing.

// Device first. A visitor arriving here is looking for "what is a device",
// and leading with the component contract read as though it were the device.
const SOURCES = {
  device:    {url: 'assets/schemas/device.schema.json',    label: 'one piece of hardware'},
  component: {url: 'assets/schemas/component.schema.json', label: 'a reusable part it places'},
  overlay:   {url: 'assets/schemas/overlay.schema.json',   label: "an operating system's naming"},
};

const KNOWN = new Set([
  'type', 'properties', 'required', 'description', 'enum', 'const', '$ref',
  'items', 'oneOf', 'additionalProperties', 'default', 'pattern', 'format',
  'minItems', 'maxItems', 'uniqueItems', 'minimum', 'maximum', 'title',
  'exclusiveMinimum', 'exclusiveMaximum', 'minProperties', 'maxProperties',
  'propertyNames',
  '$defs', '$id', '$schema', 'examples', 'deprecated',
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

const refName = ref => String(ref).split('/').pop();
const defId = name => `def-${name}`;

// What to print in the type slot. A node often has no `type` at all, because a
// const, an enum or a $ref carries the constraint instead.
function typeLabel(node) {
  if (!node || typeof node !== 'object') return '';
  if (node.$ref) return refName(node.$ref);
  if (node.oneOf) return 'one of';
  if (node.const !== undefined) return 'const';
  if (node.enum) return 'enum';
  const t = node.type;
  if (Array.isArray(t)) return t.join(' | ');
  if (t === 'array') {
    const inner = node.items ? typeLabel(node.items) : '';
    return inner ? `array of ${inner}` : 'array';
  }
  return t || '';
}

const chip = (label, value) =>
  el('span', {class: 'sc-chip'}, [
    label ? el('span', {class: 'sc-chip-k', text: label}) : null,
    el('span', {class: 'sc-chip-v', text: value}),
  ]);

// Constraints worth showing beside a property, in the order an author reads them.
function constraints(node) {
  const out = [];
  if (node.const !== undefined) out.push(chip('is', JSON.stringify(node.const)));
  if (node.enum) {
    for (const v of node.enum) out.push(el('span', {class: 'sc-enum', text: String(v)}));
  }
  if (node.default !== undefined) out.push(chip('default', JSON.stringify(node.default)));
  if (node.pattern) out.push(chip('pattern', node.pattern));
  if (node.format) out.push(chip('format', node.format));
  if (node.minItems !== undefined) out.push(chip('min items', String(node.minItems)));
  if (node.maxItems !== undefined) out.push(chip('max items', String(node.maxItems)));
  if (node.minimum !== undefined) out.push(chip('min', String(node.minimum)));
  if (node.maximum !== undefined) out.push(chip('max', String(node.maximum)));
  // These schemas use exclusiveMinimum heavily - a millimetre cannot be zero.
  if (node.exclusiveMinimum !== undefined) out.push(chip('greater than', String(node.exclusiveMinimum)));
  if (node.exclusiveMaximum !== undefined) out.push(chip('less than', String(node.exclusiveMaximum)));
  if (node.minProperties !== undefined) out.push(chip('min keys', String(node.minProperties)));
  if (node.maxProperties !== undefined) out.push(chip('max keys', String(node.maxProperties)));
  // propertyNames constrains the KEYS of an object rather than its values, and
  // in these schemas it is always a pattern.
  if (node.propertyNames) {
    const pn = node.propertyNames;
    out.push(chip('keys match', pn.pattern || JSON.stringify(pn)));
  }
  if (node.uniqueItems) out.push(chip('', 'unique items'));
  if (node.additionalProperties === false) out.push(chip('', 'no other keys'));
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

// The object a node describes, if it has one to descend into. An array's shape
// lives on its items, so unwrap that first.
function objectShape(node) {
  if (node.properties) return node;
  if (node.type === 'array' && node.items && typeof node.items === 'object') {
    return node.items.properties ? node.items : null;
  }
  return null;
}

function renderNode(node, depth) {
  const frag = document.createDocumentFragment();

  if (node.$ref) {
    const name = refName(node.$ref);
    frag.append(el('p', {class: 'sc-ref'}, [
      document.createTextNode('defined by '),
      el('a', {href: `#${defId(name)}`, class: 'sc-ref-link', text: name}),
    ]));
  }

  if (node.oneOf) {
    const wrap = el('div', {class: 'sc-oneof'});
    node.oneOf.forEach((branch, i) => {
      const b = el('div', {class: 'sc-branch'});
      b.append(el('p', {class: 'sc-branch-head', text: `option ${i + 1} — ${typeLabel(branch) || 'object'}`}));
      if (branch.description) b.append(el('p', {class: 'sc-desc', text: branch.description}));
      b.append(renderNode(branch, depth + 1));
      wrap.append(b);
    });
    frag.append(wrap);
  }

  const shape = objectShape(node);
  if (shape) frag.append(propertyList(shape, depth));
  else if (node.type === 'array' && node.items && !node.items.properties) {
    const inner = constraints(node.items);
    if (inner.length) frag.append(el('div', {class: 'sc-meta'}, inner));
  }
  return frag;
}

function propertyList(schema, depth) {
  const req = new Set(schema.required || []);
  const list = el('div', {class: 'sc-props'});
  for (const [name, prop] of Object.entries(schema.properties || {})) {
    const required = req.has(name);
    const row = el('div', {class: 'sc-prop'});
    const head = el('div', {class: 'sc-prop-head'}, [
      el('code', {class: `sc-name${required ? ' is-req' : ''}`, text: name}),
      typeLabel(prop) ? el('span', {class: 'sc-type', text: typeLabel(prop)}) : null,
      required ? el('span', {class: 'sc-req', text: 'required'}) : null,
    ]);
    row.append(head);
    if (prop.description) row.append(el('p', {class: 'sc-desc', text: prop.description}));
    const cons = constraints(prop);
    if (cons.length) row.append(el('div', {class: 'sc-meta'}, cons));

    const nested = renderNode(prop, depth + 1);
    if (nested.childNodes.length) {
      const shape = objectShape(prop);
      if (shape) {
        // Collapsible below the top level: a device manifest nests four deep and
        // opening all of it at once buries the shape it is meant to show.
        const d = el('details', {class: 'sc-nest'});
        if (depth < 1) d.setAttribute('open', '');
        const n = Object.keys(shape.properties).length;
        d.append(el('summary', {text: `${n} propert${n === 1 ? 'y' : 'ies'}`}));
        d.append(nested);
        row.append(d);
      } else {
        row.append(nested);
      }
    }
    const raw = unknownKeys(prop);
    if (raw) row.append(raw);
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
    el('div', {class: 'sc-counts'}, [
      chip('properties', String(props)),
      chip('required', String(req)),
      defs ? chip('shared definitions', String(defs)) : null,
      doc.additionalProperties === false ? chip('', 'no other keys') : null,
    ]),
  );

  body.append(el('p', {class: 'sc-section-label', text: 'Properties'}));
  body.append(propertyList(doc, 0));

  if (defs) {
    body.append(el('p', {class: 'sc-section-label', text: 'Shared definitions'}));
    for (const [name, def] of Object.entries(doc.$defs)) {
      const block = el('section', {class: 'sc-def', id: defId(name)});
      block.append(el('h3', {class: 'sc-def-name'}, [
        el('code', {text: name}),
        typeLabel(def) ? el('span', {class: 'sc-type', text: typeLabel(def)}) : null,
      ]));
      if (def.description) block.append(el('p', {class: 'sc-desc', text: def.description}));
      const cons = constraints(def);
      if (cons.length) block.append(el('div', {class: 'sc-meta'}, cons));
      block.append(renderNode(def, 0));
      const raw = unknownKeys(def);
      if (raw) block.append(raw);
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
    const res = await fetch(url, {cache: 'no-store'});
    if (!res.ok) throw new Error(`${res.status}`);
    renderSchema(await res.json(), key);
    if (location.hash) document.querySelector(location.hash)?.scrollIntoView();
  } catch (err) {
    body.replaceChildren(el('p', {class: 'sc-loading',
      text: `Could not read ${url} — ${err.message}. This page must be served over HTTP.`}));
  }
}

document.querySelectorAll('.show-tabs button').forEach(b => {
  b.onclick = () => { show(b.dataset.schema); };
});
show(new URLSearchParams(location.search).get('doc') in SOURCES
  ? new URLSearchParams(location.search).get('doc') : 'device');
