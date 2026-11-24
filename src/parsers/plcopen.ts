/**
 * PLCopen TC6 XML front-end (LD bodies), CODESYS 3.5 first.
 *
 * Accepts a whole export (<project>), a <pou>, or a bare <LD> fragment; TC6 v2.00 and v2.01 alike
 * (elements are matched by local name). Every LD body becomes a section titled by its POU (and
 * action or transition); ST, FBD, SFC, and IL bodies are skipped with a notice.
 *
 * Networks:
 *   - CODESYS writes one left rail per POU and starts each network with a <comment> (the network
 *     comment) and a <vendorElement> whose ElementType is "networktitle". When those markers are
 *     present, networks are cut at them in document order.
 *   - Otherwise (one rail pair per rung, as other tools write), each connected group of elements is
 *     a network, in document order.
 * CODESYS exports put every element at position (0,0), so layout never relies on positions.
 *
 * Each network is turned into a graph (elements as edges between electrical nodes, see
 * seriesParallel.ts) and reduced to the Series/Parallel IR. Outputs that connect to nothing count
 * as reaching the right rail (CODESYS leaves the right rail unconnected).
 *
 * Blocks: the power-flow input is EN when present, otherwise the input pins wired from contacts,
 * coils, the left rail, or another block's power output; the first of those is the main input and
 * any others draw as extra legs into their pins (CTU's RESET from a contact). The power output is
 * ENO when present, otherwise the first output. Other pins are data: values come from
 * <inVariable>/<outVariable> elements, inline <expression>s, or "Instance.Pin" for a wire from
 * another block's data output.
 */
import type { Instr, InstrVariant, Node, Operand, Rung, Series } from "../ir/types";
import { bump, describeCounts, LineIndex, type FrontEndResult, type Section } from "./common";
import type { ParseMessage } from "./neutralText";
import { reduceSeriesParallel, type SpEdge } from "./seriesParallel";
import { deepText, elements, firstElement, localName, parseXml, textContent, type XmlElement, type XmlNode } from "./xml";

interface Conn {
	ref: string;
	pin?: string;
}

interface Pin {
	name: string;
	conns: Conn[];
	/** Inline <expression> (output assignment, or a constant on an input). */
	expr?: string;
	negated: boolean;
}

interface El {
	id: string;
	kind: string;
	xml: XmlElement;
	order: number;
	/** connectionPointIn connections (contact, coil, outVariable, rails, jump, return, connector). */
	ins: Conn[];
	inputs: Pin[];
	outputs: Pin[];
	typeName?: string;
	instance?: string;
	/** Variable of a contact or coil; expression of an in/out variable. */
	expr?: string;
	/** Connector/continuation name, label or jump target. */
	name?: string;
}

const POWER_KINDS = new Set(["leftPowerRail", "contact", "coil", "jump", "return", "connector", "continuation"]);
const IGNORED_KINDS = new Set(["comment", "vendorElement", "rightPowerRail", "inVariable", "outVariable", "inOutVariable", "label", "leftPowerRail"]);
const SOURCE = "src";
const SINK = "sink";

