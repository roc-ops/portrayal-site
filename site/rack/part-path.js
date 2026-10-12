// site/rack/part-path.js
// HOW A PART OF A DRAWING IS ADDRESSED. A part carries its path as
// `data-path` ("port-1", "bay-1/module/lc01"). THE BACK OF A MODULE SEATED IN
// A BAY is drawn on the device's rear face as a projection, and its parts
// carry the same kind of path as `data-of` ("bay-1/module/b01") and no
// `data-path`: their ids there are the drawing's own ("bay-1-rear--b01").
//
// The path is the address, on either face: a cable's end on the back of a
// seated adapter panel is {path: "bay-1/module/b01", view: "rear"}. A drawing
// id is never one. Every lookup of a part by its path, and every reading of a
// part's path, goes through here, so a projected part is found as any other
// is. (The kit's zones.js gives a projected port its id as `path` on kit
// 0.22.0; that is put right upstream in Portrayal #1019, and face.js corrects
// it here until that kit is vendored.)

/** The selector for the part at `path`, as its own drawing or as a projection. */
export const partSel = (path, more = '') =>
  `[data-path="${CSS.escape(path)}"]${more}, [data-of="${CSS.escape(path)}"]${more}`;
/** A part's path: its `data-path`, else the path it projects (`data-of`), else null. */
export const pathOfEl = el => el?.getAttribute?.('data-path') ?? el?.getAttribute?.('data-of') ?? null;
/** Whether a string is a projection's drawing id ("bay-1-rear--b01"), which is not a path. */
export const isProjectionId = s => typeof s === 'string' && /-rear--/.test(s) && !s.includes('/');
/** A projection id as the path it stands for, read off a parsed face: null when the face has no such part. */
export function pathOfProjectionId(root, id) {
  const el = isProjectionId(id) ? root?.querySelector?.(`[id="${CSS.escape(id)}"][data-of]`) : null;
  return el ? el.getAttribute('data-of') : null;
}

/** WHY A BATCH OF COMMANDS IS REFUSED FOR AN END GIVEN A DRAWING ID, or null.
 *  A cable's end names a port by its path. The id a projection's part has in
 *  the drawing ("bay-1-rear--b01") is refused before the kit is asked, with
 *  the form to use: the kit reads no drawing, so it would keep the id as a
 *  path and the cable would never land. */
export function projectionIdRefusal(cmds) {
  for (const c of Array.isArray(cmds) ? cmds : [cmds])
    for (const end of [c?.a, c?.b, c?.select])
      if (end && isProjectionId(end.path)) {
        const [bay, part] = end.path.split('-rear--');
        return `${end.path} is a drawing id, not a port. A port on the back of a seated module is addressed by its path with view rear: {path: "${bay}/module/${part.replace(/--/g, '/')}", view: "rear"}.`;
      }
  return null;
}
