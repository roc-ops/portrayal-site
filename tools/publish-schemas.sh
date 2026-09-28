#!/bin/sh
# Publish Portrayal's JSON schemas at https://portrayal.dev/schemas/v1/
# (roc-ops/portrayal-site#58). Run at the flip, against the flip commit or the
# release tag, so the served files are exactly the released ones:
#
#   tools/publish-schemas.sh v0.1.0          from the upstream clone, at that ref
#   tools/publish-schemas.sh --from-dir DIR  from a folder of *.schema.json
#
# Each file is copied only if its $id is the URL it will be served at, and the
# run fails on the first one that is not: a schema served at a URL other than
# its own $id is one a validator resolves to the wrong place. v1/ is permanent;
# a format 2 goes under /schemas/v2/ beside it.
#
#   --to DIR   where schemas/ lives (default: the folder wrangler.jsonc deploys)
set -eu
HERE="$(cd "$(dirname "$0")/.." && pwd)"
UPSTREAM="${PORTRAYAL_UPSTREAM:-/Volumes/External/portrayal-upstream}"
FROM_DIR="" REF="" TO=""
while [ $# -gt 0 ]; do
  case "$1" in
    --from-dir) FROM_DIR="$2"; shift 2 ;;
    --to) TO="$2"; shift 2 ;;
    -*) echo "unknown option $1" >&2; exit 2 ;;
    *) REF="$1"; shift ;;
  esac
done
if [ -z "$TO" ]; then
  TO="$HERE/$(python3 -c 'import json,re,sys; print(json.loads(re.sub(r"(?m)^\s*//.*$", "", open(sys.argv[1]).read()))["assets"]["directory"])' "$HERE/wrangler.jsonc")/schemas"
fi
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
if [ -n "$FROM_DIR" ]; then
  cp "$FROM_DIR"/*.schema.json "$STAGE/"
elif [ -n "$REF" ]; then
  for f in $(git -C "$UPSTREAM" ls-tree --name-only "$REF" spec/schemas/ | grep '\.schema\.json$'); do
    git -C "$UPSTREAM" show "$REF:$f" > "$STAGE/$(basename "$f")"
  done
else
  echo "usage: $0 <portrayal-ref> | --from-dir DIR  [--to DIR]" >&2; exit 2
fi
python3 - "$STAGE" <<'PY'
import json, os, sys
stage = sys.argv[1]
bad = []
for name in sorted(os.listdir(stage)):
    want = f"https://portrayal.dev/schemas/v1/{name}"
    got = json.load(open(os.path.join(stage, name))).get("$id")
    if got != want:
        bad.append(f"{name}: $id is {got!r}, not {want}")
if bad:
    sys.exit("not published - a schema's $id must be the URL it is served at:\n  " + "\n  ".join(bad))
PY
mkdir -p "$TO/v1"
cp "$STAGE"/*.schema.json "$TO/v1/"
ls "$TO/v1"