export function parsePLCopen(src: string): FrontEndResult {
	const xml = parseXml(src);
	const idx = new LineIndex(src);
	const errors: ParseMessage[] = [];
	const notices: string[] = [];
	if (xml.error) errors.push({ ...idx.loc(xml.error.pos), message: `XML: ${xml.error.message}` });

	const sections: Section[] = [];
	const skipped = new Map<string, number>();
	const unsupported = new Map<string, number>();

	const walk = (nodes: readonly XmlNode[], title: string | undefined): void => {
		for (const el of elements(nodes)) {
			const name = localName(el.name);
			if (name === "LD") {
				const rungs = readLd(el, idx, errors, unsupported);
				sections.push(title ? { title, rungs } : { rungs });
			} else if (name === "body") {
				for (const b of elements(el.children)) {
					const kind = localName(b.name);
					if (kind === "LD") walk([b], title);
					else if (kind !== "documentation" && kind !== "addData") bump(skipped, kind);
				}
			} else if (name === "pou" || name === "action" || name === "transition") {
				const own = el.attrs.name;
				walk(el.children, [title, own].filter(Boolean).join(" / ") || undefined);
			} else {
				walk(el.children, title);
			}
		}
	};
	walk(xml.children, undefined);

	if (skipped.size > 0) {
		const total = [...skipped.values()].reduce((a, b) => a + b, 0);
		notices.push(`Skipped ${total} non-LD bod${total === 1 ? "y" : "ies"} (${describeCounts(skipped)}).`);
	}
	if (unsupported.size > 0) notices.push(`Ignored unsupported LD elements (${describeCounts(unsupported)}).`);
	if (sections.length === 0 && errors.length === 0) notices.push("No <LD> bodies found.");
	return { sections, errors, notices };
}

// ---------------------------------------------------------------------------------------------
// Reading elements

function readLd(ld: XmlElement, idx: LineIndex, errors: ParseMessage[], unsupported: Map<string, number>): Rung[] {
	const els: El[] = [];
	elements(ld.children).forEach((x, order) => {
		const id = x.attrs.localId;
		if (id === undefined) return;
		els.push(readEl(x, id, order));
	});
	const all = new Map(els.map((e) => [e.id, e]));
	const power = classifyPower(els, all);

	return splitNetworks(els, all).map((net) => {
		const rung = buildRung(net, all, power, unsupported);
		if (rung.error) {
			const first = net.members.find((e) => !IGNORED_KINDS.has(e.kind)) ?? net.members[0];
			errors.push({ ...idx.loc(first?.xml.start ?? ld.start), message: rung.error });
		}
		return rung;
	});
}

function connsOf(cpi: XmlElement | undefined): Conn[] {
	if (!cpi) return [];
	return elements(cpi.children, "connection").flatMap((c) => {
		const ref = c.attrs.refLocalId;
		if (ref === undefined) return [];
		return [c.attrs.formalParameter !== undefined ? { ref, pin: c.attrs.formalParameter } : { ref }];
	});
}

function exprOf(el: XmlElement | undefined): string | undefined {
	const e = el ? firstElement(el, "expression") : undefined;
	const t = e ? textContent(e).text.trim() : "";
	return t === "" ? undefined : t;
}

function pinsOf(group: XmlElement | undefined): Pin[] {
	if (!group) return [];
	return elements(group.children, "variable").map((v) => {
		const cpi = firstElement(v, "connectionPointIn");
		const cpo = firstElement(v, "connectionPointOut");
		const pin: Pin = { name: v.attrs.formalParameter ?? "", conns: connsOf(cpi), negated: v.attrs.negated === "true" };
		const expr = exprOf(cpo) ?? exprOf(cpi);
		if (expr !== undefined) pin.expr = expr;
		return pin;
	});
}

function readEl(x: XmlElement, id: string, order: number): El {
	const kind = localName(x.name);
	const e: El = { id, kind, xml: x, order, ins: connsOf(firstElement(x, "connectionPointIn")), inputs: [], outputs: [] };
	switch (kind) {
		case "contact":
		case "coil": {
			const v = firstElement(x, "variable");
			e.expr = v ? textContent(v).text.trim() : "";
			break;
		}
		case "block":
			e.typeName = x.attrs.typeName ?? "?";
			if (x.attrs.instanceName) e.instance = x.attrs.instanceName;
			e.inputs = [...pinsOf(firstElement(x, "inputVariables")), ...pinsOf(firstElement(x, "inOutVariables"))];
			e.outputs = pinsOf(firstElement(x, "outputVariables"));
			break;
		case "inVariable":
		case "outVariable":
		case "inOutVariable":
			e.expr = exprOf(x) ?? "";
			break;
		case "connector":
		case "continuation":
			e.name = x.attrs.name ?? "";
			break;
		case "label":
		case "jump":
			e.name = x.attrs.label ?? "";
			break;
	}
	return e;
}

