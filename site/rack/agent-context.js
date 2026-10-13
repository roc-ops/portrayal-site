// site/rack/agent-context.js
// THE KIT'S PER-CALL CONTEXT for an agent's call (spec 2026-10-08 D5): the
// parts lists of everything in the rack and of `refs` (a batch's new devices,
// a catalog device inspected), the cabled ends' facts, and, with `route`, the
// routing context, whose guidesOf is each device's configured face (ruling
// K8), with the cable types (route-context.js withCableTypes).
//
// THE CABLE TYPES (portrayal-site#164): a bundle's size check reads each
// member's diameter and its bend check each member's installed bend radius.
// This context once carried the diameters only, so every bundle an agent made
// or read was "not checked: the cable types are not loaded". It is built here,
// with no DOM and no fetch of its own, so a test can build it as the page does.
//
// Handed: loadSlots(refs) => {slotsOf, compByRef}; routeFacts(rack) =>
// route-context.js routeFacts' answer; cableTypes() => loadCableTypes' answer
// or null. Each of the last two may fail; the call is still answered.

import {withCableTypes} from './route-context.js';

// `drawnAt(end)` is the page's (cable-plugs.js): the ref of the part drawn at an
// end, which the kit needs before it will word a power cord (kit 0.30.0).
export function agentContextFor({loadSlots, chassisOf, cableFacts, routeFacts, cableTypes, drawnAt}) {
  return async (r, refs = [], {route = false} = {}) => {
    // (the parts beside the rack too: a PDU's outlet states and readings, and what hangs on a bracket,
    // are checked against its parts list: kit 0.22.0 state.set, readings.set, zerou.hang)
    const {slotsOf, compByRef} = await loadSlots([...new Set([...r.items.map(i => i.ref), ...(Array.isArray(r.zeroU) ? r.zeroU : []).map(z => z?.ref).filter(Boolean), ...refs])]);
    const ctx = {chassisOf, slotsOf, compByRef, cableFacts, ...(drawnAt ? {drawnAt} : {})};
    if (!route) return ctx;
    const [rf, types] = await Promise.all([
      Promise.resolve().then(() => routeFacts(r)).catch(err => { console.warn('[portrayal] routes', err); return null; }),
      Promise.resolve().then(() => cableTypes()).catch(() => null)]);
    const withTypes = withCableTypes(ctx, types ?? rf?.types ?? null);
    return rf ? {...withTypes, route: rf.ctx, guidesOf: rf.ctx.guidesOf} : withTypes;
  };
}
