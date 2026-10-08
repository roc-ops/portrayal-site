// site/annotate/editor.js
// THE HEADLESS ANNOTATE EDITOR (spec §2.2): the marks document, its history and
// the one way in for edits, shaped like the rack editor so one adapter pattern
// drives both. The page draws what it is told by `change`.

import {apply as applyCommands} from './commands.js';
import {normalise} from '../../vendor/marks.js';
import {createHistory} from '../rack/history.js';
import {same} from '../rack/validate.js';

// THE SHELL OWNS THE TARGET. Which device, configuration and view, and what is
// seated and written on it, change only by the shell loading something - so an
// undo restores the marks, the crop and the legend and keeps the target as it
// is now. Restoring a device the shell is not showing would be a document that
// lies about its own drawing.
const TARGET = ['device', 'config', 'view', 'swaps', 'fields'];
const keepTarget = (doc, from) => ({...doc, ...Object.fromEntries(TARGET.map(k => [k, from[k]]))});

export function createMarksEditor({doc = {}, cap = 100} = {}) {
  const history = createHistory({cap});
  const listeners = new Set();
  let current = normalise(doc);
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
    current = res.doc;
    // A TYPING BURST IS ONE STEP: the same merge key as the newest step, with
    // nothing in between, replaces that step rather than adding one.
    if (merge != null && merge === lastMerge && history.canUndo) {
      const old = history.undo();
      history.record(old.before, current, res.summary, origin);
    } else history.record(before, current, res.summary, origin);
    lastMerge = merge;
    emit({cause: 'apply', origin, step: true, commands, summary: res.summary, findings: res.findings, before, after: current});
    return res;
  }

  function travel(cause) {
    const s = cause === 'undo' ? history.undo() : history.redo();
    if (!s) return null;
    lastMerge = null;
    const before = current;
    current = keepTarget(cause === 'undo' ? s.before : s.after, before);
    emit({cause, origin: s.origin, step: true, commands: [], summary: s.summary, findings: [], before, after: current});
    return {summary: s.summary};
  }

  return {
    getDoc: () => current,
    loadDoc(next) {
      const before = current;
      current = normalise(next);
      history.clear();
      lastMerge = null;
      emit({cause: 'load', origin: 'ui', step: false, commands: [], summary: '', findings: [], before, after: current});
      return {findings: []};
    },
    apply,
    preview: cmds => applyCommands(current, list(cmds)),
    undo: () => travel('undo'),
    redo: () => travel('redo'),
    // The shell moved, seated or wrote something, or a new drawing re-cut the
    // crop: not an edit, so not a step.
    retarget(patch) {
      const allowed = Object.fromEntries(Object.entries(patch).filter(([k]) => TARGET.includes(k) || k === 'crop'));
      const next = {...current, ...allowed};
      if (same(next, current)) return;
      const before = current;
      current = next;
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
