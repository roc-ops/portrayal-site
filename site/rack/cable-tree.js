// THE CABLE LIST AS A TREE (portrayal-site#190). With 48 cords in four
// bundles the list was one long column. Each bundle is a row that opens and
// closes over its members, and the cables in no bundle are a group of their
// own. cable-panel.js builds the rows; this module is what makes them a tree:
//
//   - WHAT IS OPEN. A bundle the reader opened or closed stays so, per rack
//     document, in this browser (localStorage, never the rack file). One they
//     never touched starts open in a small rack and closed in one with more
//     than MANY cables.
//   - THE KEYBOARD, as a tree has it: one Tab stop for the whole list (roving
//     focus), Up and Down between the rows that show, Right opens a closed row
//     or steps into an open one, Left closes an open row or steps out to its
//     parent, Home and End, and Enter or Space do what a click on the row
//     does. The disclosure mark is the pointer's; it is not a second stop.
//   - A PEEK. A cable under the pointer on the stage opens the row it is
//     under and its row is scrolled into view. The row stays open when the
//     pointer leaves (the reader may be on the way to it), until a cable
//     under another closed row is hovered: one peek at a time. A peek is not
//     remembered; a row the reader opens or pins a cable in is.
//
// The first two parts are pure (tests/rack/cable-tree.test.mjs); the rest
// needs a document.

export const TREE_KEY = 'portrayal.rack.tree';
// More cables than this, and rows nobody has touched start closed.
export const MANY = 20;
// The id of the group that holds the cables in no bundle.
export const LOOSE = '~none';
// How many racks' rows are remembered: the most recently touched.
const KEEP = 40;

export const startsOpen = cables => cables <= MANY;
/** Is row `id` open: what the reader last set, else the start for a rack of `cables` cables. */
export const isOpen = (state, id, cables) => (typeof state?.[id] === 'boolean' ? state[id] : startsOpen(cables));

const readAll = store => {
  try {
    const all = JSON.parse(store.getItem(TREE_KEY) || '[]');
    return Array.isArray(all) ? all.filter(e => Array.isArray(e) && typeof e[0] === 'string' && e[1] && typeof e[1] === 'object') : [];
  } catch { return []; }
};
/** What the reader set for rack document `docId`: {row id: true | false}. */
export function loadTree(docId, store = globalThis.localStorage) {
  const hit = readAll(store).find(([id]) => id === docId);
  return hit ? Object.fromEntries(Object.entries(hit[1]).filter(([, v]) => typeof v === 'boolean')) : {};
}
/** Remember `state` for `docId`, most recent first, the oldest racks dropped. Never throws. */
export function saveTree(docId, state, store = globalThis.localStorage) {
  try {
    const rest = readAll(store).filter(([id]) => id !== docId);
    store.setItem(TREE_KEY, JSON.stringify([[docId, state], ...rest].slice(0, KEEP)));
  } catch { /* forgets */ }
}
/** WHAT A KEY DOES, on the rows as they are. `rows` are every row in order:
 *  {id, parent (a row's id, or null), open (true | false for a row that opens,
 *  null for a leaf), hidden (left out by the filter)}. `at` is the focused
 *  row's id. Answers {focus: id}, {toggle: id, open}, {act: id} or null. */
export function keyStep(rows, at, key) {
  const byId = new Map(rows.map(r => [r.id, r]));
  const shows = r => !r.hidden && (r.parent == null || (byId.get(r.parent)?.open === true && !byId.get(r.parent).hidden));
  const seen = rows.filter(shows), k = seen.findIndex(r => r.id === at), cur = seen[k];
  if (!cur) return seen.length && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(key) ? {focus: seen[0].id} : null;
  if (key === 'ArrowDown') return k + 1 < seen.length ? {focus: seen[k + 1].id} : null;
  if (key === 'ArrowUp') return k > 0 ? {focus: seen[k - 1].id} : null;
  if (key === 'Home') return {focus: seen[0].id};
  if (key === 'End') return {focus: seen.at(-1).id};
  if (key === 'ArrowRight') {
    if (cur.open === false) return {toggle: cur.id, open: true};
    const child = cur.open ? seen.find(r => r.parent === cur.id) : null;
    return child ? {focus: child.id} : null;
  }
  if (key === 'ArrowLeft') {
    if (cur.open === true) return {toggle: cur.id, open: false};
    return cur.parent != null ? {focus: cur.parent} : null;
  }
  if (key === 'Enter' || key === ' ') return {act: cur.id};
  return null;
}

// ── on the page ──────────────────────────────────────────────────────────
const ITEM = '[role="treeitem"]';
const rowsOf = tree => [...tree.querySelectorAll(ITEM)].map(li => ({
  id: li.id, parent: li.parentElement.closest(ITEM)?.id ?? null, hidden: li.hidden,
  open: li.hasAttribute('aria-expanded') ? li.getAttribute('aria-expanded') === 'true' : null}));
