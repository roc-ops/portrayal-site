// portrayal.dev's one Worker: Markdown for agents.
//
// The site is static files (wrangler.jsonc, public/ built by
// tools/build-public.py). This Worker runs only on the page URLs that
// wrangler.jsonc's assets.run_worker_first names - never on scripts, drawings
// or schemas, which stay plain static assets - and does two things there:
//
//   - A request whose Accept header prefers text/markdown gets the page's
//     Markdown copy (/explorer -> /explorer.md, built beside the page by
//     tools/page_markdown.py) as text/markdown. Cloudflare's own Markdown for
//     Agents does this at the edge but needs a Pro plan.
//   - Every other request gets the page as before, plus a Link header naming
//     the Markdown copy (RFC 8288 rel="alternate"), and on the front page the
//     sitemap. Vary: Accept on both, so no cache hands one to the other.
//
// Anything unexpected - no copy for this path, a non-200, a throw anywhere
// (the Accept header is a stranger's) - falls through to the static asset, so
// the worst this can do is behave like no Worker at all.

const MD = "text/markdown";

/**
 * The Markdown copy's path for a page path, or null: "/" -> "/index.md",
 * "/kit" -> "/kit.md", "/components/catalog" -> "/components/catalog.md".
 */
export function markdownPath(pathname) {
  if (pathname === "/" || pathname === "/index.html") return "/index.md";
  const m = /^\/([a-z0-9-]+(?:\/[a-z0-9-]+)*)(?:\.html)?$/.exec(pathname);
  return m ? `/${m[1]}.md` : null;
}

/** The q-value an Accept header gives `type`, from its exact media range only. */
function quality(accept, type) {
  for (const range of accept.split(",")) {
    const [name, ...params] = range.split(";").map((s) => s.trim().toLowerCase());
    if (name !== type) continue;
    const q = params.find((p) => p.startsWith("q="));
    const v = q ? Number(q.slice(2)) : 1;
    return Number.isFinite(v) ? v : 0;
  }
  return 0;
}

/** True when Accept asks for text/markdown at least as much as for text/html. */
export function wantsMarkdown(accept) {
  if (!accept) return false;
  const md = quality(accept, MD);
  return md > 0 && md >= quality(accept, "text/html");
}

function withVary(headers) {
  const vary = headers.get("Vary");
  if (!vary || !/(^|,)\s*accept\s*(,|$)/i.test(vary)) headers.set("Vary", vary ? `${vary}, Accept` : "Accept");
}

export default {
  async fetch(request, env) {
    try {
      return await negotiate(request, env);
    } catch {
      return env.ASSETS.fetch(request);
    }
  },
};

async function negotiate(request, env) {
  const url = new URL(request.url);
  const md = markdownPath(url.pathname);
  const read = request.method === "GET" || request.method === "HEAD";

  if (md && read && wantsMarkdown(request.headers.get("Accept"))) {
    const copy = await env.ASSETS.fetch(new Request(new URL(md, url), { method: "GET" }));
    if (copy.status === 200) {
      const body = await copy.text();
      const headers = new Headers(copy.headers);
      headers.set("Content-Type", `${MD}; charset=utf-8`);
      // An estimate, as Cloudflare's own is: about four characters a token.
      headers.set("x-markdown-tokens", String(Math.ceil(body.length / 4)));
      headers.delete("Content-Length");
      headers.delete("ETag");
      withVary(headers);
      return new Response(request.method === "HEAD" ? null : body, { status: 200, headers });
    }
  }

  const page = await env.ASSETS.fetch(request);
  if (!md || page.status !== 200) return page;
  const headers = new Headers(page.headers);
  headers.append("Link", `<${md}>; rel="alternate"; type="${MD}"`);
  if (md === "/index.md") headers.append("Link", `</sitemap.xml>; rel="sitemap"; type="application/xml"`);
  withVary(headers);
  return new Response(page.body, { status: page.status, statusText: page.statusText, headers });
}
