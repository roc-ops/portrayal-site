# Security

This repository is portrayal.dev: static pages, the modules they load, and a
small Cloudflare Worker that serves them. It holds no user accounts and stores
nothing a visitor sends. The attack surface is what a page does with a file or
a message it is handed, what the Worker answers, and what the site gives a
visitor to run against their own systems.

## What counts as a security issue here

- **Script injection in a page that loads outside input.** Annotate and the
  rack builder take documents from outside the page: a share link, a pasted
  hash, an opened file, an AI client. A document that can make one of those
  pages run script, load a remote resource or read another origin's data is a
  security issue.
- **The agent relay.** "Connect your AI" (`site/agent/relay.js`,
  `site/agent/webmcp.js` and the vendored `vendor/mcp-b/`) lets an AI client
  drive a page. A way for a page other than the one the visitor opened, or a
  client the visitor did not connect, to call those tools is a security issue.
- **The Worker** (`worker/index.mjs`): a request that makes it serve something
  outside `public/`, or reflect request content into a response.
- **The DCIM import.** `site/portrayal-sync.py` and the DCIM bundle are run by
  visitors against their own NetBox or Nautobot. A bundle or a script that
  could write outside what it says it writes, or leak the token it is given,
  is a security issue.
- **Something published that should not be:** a credential, a private address
  or hostname, or vendor material that is not ours to redistribute.

A fault in the drawings themselves, or in Portrayal's compiler or kit, belongs
to [Portrayal](https://github.com/roc-ops/Portrayal/security); `vendor/*.js`,
`vendor/rack/`, `assets/dist/` and `assets/exports/` are copies of its output.

## Reporting

Use GitHub's private vulnerability reporting ("Report a vulnerability" under
the Security tab), so the report stays private until a fix is public. **Do not
open an issue:** issues are public. If that form is unavailable to you, email
security@portrayal.dev instead.

This file covers security reports only. Conduct reports go to the address in
`CODE_OF_CONDUCT.md`, and anything else for the maintainer to
maintainer@portrayal.dev.

You will get an acknowledgement within a week. A fix ships as an ordinary pull
request once the report is understood; every merge to `main` deploys, so a
merged fix is live within minutes.