// ---------------------------------------------------------------------------------------------
// Power flow

const powerOutPin = (b: El): string | undefined => b.outputs.find((p) => p.name.toUpperCase() === "ENO")?.name ?? b.outputs[0]?.name;

/** Ids of elements that carry rung power. Blocks join when an input is wired from power. */
function classifyPower(els: El[], all: Map<string, El>): Set<string> {
	const power = new Set(els.filter((e) => POWER_KINDS.has(e.kind)).map((e) => e.id));
	for (let changed = true; changed; ) {
		changed = false;
		for (const b of els) {
			if (b.kind !== "block" || power.has(b.id)) continue;
			if (b.inputs.some((p) => p.conns.some((c) => isPowerConn(c, all, power)))) {
				power.add(b.id);
				changed = true;
			}
		}
	}
	return power;
}

function isPowerConn(c: Conn, all: Map<string, El>, power: Set<string>): boolean {
	const r = all.get(c.ref);
	if (!r || !power.has(r.id)) return false;
	if (r.kind === "block") return c.pin === undefined || c.pin === powerOutPin(r);
	return true;
}

function powerInPins(b: El, all: Map<string, El>, power: Set<string>): Pin[] {
	const en = b.inputs.find((p) => p.name.toUpperCase() === "EN");
	const wired = b.inputs.filter((p) => p.conns.some((c) => isPowerConn(c, all, power)));
	if (en && wired.includes(en)) return [en, ...wired.filter((p) => p !== en)];
	return wired;
}

// ---------------------------------------------------------------------------------------------
// Networks

interface Network {
	members: El[];
	title?: string;
	comment?: string;
	label?: string;
}

function isNetworkTitle(e: El): boolean {
	if (e.kind !== "vendorElement") return false;
	const stack: XmlElement[] = [e.xml];
	while (stack.length > 0) {
		const x = stack.pop()!;
		if (localName(x.name) === "ElementType" && textContent(x).text.trim() === "networktitle") return true;
		stack.push(...elements(x.children));
	}
	return false;
}

function splitNetworks(els: El[], all: Map<string, El>): Network[] {
	const markers = els.filter(isNetworkTitle);
	const nets = markers.length > 0 ? splitAtTitles(els, markers) : splitByConnection(els, all);
	return nets.filter((n) => n.members.some((e) => !IGNORED_KINDS.has(e.kind)) || n.title || n.comment);
}

function splitAtTitles(els: El[], markers: El[]): Network[] {
	const nets: Network[] = [];
	let cur: Network | undefined;
	let pendingComment: string | undefined;
	for (const e of els) {
		if (markers.includes(e)) {
			cur = { members: [] };
			const t = deepText(firstElement(e.xml, "alternativeText") ?? e.xml).trim();
			if (t) cur.title = t;
			if (pendingComment) cur.comment = pendingComment;
			pendingComment = undefined;
			nets.push(cur);
			continue;
		}
		if (e.kind === "comment") {
			// CODESYS writes the network comment just before the networktitle marker.
			pendingComment = commentText(e) || undefined;
			continue;
		}
		if (e.kind === "leftPowerRail" || e.kind === "rightPowerRail") continue;
		if (!cur) {
			cur = { members: [] };
			nets.push(cur);
		}
		if (e.kind === "label" && e.name) cur.label = e.name;
		cur.members.push(e);
	}
	return nets;
}

function commentText(e: El): string {
	const content = firstElement(e.xml, "content");
	return content ? deepText(content).replace(/\r\n?/g, "\n").trim() : "";
}

