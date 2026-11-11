// The entity map page (portrayal-site#12).
//
// Reads assets/dist/listings.json and, for the chosen listing, the component
// dump it names (copied into assets/dumps/ by refresh-assets.sh, at the path
// the listing gives). site/entity-join.js applies the listing's entity-map to
// the dump's component names; this file only draws the result. A listing with
// no entity-map, or whose dump is not here, is said so plainly, never an error.
import {joinNames, componentNames, entityListings, componentsDump} from './entity-join.js';

const LISTINGS = 'assets/dist/listings.json';
const DUMPS = 'assets/dumps/';
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
const code = t => el('code', {class: 'sc-code', text: t});

async function getJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}

function say(body, text) {
  body.replaceChildren(el('p', {class: 'sc-loading', 'data-en-say': '', text}));
}

function table(cols, rows) {
  return el('table', {class: 'en-table'}, [
    el('thead', {}, el('tr', {}, cols.map(c => el('th', {scope: 'col', text: c})))),
    el('tbody', {}, rows),
  ]);
}

function section(title, id, kids) {
  return el('section', {class: 'en-sec', 'data-en': id}, [el('h2', {class: 'en-h', text: title}), ...kids]);
}

function draw(body, key, listing, doc) {
  const {rows, unmapped, conflicts} = joinNames(listing['entity-map'], componentNames(doc));
  const parts = rows.filter(r => !r.region), regions = rows.filter(r => r.region);
  $('enTally').textContent = `${rows.length} joined (${parts.length} to drawn parts, ${regions.length} to a region), ` +
    `${unmapped.length} unmapped${conflicts.length ? `, ${conflicts.length} in conflict` : ''}`;
  const kids = [];
  kids.push(section('Drawn parts', 'parts', [parts.length
    ? table(['NOS name', 'Drawn id', 'Note'], parts.map(r => el('tr', {'data-name': r.name, 'data-to': r.to}, [
        el('td', {}, code(r.name)), el('td', {}, code(r.to)), el('td', {text: r.note})])))
    : el('p', {class: 'lr-facts', text: 'No name in the dump lands on a drawn part.'})]));
  if (regions.length) {
    kids.push(section('Regions the drawing does not show', 'regions', [
      el('p', {class: 'lr-rule-text', text: 'These names belong to the device, not to a part you could point at: they are joined to a region, not to an id.'}),
      table(['NOS name', 'Region', 'Note'], regions.map(r => el('tr', {'data-name': r.name, 'data-to': r.to}, [
        el('td', {}, code(r.name)), el('td', {}, code(r.region)), el('td', {text: r.note})])))]));
  }
  if (conflicts.length) {
    kids.push(section('Claimed by two rules', 'conflicts', [
      el('p', {class: 'lr-rule-text', text: 'Two rules give each of these names a different target, so it is joined to neither.'}),
      table(['NOS name', 'Targets'], conflicts.map(c => el('tr', {'data-name': c.name}, [
        el('td', {}, code(c.name)), el('td', {text: c.to.join(', ')})])))]));
  }
  kids.push(section('Unmapped', 'unmapped', [unmapped.length
    ? el('p', {class: 'lr-rule-text'}, [
        'No rule claims these names. The schema allows that: ', code('unmapped NOS nodes are legal'), '. ',
        ...unmapped.flatMap((n, i) => i ? [' ', code(n)] : [code(n)])])
    : el('p', {class: 'lr-facts', text: 'Every name in the dump is claimed by a rule.'})]));
  body.replaceChildren(...kids);
}

async function show(key, listings) {
  const body = $('en-body'), l = listings[key];
  $('enTally').textContent = '';
  $('enSrc').textContent = '';
  $('enIdentity').replaceChildren(el('p', {class: 'lr-facts', 'data-en-id': '',
    text: `${l.manufacturer ?? ''} ${l.nos ?? ''}, on ${l.hardware ?? 'unlisted hardware'}`.trim()}));
  if (!Array.isArray(l['entity-map']) || !l['entity-map'].length) {
    say(body, `${key} has no entity-map: its listing declares no rules, so there is nothing to join.`);
    return;
  }
  const path = componentsDump(l);
  if (!path) { say(body, `${key} has an entity-map but names no component dump to apply it to.`); return; }
  $('enSrc').textContent = path.split('/').pop();
  say(body, 'Reading the dump…');
  let doc;
  try { doc = await getJson(DUMPS + path); }
  catch { say(body, `${key} names ${path.split('/').pop()}, but it is not published on this site.`); return; }
  draw(body, key, l, doc);
}

async function main() {
  const body = $('en-body');
  let listings;
  try { listings = (await getJson(LISTINGS)).listings || {}; }
  catch { say(body, 'The listings could not be read.'); document.body.dataset.entitiesReady = ''; return; }
  const {withMap, without} = entityListings(listings);
  const sel = $('enDevice');
  for (const k of [...withMap, ...without]) {
    sel.append(el('option', {value: k, text: withMap.includes(k) ? k : `${k} (no entity-map)`}));
  }
  $('enCount').textContent = `${withMap.length} of ${withMap.length + without.length} listings`;
  const want = decodeURIComponent(location.hash.slice(1));
  sel.value = listings[want] ? want : (withMap[0] ?? sel.value);
  // The menu and the address bar say the same thing: a change in either shows that listing.
  const open = async key => { await show(key, listings); document.body.dataset.entitiesShown = key; };
  sel.addEventListener('change', () => { history.replaceState(null, '', `#${sel.value}`); open(sel.value); });
  addEventListener('hashchange', () => {
    const k = decodeURIComponent(location.hash.slice(1));
    if (listings[k] && k !== sel.value) { sel.value = k; open(k); }
  });
  if (sel.value) await open(sel.value); else say(body, 'No listing has an entity-map.');
  document.body.dataset.entitiesReady = '';
}

main();
