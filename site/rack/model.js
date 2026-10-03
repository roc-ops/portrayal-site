// THE RACK FILE (spec §5). Pure data: no DOM, no fetch, no rendering, so the
// page, the library, the exports and `node --test` all read one definition.
//
// A document holds an ARRAY of racks although the page edits one: rows of
// racks come later, and a file written today must still open then. Every
// edit here returns a new object - the page autosaves whatever it last
// committed, and a shared, mutated rack is how a save would catch half an edit.

export const FORMAT = 'portrayal-rack';
export const VERSION = 1;
export const THREADS = ['12-24', '10-32', 'M6'];
// MIGRATIONS[n - 1] takes a version-n document to version n + 1. Empty until
// the format first changes; parseDoc runs whatever is here, in order.
export const MIGRATIONS = [];

const RAIL_DEPTH = 740;        // mm between front and rear rails: a common 4-post
const USABLE_BEYOND = 260;     // mm a four-post allows past its rear rail by default
const TWO_POST_USABLE = 1000;  // mm a two-post allows, front rail to the deepest point

const token = () => Math.random().toString(36).slice(2, 10);

export function normalizeFrame(f = {}) {
  const four = f.kind !== 'two-post';
  const railDepth = four ? (Number(f.railDepth) > 0 ? Number(f.railDepth) : RAIL_DEPTH) : null;
  const style = f.holes?.style === 'tapped' ? 'tapped' : 'square';
  const height = Math.round(Number(f.heightRU));
  return {
    kind: four ? 'four-post' : 'two-post',
    heightRU: height >= 1 ? height : 42,
    numbering: f.numbering === 'top-down' ? 'top-down' : 'bottom-up',
    holes: {style, thread: style === 'tapped' && THREADS.includes(f.holes?.thread) ? f.holes.thread : null},
    railDepth,
    usableDepth: Number(f.usableDepth) > 0 ? Number(f.usableDepth)
      : four ? railDepth + USABLE_BEYOND : TWO_POST_USABLE,
    ref: f.ref ?? null,
  };
}

export const defaultFrame = (kind = 'four-post') => normalizeFrame({kind});

export const newRack = ({name = 'Rack 1', kind = 'four-post'} = {}) =>
  ({id: 'r1', name, frame: defaultFrame(kind), items: [], zeroU: [], cables: []});

export const newDoc = ({name = 'Rack 1', kind = 'four-post'} = {}) =>
  ({format: FORMAT, version: VERSION, id: `doc-${token()}`, racks: [newRack({name, kind})]});

// The next id after the highest one ever used in `list`, so a removed item's
// id is never handed to another - a cable (Phase 2) naming it must not start
// naming something else.
export function nextId(list, prefix) {
  const used = list.filter(x => String(x.id).startsWith(prefix))
    .map(x => Number(String(x.id).slice(prefix.length))).filter(Number.isInteger);
  return `${prefix}${Math.max(0, ...used) + 1}`;
}

// "Rack N" for a new rack: one past the highest N in use, so names never
// repeat - with or without a library to count.
export function nextRackName(names) {
  const used = names.map(n => /^Rack (\d+)$/.exec(String(n))?.[1]).filter(Boolean).map(Number);
  return `Rack ${Math.max(0, ...used) + 1}`;
}

export function withItem(rack, {ref, cfg, ru, face = 'front', turned = false, label = ref,
                                swaps = {}, fields = {}}) {
  const item = {id: nextId(rack.items, 'i'), ref, cfg, label, ru,
                face: face === 'rear' ? 'rear' : 'front', turned: !!turned,
                swaps: {...swaps}, fields: structuredClone(fields)};
  return {rack: {...rack, items: [...rack.items, item]}, item};
}

export const updateItem = (rack, id, patch) =>
  ({...rack, items: rack.items.map(i => (i.id === id ? {...i, ...patch} : i))});
export const withoutItem = (rack, id) => ({...rack, items: rack.items.filter(i => i.id !== id)});
export const withFrame = (rack, patch) => ({...rack, frame: normalizeFrame({...rack.frame, ...patch})});
export const renamed = (rack, name) => ({...rack, name: String(name)});

