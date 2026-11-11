// The parts taken off a device, as ONE QUERY PARAMETER of the Explorer's link.
//
//     pulled=bezel@front,lid@top
//
// The kit's `pulled` event carries `{paths, views?}` and shell.setPulled takes
// the same pair, so this is that pair as a string and back. A path is a part's
// `data-path`; the view is the face it is off on, written only on a device with
// more than one (`pulledViews()` answers null for each on a device with one),
// because the same path can be a different part on each face - the left
// bracket's screws are not the right bracket's.
//
// encodeFields's rules: every token is encodeURIComponent'd, so `,` between
// entries and `@` between a path and its view cannot appear inside one; entries
// are sorted and a repeat is dropped, so one state is one string.

const tok = s => encodeURIComponent(s);
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** `paths` beside `views` (null, or a null for each, where a device has one view). */
export function encodePulled(paths, views) {
  const seen = new Set();
  const out = [];
  (paths || []).forEach((p, i) => {
    if (typeof p !== 'string' || !p) return;
    const v = views?.[i];
    const entry = v ? `${tok(p)}@${tok(v)}` : tok(p);
    if (!seen.has(entry)) { seen.add(entry); out.push(entry); }
  });
  return out.sort(cmp).join(',');
}

/** NEVER THROWS, and one bad entry does not take the rest with it - a link is
 *  typed, pasted and truncated by people, and the worst a `pulled=` may do is be
 *  ignored. Answers `{paths, views}` in the shape setPulled takes, a view null
 *  where the entry names none. */
export function decodePulled(s) {
  const out = {paths: [], views: []};
  if (typeof s !== 'string' || !s) return out;
  for (const part of s.split(',')) {
    const at = part.indexOf('@');
    if (at === 0 || part.indexOf('@', at + 1) >= 0 && at >= 0) continue;
    try {
      const path = decodeURIComponent(at < 0 ? part : part.slice(0, at));
      const view = at < 0 ? null : decodeURIComponent(part.slice(at + 1));
      if (!path || view === '') continue;
      out.paths.push(path);
      out.views.push(view);
    } catch (e) { /* a broken escape: this entry only */ }
  }
  return out;
}