/** Connected groups of elements (rails excluded so a shared rail does not merge networks). */
function splitByConnection(els: El[], all: Map<string, El>): Network[] {
	const uf = new UnionFind();
	const isRail = (e: El | undefined) => e?.kind === "leftPowerRail" || e?.kind === "rightPowerRail";
	for (const e of els) {
		uf.find(e.id);
		const conns = [...e.ins, ...e.inputs.flatMap((p) => p.conns)];
		for (const c of conns) {
			const r = all.get(c.ref);
			if (!r || isRail(r) || isRail(e)) continue;
			uf.union(e.id, r.id);
		}
	}
	// Connectors and continuations of the same name belong together.
	const byName = new Map<string, string>();
	for (const e of els) {
		if ((e.kind === "connector" || e.kind === "continuation") && e.name) {
			const other = byName.get(e.name);
			if (other) uf.union(e.id, other);
			else byName.set(e.name, e.id);
		}
	}
	const groups = new Map<string, Network>();
	const comments: El[] = [];
	for (const e of els) {
		if (isRail(e)) continue;
		if (e.kind === "comment") {
			comments.push(e);
			continue;
		}
		const key = uf.find(e.id);
		const g = groups.get(key) ?? groups.set(key, { members: [] }).get(key)!;
		if (e.kind === "label" && e.name) g.label = e.name;
		g.members.push(e);
	}
	const nets = [...groups.values()].sort((a, b) => (a.members[0]?.order ?? 0) - (b.members[0]?.order ?? 0));
	// A comment belongs to the next network after it in document order.
	for (const c of comments) {
		const next = nets.find((n) => (n.members[0]?.order ?? 0) > c.order);
		const text = commentText(c);
		if (next && text) next.comment = next.comment ? `${next.comment}\n${text}` : text;
	}
	return nets;
}

// ---------------------------------------------------------------------------------------------
// Graph and reduction

