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
#   --to DIR   where schemas/ lives (default: publish/, which
#              tools/build-public.py copies into the deployed folder)
#   --force    replace a published v1 schema whose content differs; without it
#              the run refuses, because v1/ is permanent
set -eu
HERE="$(cd "$(dirname "$0")/.." && pwd)"
UPSTREAM="${PORTRAYAL_UPSTREAM:-/Volumes/External/portrayal-upstream}"
FROM_DIR="" REF="" TO="" FORCE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --from-dir) FROM_DIR="${2:?--from-dir needs a folder}"; shift 2 ;;
    --to) TO="${2:?--to needs a folder}"; shift 2 ;;
    --force) FORCE=1; shift ;;
    -*) echo "unknown option $1" >&2; exit 2 ;;
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
  echo "usage: $0 <portrayal-ref> | --from-dir DIR  [--to DIR]" >&2; exit 2
fi
python3 - "$STAGE" "$TO/v1" "$FORCE" <<'PY'
import json, os, sys
stage, dest, force = sys.argv[1], sys.argv[2], sys.argv[3] == "1"
names = sorted(n for n in os.listdir(stage) if n.endswith(".schema.json"))
if not names:
    sys.exit("not published - no *.schema.json found to publish")
bad = []
for name in names:
    want = f"https://portrayal.dev/schemas/v1/{name}"
    got = json.load(open(os.path.join(stage, name))).get("$id")
    if got != want:
        bad.append(f"{name}: $id is {got!r}, not {want}")
if bad:
    sys.exit("not published - a schema's $id must be the URL it is served at:\n  " + "\n  ".join(bad))
# v1/ IS PERMANENT: a schema already published there changes only on purpose.
changed = [n for n in names if os.path.isfile(os.path.join(dest, n))
           and open(os.path.join(dest, n), "rb").read() != open(os.path.join(stage, n), "rb").read()]
if changed and not force:
    sys.exit("not published - these would change a published v1 schema (v1/ is permanent; "
             "--force if this is deliberate):\n  " + "\n  ".join(changed))
PY
mkdir -p "$TO/v1"
cp "$STAGE"/*.schema.json "$TO/v1/"
ls "$TO/v1"
