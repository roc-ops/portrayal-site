#!/bin/sh
# Publish Portrayal's JSON schemas at https://portrayal.dev/schemas/<label>/
# (roc-ops/portrayal-site#58). Run at the flip, against the flip commit or the
# release tag, so the served files are exactly the released ones:
#
#   tools/publish-schemas.sh v0.1.0          from the upstream clone, at that ref
#   tools/publish-schemas.sh --from-dir DIR  from a folder of *.schema.json
#
# A REF PUBLISHES EVERY SCHEMA AT THAT REF; --from-dir PUBLISHES WHAT IS IN THE
# FOLDER, so it is how one schema goes out on its own. The rack schema is the
# case: its label follows the rack file's version, not a Portrayal release, so
# it moves when the manifest schemas do not. A ref would stage all of them, and
# if any manifest schema at that ref differs from the one published under its
# label, the whole run refuses and nothing is copied, the rack schema
# included (and --force would then rewrite every one that differs). So the
# rack schema is put in a folder alone:
#
#   d=$(mktemp -d)
#   git -C "$PORTRAYAL_UPSTREAM" show <ref>:spec/schemas/rack.schema.json > "$d/rack.schema.json"
#   tools/publish-schemas.sh --from-dir "$d"
#
# /schemas/v2/rack.schema.json was published that way. Everything already
# under schemas/ stays as it is, and is listed as "(kept as published)".
#
# EACH SCHEMA'S LABEL IS ITS OWN. A schema's $id names the URL it is served
# at, https://portrayal.dev/schemas/<label>/<file>, and that is where it is
# copied: the manifest schemas are format 1 under /schemas/v1/, and the rack
# file, whose `version` is the Rack Builder's own, took the next unused label
# for rack file version 3 (Portrayal #921, docs/format-stability.md), so
# rack.schema.json now goes under /schemas/v2/. A $id of any other shape fails
# the run before anything is copied: a schema served at a URL other than its
# own $id is one a validator resolves to the wrong place.
#
# A PUBLISHED LABEL IS PERMANENT. Nothing is ever removed: /schemas/v1/
# rack.schema.json, which describes rack file version 2, stays as published
# beside the v2 one. A schema already published under its label changes only
# with --force.
#
#   --to DIR   where schemas/ lives (default: publish/, which
#              tools/build-public.py copies into the deployed folder)
#   --force    replace a published schema whose content differs; without it
#              the run refuses, because a published label is permanent
set -eu
HERE="$(cd "$(dirname "$0")/.." && pwd)"
# The Portrayal clone: $PORTRAYAL_UPSTREAM, else ../Portrayal beside this
# repository - the same default as refresh-assets.sh and check-contract.py.
UPSTREAM="${PORTRAYAL_UPSTREAM:-$HERE/../Portrayal}"
FROM_DIR="" REF="" TO="" FORCE=""
usage() {
  cat >&2 <<USAGE
usage: $0 <portrayal-ref>  [--to DIR] [--force]
       $0 --from-dir DIR   [--to DIR] [--force]

  <portrayal-ref>  every spec/schemas/*.schema.json at that ref of the Portrayal
                   clone (\$PORTRAYAL_UPSTREAM, else ../Portrayal): a release
  --from-dir DIR   only the *.schema.json files in DIR. To publish one schema on
                   its own, put it in a folder alone: the rack schema goes out
                   this way, because its label follows the rack file's version
                   and a ref would stage the manifest schemas with it
  --to DIR         where schemas/ lives (default: publish/schemas)
  --force          replace a published schema whose content differs

Each schema is copied to <label>/<file>, the label its own \$id names. Nothing
already published is removed, and without --force nothing published is changed.
USAGE
}
while [ $# -gt 0 ]; do
  case "$1" in
    --from-dir) FROM_DIR="${2:?--from-dir needs a folder}"; shift 2 ;;
    --to) TO="${2:?--to needs a folder}"; shift 2 ;;
    --force) FORCE=1; shift ;;
    -*) echo "unknown option $1" >&2; usage; exit 2 ;;
    *) REF="$1"; shift ;;
  esac
done
[ -n "$TO" ] || TO="$HERE/publish/schemas"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT INT TERM
if [ -n "$FROM_DIR" ]; then
  cp "$FROM_DIR"/*.schema.json "$STAGE/"
elif [ -n "$REF" ]; then
  git -C "$UPSTREAM" rev-parse --verify --quiet "$REF^{commit}" >/dev/null \
    || { echo "no such Portrayal ref: $REF" >&2; exit 1; }
  for f in $(git -C "$UPSTREAM" ls-tree --name-only "$REF" spec/schemas/ | grep '\.schema\.json$'); do
    git -C "$UPSTREAM" show "$REF:$f" > "$STAGE/$(basename "$f")"
  done
else
  usage; exit 2
fi
python3 - "$STAGE" "$TO" "$FORCE" <<'PY'
import json, os, re, shutil, sys
stage, to, force = sys.argv[1], sys.argv[2], sys.argv[3] == "1"
names = sorted(n for n in os.listdir(stage) if n.endswith(".schema.json"))
if not names:
    sys.exit("not published - no *.schema.json found to publish")
# Each schema's label from its own $id: https://portrayal.dev/schemas/<vN>/<its file name>.
label, bad = {}, []
for name in names:
    got = json.load(open(os.path.join(stage, name))).get("$id")
    m = re.fullmatch(r"https://portrayal\.dev/schemas/(v[1-9][0-9]*)/" + re.escape(name), str(got))
    if m:
        label[name] = m.group(1)
    else:
        bad.append(f"{name}: $id is {got!r}, not https://portrayal.dev/schemas/<vN>/{name}")
if bad:
    sys.exit("not published - a schema's $id must be the URL it is served at:\n  " + "\n  ".join(bad))
# A PUBLISHED LABEL IS PERMANENT: a schema already published there changes only on purpose.
dest = {n: os.path.join(to, label[n], n) for n in names}
changed = [f"{label[n]}/{n}" for n in names if os.path.isfile(dest[n])
           and open(dest[n], "rb").read() != open(os.path.join(stage, n), "rb").read()]
if changed and not force:
    sys.exit("not published - these would change a published schema (a published label is permanent; "
             "--force if this is deliberate):\n  " + "\n  ".join(changed))
for n in names:
    os.makedirs(os.path.dirname(dest[n]), exist_ok=True)
    shutil.copyfile(os.path.join(stage, n), dest[n])
# What is published now under each label, this run's and every earlier one's.
for d in sorted(x for x in os.listdir(to) if re.fullmatch(r"v[0-9]+", x)):
    for n in sorted(os.listdir(os.path.join(to, d))):
        print(f"{d}/{n}{'' if label.get(n) == d else '  (kept as published)'}")
PY