function buildRung(net: Network, all: Map<string, El>, power: Set<string>, unsupported: Map<string, number>): Rung {
	const comment = [net.title, net.label ? `${net.label}:` : undefined, net.comment].filter(Boolean).join("\n");
	const rung = (r: Omit<Rung, "comment">): Rung => (comment ? { ...r, comment } : r);
	const empty: Series = { kind: "series", items: [] };

	const uf = new UnionFind();
	uf.find(SOURCE);
	uf.find(SINK);
	interface PendingEdge {
		from: string;
		to: string;
		node?: Node;
		pin?: string;
		pinRank?: number;
		order: number;
	}
	const edges: PendingEdge[] = [];
	let problem: string | undefined;

	const outTerm = (c: Conn): string | undefined => {
		const r = all.get(c.ref);
		if (!r) {
			problem ??= `Connection to localId ${c.ref}, which does not exist.`;
			return undefined;
		}
		if (r.kind === "leftPowerRail") return SOURCE;
		if (r.kind === "continuation") return `name:${r.name ?? ""}`;
		if (r.kind === "block") {
			const pin = c.pin ?? powerOutPin(r);
			if (pin !== powerOutPin(r)) {
				problem ??= `${blockLabel(r)}: output ${pin} drives the rung, but only one output per block can carry rung power in this version.`;
			}
		}
		return `out:${r.id}`;
	};
	const wireIn = (term: string, conns: Conn[]) => {
		for (const c of conns) {
			const t = outTerm(c);
			if (t) uf.union(term, t);
		}
	};

	for (const e of net.members) {
		switch (e.kind) {
			case "contact":
			case "coil":
			case "jump":
			case "return":
				wireIn(`in:${e.id}`, e.ins);
				edges.push({ from: `in:${e.id}`, to: `out:${e.id}`, node: elementNode(e), order: e.order });
				break;
			case "connector":
				wireIn(`name:${e.name ?? ""}`, e.ins);
				break;
			case "block": {
				if (!power.has(e.id)) {
					problem ??= `${blockLabel(e)} has no input wired to the rung.`;
					break;
				}
				const pins = powerInPins(e, all, power);
				const node = blockNode(e, pins, all, power);
				if (pins.length === 1) {
					const p = pins[0]!;
					wireIn(`pin:${e.id}:${p.name}`, p.conns);
					edges.push({ from: `pin:${e.id}:${p.name}`, to: `out:${e.id}`, node, order: e.order });
				} else {
					pins.forEach((p, rank) => {
						wireIn(`pin:${e.id}:${p.name}`, p.conns);
						edges.push({ from: `pin:${e.id}:${p.name}`, to: `join:${e.id}`, pin: p.name, pinRank: rank, order: e.order });
					});
					edges.push({ from: `join:${e.id}`, to: `out:${e.id}`, node, order: e.order });
				}
				break;
			}
			case "rightPowerRail":
				for (const c of e.ins) {
					const t = outTerm(c);
					if (t) uf.union(t, SINK);
				}
				break;
			default:
				if (!IGNORED_KINDS.has(e.kind) && e.kind !== "continuation") bump(unsupported, e.kind);
		}
	}
	// Right rails outside this network (CODESYS: one per POU) may still connect its outputs.
	for (const r of all.values()) {
		if (r.kind !== "rightPowerRail" || net.members.includes(r)) continue;
		for (const c of r.ins) {
			if (net.members.some((m) => m.id === c.ref)) uf.union(`out:${c.ref}`, SINK);
		}
	}

	if (problem) return rung({ body: empty, error: problem });
	if (edges.length === 0) return rung({ body: empty });

	// Outputs that lead nowhere reach the right rail.
	const hasOut = new Set(edges.map((e) => uf.find(e.from)));
	for (const e of edges) {
		if (!hasOut.has(uf.find(e.to))) uf.union(e.to, SINK);
	}

	const ids = new Map<string, number>();
	const num = (k: string) => {
		const rep = uf.find(k);
		return ids.get(rep) ?? ids.set(rep, ids.size).get(rep)!;
	};
	const source = num(SOURCE);
	const sink = num(SINK);
	const spEdges: SpEdge[] = edges.map((e) => {
		const s: SpEdge = { from: num(e.from), to: num(e.to), order: e.order };
		if (e.node) s.node = e.node;
		if (e.pin !== undefined) {
			s.pin = e.pin;
			s.pinRank = e.pinRank ?? 0;
		}
		return s;
	});

	const unreached = unreachable(spEdges, source, sink);
	if (unreached > 0) {
		return rung({
			body: empty,
			error: `${unreached} element${unreached === 1 ? " is" : "s are"} not connected between the left rail and an output.`,
		});
	}

	const r = reduceSeriesParallel(spEdges, source, sink);
	return r.ok ? rung({ body: r.body }) : rung({ body: empty, error: r.reason });
}

/** Edges not on any path from source to sink. */
function unreachable(edges: SpEdge[], source: number, sink: number): number {
	const reach = (start: number, next: (e: SpEdge) => [number, number]) => {
		const seen = new Set([start]);
		for (let grew = true; grew; ) {
			grew = false;
			for (const e of edges) {
				const [a, b] = next(e);
				if (seen.has(a) && !seen.has(b)) {
					seen.add(b);
					grew = true;
				}
			}
		}
		return seen;
	};
	const fwd = reach(source, (e) => [e.from, e.to]);
	const back = reach(sink, (e) => [e.to, e.from]);
	return edges.filter((e) => e.node && !(fwd.has(e.from) && back.has(e.to))).length;
}

// ---------------------------------------------------------------------------------------------
// IR for elements