// U numbers are stored bottom-up always; this is only what a label says.
export const uLabel = (frame, u) => (frame.numbering === 'top-down' ? frame.heightRU - u + 1 : u);

function readItem(i, n) {
  if (!i || typeof i.ref !== 'string' || !i.ref || !Number.isInteger(i.ru))
    throw new Error(`Item ${n} has no device or no U.`);
  return {id: String(i.id ?? `i${n}`), ref: i.ref, cfg: String(i.cfg ?? ''), label: String(i.label ?? i.ref),
          ru: i.ru, face: i.face === 'rear' ? 'rear' : 'front', turned: !!i.turned,
          swaps: {...(i.swaps || {})}, fields: structuredClone(i.fields || {})};
}

// Every item needs an id unique within its rack: a missing one (an older
// writer, or a hand-edited file) and a duplicate (two items sharing an id,
// which the `i${n}` fallback could itself produce) are the same problem -
// assign a fresh one from what has been kept so far.
function readItems(list) {
  const items = [];
  const seen = new Set();
  list.forEach((i, n) => {
    const it = readItem(i, n + 1);
    if (!it.id || seen.has(it.id)) it.id = nextId(items, 'i');
    seen.add(it.id);
    items.push(it);
  });
  return items;
}

// CABLES ARE NEVER DROPPED ON LOAD (spec §9.3: a cable is never silently
// deleted). A cable that names a missing item, an unknown media or no port at
// all is kept and shown as a loose end; what is normalized is only its shape:
// a unique id, two ends, strings where the page reads strings, a length that
// is a positive number, and a route array. Fields this page does not know are
// kept as they are.
const readEnd = e => ({item: String(e?.item ?? ''), path: String(e?.path ?? ''),
                       view: e?.view === 'rear' ? 'rear' : 'front'});
export function readCables(list) {
  const declared = list.map(c => ({id: String(c?.id ?? '')}));
  const out = [];
  const seen = new Set();
  for (const raw of list) {
    const {length: len, ...c} = raw && typeof raw === 'object' ? structuredClone(raw) : {};
    let id = c.id == null ? '' : String(c.id);
    if (!id || seen.has(id)) id = nextId([...declared, ...out], 'c');
    seen.add(id);
    const length = len && Number(len.value) > 0
      ? {...len, value: Number(len.value), unit: len.unit === 'ft' ? 'ft' : 'm', source: String(len.source ?? 'entered')}
      : null;
    out.push({...c, id, a: readEnd(c.a), b: readEnd(c.b), media: String(c.media ?? ''),
              purpose: String(c.purpose ?? ''), label: String(c.label ?? ''),
              ...(length ? {length} : {}), route: Array.isArray(c.route) ? c.route : []});
  }
  return out;
}

// READ A FILE, OR REFUSE IT WITH A SENTENCE. A newer file than this page knows
// is refused whole: reading the parts it understands and dropping the rest
// would hand back a rack that looks complete and is not.
export function parseDoc(input) {
  let d = typeof input === 'string' ? JSON.parse(input) : input;
  if (!d || d.format !== FORMAT) throw new Error('This is not a Portrayal rack file.');
  if (!Number.isInteger(d.version) || d.version < 1) throw new Error('This rack file has no valid version.');
  if (d.version > VERSION)
    throw new Error(`This rack file is version ${d.version}; this page reads up to version ${VERSION}. Reload to get the newer page.`);
  for (let v = d.version; v < VERSION; v++) d = MIGRATIONS[v - 1](d);
  if (!Array.isArray(d.racks) || !d.racks.length) throw new Error('This rack file holds no rack.');
  return {
    format: FORMAT, version: VERSION,
    id: typeof d.id === 'string' && d.id ? d.id : `doc-${token()}`,
    racks: d.racks.map((r, k) => ({
      id: String(r.id ?? `r${k + 1}`), name: String(r.name ?? 'Rack'),
      frame: normalizeFrame(r.frame),
      items: readItems(r.items || []),
      zeroU: Array.isArray(r.zeroU) ? structuredClone(r.zeroU) : [],
      cables: readCables(Array.isArray(r.cables) ? r.cables : []),
    })),
  };
}

export const serialize = doc => JSON.stringify(doc, null, 2);
