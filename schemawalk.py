"""Every place a sub-schema can sit, walked the way site/schema.js walks it.

Shared by check-contract.py (which keywords the schemas use) and
check-browser.py (which properties the schema page must show). One walker, so
the two checks cannot disagree about what "every property" means.
"""
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
SCHEMAS = HERE / "assets" / "schemas"

MAPS = ("properties", "patternProperties", "$defs", "dependentSchemas")
LISTS = ("oneOf", "anyOf", "allOf", "prefixItems")
SINGLE = ("items", "additionalProperties", "propertyNames", "not", "if", "then", "else", "contains")


def seg(k):
    """A JSON Pointer segment, escaped the way schema.js escapes it."""
    return str(k).replace("~", "~0").replace("/", "~1")


def walk(node, ptr=""):
    """Yield (pointer, schema node) for the document and every sub-schema in it."""
    if not isinstance(node, dict):
        return
    yield ptr, node
    for kw in MAPS:
        for k, v in (node.get(kw) or {}).items():
            yield from walk(v, f"{ptr}/{kw}/{seg(k)}")
    for kw in LISTS:
        for i, v in enumerate(node.get(kw) or []):
            yield from walk(v, f"{ptr}/{kw}/{i}")
    for kw in SINGLE:
        if isinstance(node.get(kw), dict):
            yield from walk(node[kw], f"{ptr}/{kw}")


def documents():
    """{filename: parsed schema} for every schema the site vendors."""
    return {p.name: json.loads(p.read_text()) for p in sorted(SCHEMAS.glob("*.schema.json"))}


def keywords(doc):
    """Every keyword used at a schema position, with the first pointer using it."""
    seen = {}
    for ptr, node in walk(doc):
        for k in node:
            seen.setdefault(k, ptr or "/")
    return seen


def property_pointers(doc):
    """The pointer of every property the document declares, anywhere in it."""
    return {ptr for ptr, _ in walk(doc)
            if ptr.rsplit("/", 2)[-2:-1] == ["properties"]}