function elementNode(e: El): Instr {
	const attr = (k: string) => e.xml.attrs[k] ?? "";
	if (e.kind === "contact") {
		const i: Instr = { kind: "instr", op: "contact", shape: "contact", role: "input", operands: [{ value: e.expr ?? "" }] };
		const edge = attr("edge");
		if (edge === "rising") setVariant(i, "pos", "P");
		else if (edge === "falling") setVariant(i, "neg", "N");
		else if (attr("negated") === "true") i.variant = "nc";
		else i.variant = "no";
		return i;
	}
	if (e.kind === "coil") {
		const i: Instr = { kind: "instr", op: "coil", shape: "coil", role: "output", operands: [{ value: e.expr ?? "" }] };
		const storage = attr("storage");
		const edge = attr("edge");
		if (storage === "set") setVariant(i, "set", "S");
		else if (storage === "reset") setVariant(i, "reset", "R");
		else if (edge === "rising") setVariant(i, "pos", "P");
		else if (edge === "falling") setVariant(i, "neg", "N");
		else if (attr("negated") === "true") setVariant(i, "nc", "/");
		return i;
	}
	if (e.kind === "jump") {
		return { kind: "instr", op: "jump", shape: "coil", role: "output", label: ">>", operands: [{ value: e.name ?? "" }] };
	}
	return { kind: "instr", op: "return", shape: "coil", role: "output", label: "RET", operands: [] };
}

function setVariant(i: Instr, variant: InstrVariant, label: string): void {
	i.variant = variant;
	i.label = label;
}

const blockLabel = (b: El): string => (b.instance ? `${b.instance} (${b.typeName})` : (b.typeName ?? "block"));

function blockNode(b: El, powerPins: Pin[], all: Map<string, El>, power: Set<string>): Instr {
	const outName = powerOutPin(b);
	const isPowerPin = (p: Pin) => powerPins.includes(p);
	const inputs = [...powerPins.slice(0, 1), ...b.inputs.filter((p) => p !== powerPins[0])];
	const operands: Operand[] = inputs.map((p) =>
		isPowerPin(p) ? { name: p.name, value: "", power: true } : { name: p.name, value: dataValue(p, all, power) },
	);
	const outputs = [...b.outputs.filter((p) => p.name === outName), ...b.outputs.filter((p) => p.name !== outName)];
	const outPins: Operand[] = outputs.map((p) => {
		const value = outputValue(b, p, all);
		return p.name === outName ? { name: p.name, value, power: true } : { name: p.name, value };
	});
	const i: Instr = {
		kind: "instr",
		op: b.typeName ?? "?",
		shape: "box",
		form: "iec",
		role: "input",
		operands,
		outPins,
	};
	if (b.instance) i.instance = b.instance;
	if (powerPins[0]) i.powerIn = powerPins[0].name;
	if (outName !== undefined) i.powerOut = outName;
	return i;
}

function dataValue(p: Pin, all: Map<string, El>, power: Set<string>): string {
	const c = p.conns[0];
	let v = p.expr ?? "";
	if (c) {
		const r = all.get(c.ref);
		if (r?.kind === "inVariable" || r?.kind === "inOutVariable") v = r.expr ?? "";
		else if (r?.kind === "block") v = `${r.instance ?? r.typeName ?? "?"}.${c.pin ?? powerOutPin(r) ?? "?"}`;
		else if (r && power.has(r.id)) v = "";
	}
	return p.negated && v ? `NOT ${v}` : v;
}

function outputValue(b: El, p: Pin, all: Map<string, El>): string {
	if (p.expr !== undefined) return p.expr;
	const targets: string[] = [];
	for (const r of all.values()) {
		if (r.kind !== "outVariable" && r.kind !== "inOutVariable") continue;
		if (r.ins.some((c) => c.ref === b.id && (c.pin ?? powerOutPin(b)) === p.name)) targets.push(r.expr ?? "");
	}
	return targets.join(", ");
}

class UnionFind {
	private readonly parent = new Map<string, string>();

	find(k: string): string {
		let root = k;
		for (;;) {
			const p = this.parent.get(root);
			if (p === undefined) {
				this.parent.set(root, root);
				break;
			}
			if (p === root) break;
			root = p;
		}
		// Path compression.
		let cur = k;
		while (cur !== root) {
			const next: string = this.parent.get(cur) ?? root;
			this.parent.set(cur, root);
			cur = next;
		}
		return root;
	}

	union(a: string, b: string): void {
		const ra = this.find(a);
		const rb = this.find(b);
		if (ra !== rb) this.parent.set(ra, rb);
	}
}
