"""Validate sample exports against the outline's neutral-text grammar and PLCopen assumptions.

Usage: python -I validate_samples.py <samples_dir>
Prints aggregate stats only (no rung comments), so output stays free of customer prose.
"""
import collections
import os
import re
import sys
import xml.etree.ElementTree as ET

V1_LIB = set("""XIC XIO OTE OTL OTU ONS OSR OSF TON TOF RTO CTU CTD RES EQU NEQ LES LEQ GRT GEQ LIM MEQ CMP
ADD SUB MUL DIV MOD CPT NEG ABS SQR MOV MVM CLR COP CPS FLL BTD AND OR XOR NOT SWPB JSR SBR RET JMP LBL
AFI NOP TND MCR GSV SSV MSG""".split())


class ParseError(Exception):
    pass


class Stats:
    def __init__(self):
        self.mnemonics = collections.Counter()
        self.max_depth = 0
        self.empty_legs = 0
        self.qmarks = 0
        self.subscript_commas = 0
        self.nested_paren_ops = 0
        self.max_operands = 0
        self.max_instrs = 0
        self.ws_inside = 0
        self.quoted_ops = 0
        self.multiline = 0
        self.rungs = 0
        self.failures = []


def parse_rung(text, st):
    i = 0
    n = len(text)
    instr_count = 0

    def ws():
        nonlocal i
        while i < n and text[i].isspace():
            if text[i] == "\n":
                pass
            i += 1

    def series(depth):
        nonlocal i, instr_count
        items = []
        while True:
            ws()
            if i >= n:
                return items
            c = text[i]
            if c == "[":
                items.append(branch(depth + 1))
            elif c in "],;":
                return items
            elif c.isalpha() or c == "_":
                items.append(instr())
                instr_count += 1
            else:
                raise ParseError(f"unexpected {c!r} at col {i}")

    def branch(depth):
        nonlocal i
        st.max_depth = max(st.max_depth, depth)
        i += 1
        legs = [series(depth)]
        while True:
            ws()
            if i >= n:
                raise ParseError("unclosed branch")
            if text[i] == ",":
                i += 1
                legs.append(series(depth))
            elif text[i] == "]":
                i += 1
                st.empty_legs += sum(1 for leg in legs if not leg)
                return ("par", legs)
            else:
                raise ParseError(f"unexpected {text[i]!r} in branch at col {i}")

    def instr():
        nonlocal i
        m = re.compile(r"[A-Za-z_][A-Za-z0-9_]*").match(text, i)
        name = m.group(0)
        i = m.end()
        ws()
        if i >= n or text[i] != "(":
            raise ParseError(f"expected '(' after {name} at col {i}")
        i += 1
        ops, cur, depth_p, depth_b, quote = [], [], 0, 0, None
        while True:
            if i >= n:
                raise ParseError(f"unclosed '(' for {name}")
            c = text[i]
            if quote:
                cur.append(c)
                if c == quote:
                    quote = None
            elif c in "'\"":
                quote = c
                cur.append(c)
                st.quoted_ops += 1
            elif c == "(":
                depth_p += 1
                cur.append(c)
            elif c == ")":
                if depth_p == 0 and depth_b == 0:
                    ops.append("".join(cur))
                    i += 1
                    break
                depth_p -= 1
                cur.append(c)
            elif c == "[":
                depth_b += 1
                cur.append(c)
            elif c == "]":
                depth_b -= 1
                cur.append(c)
            elif c == "," and depth_p == 0 and depth_b == 0:
                ops.append("".join(cur))
                cur = []
            else:
                if c == "," and depth_b > 0:
                    st.subscript_commas += 1
                cur.append(c)
            i += 1
        if ops == [""]:
            ops = []
        for op in ops:
            if op.strip() == "?":
                st.qmarks += 1
            if "(" in op:
                st.nested_paren_ops += 1
            if op != op.strip():
                st.ws_inside += 1
        st.max_operands = max(st.max_operands, len(ops))
        st.mnemonics[name] += 1
        return ("instr", name, ops)

    body = series(0)
    ws()
    if i >= n or text[i] != ";":
        raise ParseError(f"expected ';' at col {i}, got {text[i:i+1]!r}")
    i += 1
    ws()
    if i != n:
        raise ParseError(f"trailing text at col {i}")
    st.max_instrs = max(st.max_instrs, instr_count)
    return body


