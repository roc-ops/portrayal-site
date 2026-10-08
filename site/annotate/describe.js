// site/annotate/describe.js
// A SHORT READING OF THE DOCUMENT for an agent: the target, the settings, and
// every mark with what it matched the last time the drawing was drawn - which
// is how an agent learns that a selector it wrote reaches nothing. About 1.5K
// characters at most (WebMCP's guidance for tool output); a long document loses
// its labels first, then its tail, and says so.

const LIMIT = 1500;

export function describe(doc, report = []) {
  const target = [doc.device || 'No device', doc.config && `config ${doc.config}`, doc.view].filter(Boolean).join(', ');
  const crop = doc.crop ? `cropped to ${doc.crop.w} x ${doc.crop.h} mm` : 'not cropped';
  const head = `${target}. Legend ${doc.legend ? 'on' : 'off'}; ${crop}.`;
  const matched = i => {
    const r = report.find(x => x.index === i);
    if (!r) return 'not drawn yet';
    if (r.error) return `refused: ${r.error}`;
    return r.count ? `${r.count} part${r.count === 1 ? '' : 's'}` : 'matches nothing';
  };
  const line = (m, i, short) => {
    const bits = [m.color && `color ${m.color}`, m.state && `state ${m.state}`, !short && m.label && `label "${m.label}"`,
                  m.lamp && `lamp ${m.lamp}`].filter(Boolean);
    return `${m.id || `#${i}`} ${m.select}${bits.length ? `, ${bits.join(', ')}` : ''}: ${matched(i)}`;
  };
  const build = (short, n) => {
    const lines = [head, doc.marks.length ? 'Marks:' : 'No marks.', ...doc.marks.slice(0, n).map((m, i) => line(m, i, short))];
    const more = doc.marks.length - n;
    if (short) lines.push(more ? `Shortened: labels left out, and ${more} more not listed; ask by id or row.` : 'Shortened: labels left out.');
    return lines.join('\n');
  };
  let out = build(false, doc.marks.length);
  if (out.length <= LIMIT) return out;
  let n = doc.marks.length;
  out = build(true, n);
  while (out.length > LIMIT && n) out = build(true, --n);
  return out;
}
