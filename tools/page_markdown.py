"""A page's Markdown copy, for agents that ask for text/markdown.

tools/build-public.py writes one beside each public page (index.md beside
index.html) and worker/index.mjs answers a request with it when the request's
Accept header prefers text/markdown. Cloudflare's own Markdown for Agents does
this at the edge but needs a Pro plan; this is the same idea at build time.

The copy is generated from the page itself, so it cannot drift from it: YAML
frontmatter from <title> and the meta description, then the text of <main> as
Markdown - headings, paragraphs, lists, links, code. What a script fills in at
runtime is not in the HTML and so not in the copy: a block holding a
placeholder (data-stat, filled from the library's counts) is left out rather
than shown as "— devices", and a page that is mostly an interactive tool says
so, and links to itself.

Links are made absolute and canonical: explorer.html#x becomes
https://portrayal.dev/explorer#x, the URL Cloudflare serves with a 200.
"""
import re
from html import unescape
from html.parser import HTMLParser

SITE = "https://portrayal.dev"

# Subtrees that are not content: page chrome, controls, and what a script owns.
SKIP = {"script", "style", "svg", "template", "noscript", "nav", "header", "footer",
        "button", "select", "canvas", "iframe", "dialog", "form", "img", "video", "picture"}
VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta",
        "source", "track", "wbr"}
BLOCK = {"p", "div", "section", "article", "aside", "blockquote", "figure", "figcaption",
         "details", "summary", "dl", "dt", "dd", "main", "li", "ul", "ol", "pre",
         "h1", "h2", "h3", "h4", "h5", "h6", "hr", "table", "tr"}
# Classes that mark page chrome inside <main>: the skip link, the brand link home.
SKIP_CLASS = {"skip", "brand"}
BR = "\x00"             # a <br>, kept through whitespace collapsing
# Fewer words than this in <main> and the page is a tool more than a text.
THIN = 60


def page_url(page):
    """The canonical URL of a page: Cloudflare 307s /x.html to /x, which is the 200."""
    return f"{SITE}/" if page == "index.html" else f"{SITE}/{page[:-len('.html')]}"


def absolute(href, page):
    """A link as it should read outside the page: absolute, and canonical."""
    if re.match(r"^[a-z][a-z0-9+.-]*:", href, re.I):          # https:, mailto:
        return href
    if href.startswith("#"):
        return page_url(page) + href
    path, _, frag = href.partition("#")
    path = path.lstrip("./").lstrip("/")
    if path.endswith(".html") and "/" not in path:
        url = page_url(path)
    else:
        url = f"{SITE}/{path}"
    return url + (f"#{frag}" if frag else "")