def run_rung(text, st, where):
    st.rungs += 1
    if "\n" in text.strip():
        st.multiline += 1
    try:
        parse_rung(text, st)
    except ParseError as e:
        st.failures.append((where, str(e), text[:120]))


def local(tag):
    return tag.rsplit("}", 1)[-1]


def do_l5x(path):
    st = Stats()
    tree = ET.parse(path)
    root = tree.getroot()
    routine_types = collections.Counter()
    rung_types = collections.Counter()
    aoi_names = [a.get("Name") for a in root.iter("AddOnInstructionDefinition")]
    comments = 0
    for routine in root.iter("Routine"):
        routine_types[routine.get("Type")] += 1
        for rung in routine.iter("Rung"):
            rung_types[rung.get("Type")] += 1
            if rung.find("Comment") is not None:
                comments += 1
            t = rung.find("Text")
            if t is None:
                st.failures.append((routine.get("Name"), "rung without <Text>", ""))
                continue
            run_rung(t.text or "", st, f"{routine.get('Name')}#{rung.get('Number')}")
    return st, routine_types, rung_types, aoi_names, comments


L5K_STR = re.compile(r'"((?:[^"$]|\$.)*)"')


def do_l5k(path):
    st = Stats()
    rung_texts = []
    comments = []
    with open(path, encoding="utf-8-sig") as fh:
        lines = fh.read().splitlines()
    in_routine = None
    pending = None  # ('RC', [parts]) while a multi-line RC is open
    for raw in lines:
        line = raw.strip()
        if line.startswith("ROUTINE "):
            in_routine = line.split()[1]
            continue
        if line.startswith("END_ROUTINE"):
            in_routine = None
            continue
        if not in_routine:
            continue
        if pending is not None:
            pending.extend(L5K_STR.findall(line))
            if line.endswith(";"):
                comments.append("".join(pending))
                pending = None
            continue
        if line.startswith("RC:"):
            parts = L5K_STR.findall(line)
            if line.endswith(";"):
                comments.append("".join(parts))
            else:
                pending = parts
        elif line.startswith("N:"):
            text = line[2:].strip()
            rung_texts.append(text)
            run_rung(text, st, f"{in_routine}")
        elif line:
            st.failures.append((in_routine, "unknown line in ROUTINE", line[:60]))
    escapes = collections.Counter(re.findall(r"\$(.)", "".join(comments)))
    return st, rung_texts, comments, escapes


def do_plcopen(path):
    tree = ET.parse(path)
    root = tree.getroot()
    ns = root.tag.split("}")[0].lstrip("{")
    res = {"ns": ns, "pous": 0, "rungs": 0, "non_sp": 0, "kinds": collections.Counter(), "attrs": collections.Counter()}
    for pou in root.iter():
        if local(pou.tag) != "pou":
            continue
        res["pous"] += 1
        for body in pou.iter():
            if local(body.tag) not in ("LD", "FBD"):
                continue
            res["kinds"]["body:" + local(body.tag)] += 1
            nodes = {}
            preds = collections.defaultdict(list)
            for el in body:
                k = local(el.tag)
                lid = el.get("localId")
                res["kinds"][k] += 1
                for a in ("negated", "edge", "storage"):
                    if el.get(a) not in (None, "false", "none"):
                        res["attrs"][f"{k}.{a}={el.get(a)}"] += 1
                nodes[lid] = k
                for c in el.iter():
                    if local(c.tag) == "connection":
                        preds[lid].append(c.get("refLocalId"))
            # rung split: walk from each right rail back to its left rail(s)
            for lid, k in nodes.items():
                if k != "rightPowerRail":
                    continue
                res["rungs"] += 1
                if not series_parallel(lid, preds, nodes):
                    res["non_sp"] += 1
    return res


