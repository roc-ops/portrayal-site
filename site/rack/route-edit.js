// site/rack/route-edit.js
// CANCEL IN THE ROUTE EDITOR. The editor applies each pick (and each move,
// removal and reset) at once, as one Undo step (spec §6; rack-page.js
// editRoute), so Cancel does not hold anything back: it takes back every route
// edit made since the edit opened. It does that with the editor's own Undo, so
// the route is what it was and Cancel adds no step of its own (the undone
// steps wait in Redo). A session counts the steps; Undo and Redo pressed
// meanwhile are told to it, and it stops once the cable is as it began.

const sameRoute = (a, b) => !!a && !!b && a.edited === b.edited && JSON.stringify(a.route) === JSON.stringify(b.route);

/** The session of one cable's route edit, opened when its form is. `ed` is
 *  the kit's editor (rack(), undo(), canUndo). */
export function routeEditSession(ed, cableId) {
  const read = () => {
    const c = ed.rack().cables.find(x => x.id === cableId);
    return c ? {edited: !!c.routeEdited, route: c.route ?? null} : null;
  };
  const began = read();
  let steps = 0;
  return {
    cableId,
    /** An edit's answer from the editor: a route edit that landed is a step. */
    noteEdit(res) { if (res && !res.error && !res.noop && res.step) steps++; },
    noteUndo() { steps = Math.max(0, steps - 1); },
    noteRedo() { steps++; },
    get steps() { return steps; },
    /** Take back what was done since the edit opened; how many steps that was. */
    cancel() {
      let undone = 0;
      while (steps > 0 && ed.canUndo && !sameRoute(read(), began)) {
        if (!ed.undo()) break;
        steps--; undone++;
      }
      steps = 0;
      return undone;
    },
  };
}
