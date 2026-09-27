// A small highlighter for the kit page's recipes: comments, strings, template
// strings, numbers and keywords, nothing else. Local and dependency-free on
// purpose - the page shows plain ES modules, and the coloring only has to help
// the eye, not parse JavaScript.
const KEYWORDS = new Set(('async await break case catch class const continue default do else export ' +
  'false finally for from function if import in instanceof let new null of return switch this throw ' +
  'true try typeof undefined var while').split(' '));

const esc = s => s.replace(/[&<>]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;'})[c]);

export function highlight(text) {
  const re = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|('(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`)|\b(\d+(?:\.\d+)?)\b|\b([A-Za-z_$][\w$]*)\b/g;
  let out = '', last = 0, m;
  while ((m = re.exec(text))) {
    out += esc(text.slice(last, m.index));
    const [tok, com, str, num, word] = m;
    if (com) out += `<span class="tk-c">${esc(tok)}</span>`;
    else if (str) out += `<span class="tk-s">${esc(tok)}</span>`;
    else if (num) out += `<span class="tk-n">${esc(tok)}</span>`;
    else if (KEYWORDS.has(word)) out += `<span class="tk-k">${esc(tok)}</span>`;
    else out += esc(tok);
    last = re.lastIndex;
  }
  return out + esc(text.slice(last));
}