const groupOf = li => li.querySelector(':scope > [role="group"]');

/** Open or close a row in place: nothing is rebuilt. */
export function setOpen(li, open) {
  if (!li?.hasAttribute('aria-expanded')) return;
  li.setAttribute('aria-expanded', String(open));
  const g = groupOf(li);
  if (g) g.hidden = !open;
}
/** One Tab stop: `li` is it, and no other row of its tree is. */
export function setStop(tree, li) {
  for (const n of tree.querySelectorAll(ITEM)) n.tabIndex = n === li ? 0 : -1;
}

/** Make `tree` (the list's ul) a tree: the keyboard, the disclosure marks and
 *  the one Tab stop. `onToggle(key, open)` is told what the reader opened or
 *  closed (`key`: the row's data-tree-key); `onStop(id)` which row holds the
 *  Tab stop, so a rebuilt list can give it back; `stop` is that id from before. */
export function wireTree(tree, {onToggle = () => {}, onStop = () => {}, stop = null} = {}) {
  const items = [...tree.querySelectorAll(ITEM)];
  const first = (stop && items.find(li => li.id === stop && !li.hidden && !li.closest('[hidden]')))
    || items.find(li => li.getAttribute('aria-selected') === 'true' && !li.closest('[hidden]'))
    || items.find(li => !li.hidden);
  setStop(tree, first ?? null);
  const toggle = (li, open) => {
    // closing a row over the focused one keeps the keyboard: it goes to the row that closed
    const inside = li.contains(document.activeElement) && document.activeElement !== li;
    setOpen(li, open);
    li.removeAttribute('data-peek');
    if (!open && inside) { setStop(tree, li); li.focus(); onStop(li.id); }
    onToggle(li.dataset.treeKey, open);
  };
  tree.addEventListener('click', ev => {
    const mark = ev.target.closest?.('[data-tree-toggle]');
    if (!mark || !tree.contains(mark)) return;
    const li = mark.closest(ITEM);
    toggle(li, li.getAttribute('aria-expanded') !== 'true');
  });
  // whichever row takes focus (a click on its button, Tab, the page handing focus back) is the stop
  tree.addEventListener('focusin', ev => {
    const li = ev.target.closest?.(ITEM);
    if (li && tree.contains(li) && li.tabIndex !== 0) { setStop(tree, li); onStop(li.id); }
  });
  tree.addEventListener('keydown', ev => {
    if (ev.altKey || ev.ctrlKey || ev.metaKey) return;
    const li = ev.target.closest?.(ITEM);
    if (!li || !tree.contains(li)) return;
    // a key on a row or on its own name; a row's other controls (Edit, Delete) keep theirs
    const own = ev.target === li || ev.target.matches('[data-cable-row], [data-bundle-row]');
    if (!own) return;
    // Enter and Space on the row's own button are the button's
    if ((ev.key === 'Enter' || ev.key === ' ') && ev.target !== li) return;
    const step = keyStep(rowsOf(tree), li.id, ev.key);
    if (!step) return;
    ev.preventDefault();
    if (step.focus) {
      const to = tree.querySelector(`#${CSS.escape(step.focus)}`);
      if (to) { setStop(tree, to); to.focus(); onStop(to.id); }
    } else if (step.toggle) toggle(li, step.open);
    else if (step.act) {
      const b = li.querySelector(':scope > [data-cable-row], :scope > [data-bundle-row]');
      if (b) b.click(); else toggle(li, li.getAttribute('aria-expanded') !== 'true');
    }
  });
}

/** A PEEK: the row over cable `cableId` is opened, if it was closed, and the
 *  cable's own row scrolled into view; a row an earlier peek opened closes
 *  again unless this cable is under it. `root` is the side panel. Returns the
 *  data-tree-key of the row now held open by a peek, or null for none. */
export function peek(root, cableId) {
  const row = cableId == null ? null : root?.querySelector(`[data-cable-item="${CSS.escape(cableId)}"]`);
  if (!row) return root?.querySelector('[data-peek]')?.dataset.treeKey ?? null;
  const over = row.parentElement.closest(ITEM);
  for (const li of root.querySelectorAll('[data-peek]')) if (li !== over) { li.removeAttribute('data-peek'); setOpen(li, false); }
  if (over && over.getAttribute('aria-expanded') === 'false') { over.setAttribute('data-peek', ''); setOpen(over, true); }
  if (!row.hidden) row.scrollIntoView({block: 'nearest'});
  return over?.hasAttribute('data-peek') ? over.dataset.treeKey : null;
}