class _Md(HTMLParser):
    def __init__(self, page):
        super().__init__(convert_charrefs=True)
        self.page = page
        self.title = ""
        self.description = ""
        self.in_title = False
        self.in_main = False     # between <main> and </main>; markdown() supplies one if missing
        self.skip = []           # the tags of the subtrees being skipped
        self.out = []            # finished blocks
        self.line = []           # the inline text of the block being built
        self.lists = []          # "ul" / "ol" counters, innermost last
        self.href = []           # open links: (href, index into self.line)
        self.pre = 0
        self.prefix = ""         # what the block being built starts with
        self.stale = False       # the block holds a runtime placeholder

    # ── blocks ──────────────────────────────────────────────────────────
    def flush(self):
        text = "".join(self.line)
        if not self.pre:
            text = re.sub(rf" *{BR} *", "  \n", re.sub(r"\s+", " ", text)).strip()
            text = re.sub(r"\[ +", "[", re.sub(r" +\]\(", "](", text))
        if text and not self.stale:
            self.out.append(self.prefix + text)
        self.line, self.prefix, self.stale = [], "", False

    def emit(self, s):
        self.line.append(s)

    # ── the parser ──────────────────────────────────────────────────────
    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "title":
            self.in_title = True
        if tag == "meta" and a.get("name") == "description":
            self.description = a.get("content", "")
        if tag == "main":
            self.in_main = True
            return
        if self.skip:
            if tag not in VOID:
                self.skip.append(tag)
            return
        if not self.in_main:
            return
        hidden = ("hidden" in a or a.get("aria-hidden") == "true"
                  or SKIP_CLASS & set((a.get("class") or "").split()))
        if tag in SKIP or hidden:
            if tag not in VOID:
                self.skip.append(tag)
            return
        if tag in BLOCK:
            self.flush()
        if "data-stat" in a:
            self.stale = True
        if tag in ("h1", "h2", "h3", "h4", "h5", "h6"):
            self.prefix = "#" * int(tag[1]) + " "
        elif tag in ("ul", "ol"):
            self.lists.append(0 if tag == "ol" else None)
        elif tag == "li":
            indent = "  " * max(0, len(self.lists) - 1)
            if self.lists and self.lists[-1] is not None:
                self.lists[-1] += 1
                self.prefix = f"{indent}{self.lists[-1]}. "
            else:
                self.prefix = f"{indent}- "
        elif tag == "blockquote":
            self.prefix = "> "
        elif tag == "pre":
            self.pre += 1
        elif tag == "br":
            self.emit(BR)
        elif tag == "hr":
            self.out.append("---")
        elif tag == "code" and not self.pre:
            self.emit("`")
        elif tag in ("strong", "b"):
            self.emit("**")
        elif tag in ("em", "i"):
            self.emit("*")
        elif tag == "a" and a.get("href"):
            self.href.append((absolute(a["href"], self.page), len(self.line)))
            self.emit("[")

    def handle_startendtag(self, tag, attrs):
        # <svg id="x"/>: a start with no end to come. Opened and closed at
        # once, so a skipped tag cannot go on skipping the rest of the page.
        self.handle_starttag(tag, attrs)
        if tag not in VOID:
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        if tag == "title":
            self.in_title = False
        if tag == "main":
            self.flush()
            self.in_main = False
            return
        if self.skip:
            # Close up to the matching tag: an unclosed <p> or <li> inside a
            # skipped subtree must not keep the rest of the page skipped.
            if tag in self.skip:
                while self.skip.pop() != tag:
                    pass
            return
        if not self.in_main:
            return
        if tag == "pre":
            code = "".join(self.line).strip("\n")
            self.line, self.prefix = [], ""
            self.pre -= 1
            if code.strip():
                self.out.append(f"```\n{code}\n```")
            return
        if tag == "code" and not self.pre:
            self.emit("`")
        elif tag in ("strong", "b"):
            self.emit("**")
        elif tag in ("em", "i"):
            self.emit("*")
        elif tag == "a" and self.href:
            href, at = self.href.pop()
            inner = "".join(self.line[at + 1:]).strip()
            if inner:
                self.emit(f"]({href})")
            else:
                del self.line[at:]
        if tag in ("ul", "ol") and self.lists:
            self.lists.pop()
        if tag in BLOCK:
            self.flush()

    def handle_data(self, data):
        if self.in_title:
            self.title += data
        if self.skip or not self.in_main:
            return
        self.emit(data)


def markdown(page, html):
    """The Markdown copy of `page` (a PAGES name such as "explorer.html"), from its HTML."""
    p = _Md(page)
    if "<main" not in html:     # no <main>: everything in <body> but the chrome
        html = re.sub(r"<body\b[^>]*>", "<body><main>", html, count=1).replace("</body>", "</main></body>")
    p.feed(html)
    p.close()
    p.flush()
    # Inline marks around nothing (`` or ****) are what a script fills at runtime.
    blocks = [re.sub(r"(\*\*|`)\s*\1", "", b).strip() for b in p.out]
    # Empty marks, and a script's own status line ("Loading the compiled drawing…").
    blocks = [b for b in blocks if b and not re.fullmatch(r"[#>\-*\d. ]+|Loading\b.*…", b)]
    words = sum(len(re.findall(r"\w+", b)) for b in blocks)
    url = page_url(page)
    title = re.sub(r"\s+", " ", unescape(p.title)).strip()
    front = ["---", f"title: {_yaml(title)}"]
    if p.description:
        front.append(f"description: {_yaml(p.description)}")
    front += [f"url: {url}", "---", ""]
    body = "\n\n".join(blocks)
    if words < THIN:
        note = (f"This page is an interactive tool that runs in the browser, "
                f"{'and the text above is all of it a script does not draw' if body else 'drawn by a script'}. "
                f"Open it at <{url}>.")
        body = f"{body}\n\n{note}" if body else note
    return "\n".join(front) + body + "\n"


def _yaml(s):
    """A YAML scalar: quoted, since a title carries colons and dashes."""
    return '"' + s.replace("\\", "\\\\").replace('"', '\\"') + '"'