def series_parallel(sink, preds, nodes):
    """Two-terminal series-parallel test via edge reductions on the rung's subgraph."""
    seen, stack, edges = set(), [sink], []
    while stack:
        v = stack.pop()
        if v in seen:
            continue
        seen.add(v)
        for p in preds.get(v, []):
            edges.append((p, v))
            stack.append(p)
    # model each element as an edge: split node v into v_in -> v_out
    E = collections.Counter()
    for v in seen:
        if nodes[v] not in ("leftPowerRail", "rightPowerRail"):
            E[(v + ".in", v + ".out")] += 1
    for p, v in edges:
        src = p + ".out" if nodes[p] != "leftPowerRail" else "L"
        dst = v + ".in" if nodes[v] != "rightPowerRail" else "R"
        E[(src, dst)] += 1
    changed = True
    while changed:
        changed = False
        for e in list(E):
            if E[e] > 1:
                E[e] = 1
                changed = True
        deg_in = collections.Counter(d for (_, d) in E for _ in range(E[(_, d)]))
        deg_out = collections.Counter(s for (s, _) in E for _ in range(E[(s, _)]))
        for node in set(deg_in) | set(deg_out):
            if node in ("L", "R"):
                continue
            if deg_in[node] == 1 and deg_out[node] == 1:
                a = next(s for (s, d) in E if d == node)
                b = next(d for (s, d) in E if s == node)
                del E[(a, node)]
                del E[(node, b)]
                E[(a, b)] += 1
                changed = True
                break
    return list(E) == [("L", "R")]


def report_stats(st):
    print(f"  rungs parsed: {st.rungs}, failures: {len(st.failures)}")
    print(f"  max branch depth: {st.max_depth}, empty legs: {st.empty_legs}, '?' operands: {st.qmarks}")
    print(f"  commas inside subscripts: {st.subscript_commas}, operands with parens (expressions): {st.nested_paren_ops}")
    print(f"  quoted operands: {st.quoted_ops}, operands with padding whitespace: {st.ws_inside}, multi-line rung texts: {st.multiline}")
    print(f"  max operands on one instruction: {st.max_operands}, max instructions in one rung: {st.max_instrs}")
    for where, msg, snippet in st.failures[:8]:
        print(f"  FAIL {where}: {msg} :: {snippet}")


def main(root):
    all_mn = collections.Counter()
    aois = set()
    l5x_texts = {}
    for dirpath, _, files in os.walk(root):
        for f in sorted(files):
            p = os.path.join(dirpath, f)
            ext = f.rsplit(".", 1)[-1].lower()
            print(f"\n== {f}")
            if ext == "l5x":
                st, rtypes, rgtypes, aoi_names, comments = do_l5x(p)
                aois.update(aoi_names)
                print(f"  routine types: {dict(rtypes)}")
                print(f"  rung types: {dict(rgtypes)}, rungs with comments: {comments}, AOI defs: {len(aoi_names)}")
                report_stats(st)
                all_mn.update(st.mnemonics)
            elif ext == "l5k":
                st, texts, comments, escapes = do_l5k(p)
                print(f"  RC comments: {len(comments)}, escape codes used: {dict(escapes)}")
                report_stats(st)
                all_mn.update(st.mnemonics)
                l5x_texts[f] = texts
            elif ext == "xml":
                r = do_plcopen(p)
                print(f"  namespace: {r['ns']}")
                print(f"  POUs: {r['pous']}, rungs (right rails): {r['rungs']}, non-series-parallel: {r['non_sp']}")
                print(f"  element kinds: {dict(r['kinds'])}")
                print(f"  modifiers: {dict(r['attrs'])}")
    print("\n== Mnemonics across all Rockwell samples")
    missing = {k: v for k, v in all_mn.items() if k not in V1_LIB}
    in_lib = {k: v for k, v in all_mn.items() if k in V1_LIB}
    print(f"  in v1 library ({len(in_lib)}): {dict(sorted(in_lib.items(), key=lambda kv: -kv[1]))}")
    aoi_hits = {k: v for k, v in missing.items() if k in aois}
    other = {k: v for k, v in missing.items() if k not in aois}
    print(f"  AOI calls ({len(aoi_hits)} distinct, {sum(aoi_hits.values())} uses)")
    print(f"  not in v1 library and not an AOI ({len(other)}): {dict(sorted(other.items(), key=lambda kv: -kv[1]))}")


if __name__ == "__main__":
    main(sys.argv[1])
