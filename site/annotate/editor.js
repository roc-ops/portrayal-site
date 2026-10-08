// site/annotate/editor.js
// THE HEADLESS ANNOTATE EDITOR (spec §2.2): the marks document, its history and
// the one way in for edits, shaped like the rack editor so one adapter pattern
// drives both. The page draws what it is told by `change`.

import {apply as applyCommands} from './commands.js';
import {normalise} from '../../vendor/marks.js';
import {createHistory} from '../../vendor/rack/history.js';
import {same} from '../../vendor/rack/validate.js';

// THE SHELL OWNS THE TARGET. Which device, configuration and view, and what is
// seated and written on it, change only by the shell loading something - so an
// undo restores the marks, the crop and the legend and keeps the target as it
// is now. Restoring a device the shell is not showing would be a document that
// lies about its own drawing.
const TARGET = ['device', 'config', 'view', 'swaps', 'fields'];
// A CROP IS MILLIMETRES OF ONE DRAWING. A step taken on another device,
// configuration or view brings back a rectangle cut for that drawing, so across
// a change of drawing the crop stays as the shell last re-cut it.
const DRAWING = ['device', 'config', 'view'];
const keepTarget = (doc, from) => ({
  ...doc, ...Object.fromEntries(TARGET.map(k => [k, from[k]])),
  ...(DRAWING.every(k => doc[k] === from[k]) ? {} : {crop: from.crop}),
});

// THE DOCUMENTS ARE FROZEN. getDoc(), the change events and the history all
// hand out the same objects, so a caller that edited one in place would rewrite
// a step behind the editor's back. Copied first: the shell's swaps and fields
// arrive as its own objects, which are not this module's to freeze.
const deepFreeze = v => {
  if (v && typeof v === 'object' && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const k of Object.keys(v)) deepFreeze(v[k]);
  }
  return v;
};
const seal = doc => deepFreeze(structuredClone(doc));

export function createMarksEditor({doc = {}, cap = 100} = {}) {
  const history = createHistory({cap});
  const listeners = new Set();
  let current = seal(normalise(doc));
  let lastMerge = null;
  const list = cmds => (Array.isArray(cmds) ? cmds : [cmds]);
  const emit = ev => {
    for (const fn of [...listeners]) {
      try { fn(ev); } catch (err) { console.error('[portrayal] an annotate change listener failed', err); }
    }
  };

  function apply(cmds, {origin = 'ui', merge = null} = {}) {
    const commands = list(cmds), before = current;
    const res = applyCommands(before, commands);
    if (res.error || res.noop) return res;
    current = seal(res.doc);
    // A TYPING BURST IS ONE STEP: the same merge key as the newest step, with
    // nothing in between, replaces that step rather than adding one.
    if (merge != null && merge === lastMerge && history.canUndo) {
      const old = history.undo();
      history.record(old.before, current, res.summary, origin);
    } else history.record(before, current, res.summary, origin);
    lastMerge = merge;
    emit({cause: 'apply', origin, step: true, commands, summary: res.summary, findings: res.findings, before, after: current});
    return {...res, doc: current};
  }

  function travel(cause) {
    const s = cause === 'undo' ? history.undo() : history.redo();
    if (!s) return null;
    lastMerge = null;
    const before = current;
    current = seal(keepTarget(cause === 'undo' ? s.before : s.after, before));
    emit({cause, origin: s.origin, step: true, commands: [], summary: s.summary, findings: [], before, after: current});
    return {summary: s.summary};
  }

  return {
    getDoc: () => current,
    loadDoc(next) {
      const before = current;
      current = seal(normalise(next));
      history.clear();
      lastMerge = null;
      emit({cause: 'load', origin: 'ui', step: false, commands: [], summary: '', findings: [], before, after: current});
      return {findings: []};
    },
    apply,
    preview(cmds) {
      const res = applyCommands(current, list(cmds));
      return res.error || res.noop ? res : {...res, doc: seal(res.doc)};
    },
    undo: () => travel('undo'),
    redo: () => travel('redo'),
    // The shell moved, seated or wrote something, or a new drawing re-cut the
    // crop: not an edit, so not a step.
    retarget(patch) {
      const allowed = Object.fromEntries(Object.entries(patch).filter(([k]) => TARGET.includes(k) || k === 'crop'));
      const next = {...current, ...allowed};
      if (same(next, current)) return;
      const before = current;
      current = seal(next);
      emit({cause: 'target', origin: 'ui', step: false, commands: [], summary: '', findings: [], before, after: current});
    },
    get canUndo() { return history.canUndo; },
    get canRedo() { return history.canRedo; },
    get undoSummary() { return history.undoSummary; },
    get redoSummary() { return history.redoSummary; },
    on(type, fn) {
      if (type !== 'change') throw new Error(`There is no event called ${type}.`);
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
