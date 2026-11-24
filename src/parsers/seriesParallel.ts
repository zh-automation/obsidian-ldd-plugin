/**
 * Two-terminal series-parallel reduction: turns a power-flow graph (elements as edges between
 * electrical nodes) into the Series/Parallel IR tree.
 *
 * Repeatedly:
 *   - parallel: two edges with the same ends become one edge holding a Parallel;
 *   - series: a node (not source or sink) with exactly one edge in and one edge out is removed and
 *     the two edges are joined.
 * until one edge from source to sink remains. If the graph gets stuck first it is not
 * series-parallel (a bridge), and the caller reports it.
 *
 * Pin-join nodes: an IEC block with several power-flow inputs (CTU's CU and RESET) is modeled as
 * per-pin wire edges into one join node, then the block edge out of it. Edges carry the pin they
 * feed, so a parallel of edges feeding different pins becomes a Parallel with `pins` (legs feed
 * different inputs of the next block instead of joining).
 */
import type { Node, Parallel, Series } from "../ir/types";

export interface SpEdge {
	from: number;
	to: number;
	/** Element drawn on this edge; undefined for a plain wire. */
	node?: Node;
	/** Block input pin this edge feeds (wire edges into a pin-join node). */
	pin?: string;
	/** Rank of that pin (0 = the block's main power input); orders the legs of a pin Parallel. */
	pinRank?: number;
	/** Document order, for ordering ordinary branch legs top to bottom. */
	order: number;
}

export type SpResult = { ok: true; body: Series } | { ok: false; reason: string };

interface PinLeg {
	pin: string;
	rank: number;
	items: Node[];
	order: number;
}

interface Work {
	from: number;
	to: number;
	items: Node[];
	order: number;
	pin?: string;
	pinRank?: number;
	/** Set when this edge is a bundle of legs feeding different pins of the block after it. */
	pinLegs?: PinLeg[];
	/** Document order of each leg when items is a single plain Parallel. */
	legOrders?: number[];
}

export function reduceSeriesParallel(edges: readonly SpEdge[], source: number, sink: number): SpResult {
	let work: Work[] = edges.map((e) => {
		const w: Work = { from: e.from, to: e.to, items: e.node ? [e.node] : [], order: e.order };
		if (e.pin !== undefined) {
			w.pin = e.pin;
			w.pinRank = e.pinRank ?? 0;
		}
		return w;
	});

	if (work.length === 0) return { ok: false, reason: "The network has no elements." };
	if (work.some((w) => w.from === w.to)) {
		return { ok: false, reason: "An element is bypassed by a plain wire (both ends on one node); this is not drawn yet." };
	}

	for (;;) {
		if (work.length === 1 && work[0]!.from === source && work[0]!.to === sink) break;
		const before = work.length;
		work = mergeParallel(work);
		work = mergeSeries(work, source, sink);
		if (work.length === before) {
			return { ok: false, reason: "The network is not series-parallel (bridge wiring); drawing it is not supported yet." };
		}
	}

	const only = work[0]!;
	return { ok: true, body: { kind: "series", items: finish(only) } };
}

function mergeParallel(work: Work[]): Work[] {
	const groups = new Map<string, Work[]>();
	for (const w of work) {
		const key = `${w.from}>${w.to}`;
		const g = groups.get(key);
		if (g) g.push(w);
		else groups.set(key, [w]);
	}
	const out: Work[] = [];
	for (const g of groups.values()) {
		let acc = g[0]!;
		for (const next of g.slice(1)) acc = parallel(acc, next);
		out.push(acc);
	}
	return out;
}

function mergeSeries(work: Work[], source: number, sink: number): Work[] {
	const ins = new Map<number, Work[]>();
	const outs = new Map<number, Work[]>();
	for (const w of work) {
		(ins.get(w.to) ?? ins.set(w.to, []).get(w.to)!).push(w);
		(outs.get(w.from) ?? outs.set(w.from, []).get(w.from)!).push(w);
	}
	for (const [v, inList] of ins) {
		if (v === source || v === sink) continue;
		const outList = outs.get(v);
		if (inList.length !== 1 || outList?.length !== 1) continue;
		const a = inList[0]!;
		const b = outList[0]!;
		if (a === b) continue;
		const joined = series(a, b);
		// One merge per pass keeps the bookkeeping simple; graphs are small.
		return [...work.filter((w) => w !== a && w !== b), joined];
	}
	return work;
}

function series(a: Work, b: Work): Work {
	const fa = finish(a);
	const fb = finish(b);
	const w: Work = { from: a.from, to: b.to, items: [...fa, ...fb], order: Math.min(a.order, b.order) };
	if (b.pin !== undefined) {
		w.pin = b.pin;
		w.pinRank = b.pinRank ?? 0;
	}
	// Joining with a plain wire keeps a lone parallel's leg order.
	const lone = fa.length === 0 ? b : fb.length === 0 ? a : undefined;
	if (lone?.legOrders && !lone.pinLegs) w.legOrders = lone.legOrders;
	return w;
}

function parallel(a: Work, b: Work): Work {
	const order = Math.min(a.order, b.order);
	const aLegs = pinLegsOf(a);
	const bLegs = pinLegsOf(b);
	if (aLegs || bLegs) {
		// Edges into a pin-join node: keep one leg per pin.
		const legs: PinLeg[] = [...(aLegs ?? [])];
		for (const leg of bLegs ?? []) {
			const same = legs.find((l) => l.pin === leg.pin);
			if (same) {
				const j = joinLegs({ items: same.items, order: same.order }, { items: leg.items, order: leg.order });
				same.items = [j.node];
				same.order = Math.min(same.order, leg.order);
			} else {
				legs.push(leg);
			}
		}
		legs.sort((x, y) => x.rank - y.rank || x.order - y.order);
		return legs.length === 1
			? { from: a.from, to: a.to, items: legs[0]!.items, order, pin: legs[0]!.pin, pinRank: legs[0]!.rank }
			: { from: a.from, to: a.to, items: [], order, pinLegs: legs };
	}
	const j = joinLegs(a, b);
	return { from: a.from, to: a.to, items: [j.node], order, legOrders: j.orders };
}

/** Pin legs of an edge that feeds pins: an existing bundle, or a single edge with a pin. */
function pinLegsOf(w: Work): PinLeg[] | undefined {
	if (w.pinLegs) return w.pinLegs.map((l) => ({ ...l }));
	if (w.pin !== undefined) return [{ pin: w.pin, rank: w.pinRank ?? 0, items: w.items, order: w.order }];
	return undefined;
}

type LegSource = { items: Node[]; order: number; legOrders?: number[] };

/** Parallel of two legs, flattening a side that is itself a plain parallel; legs in document order. */
function joinLegs(a: LegSource, b: LegSource): { node: Parallel; orders: number[] } {
	const legsOf = (x: LegSource): { s: Series; order: number }[] => {
		const only = x.items.length === 1 ? x.items[0] : undefined;
		if (only?.kind === "parallel" && !only.pins) {
			return only.legs.map((s, i) => ({ s, order: x.legOrders?.[i] ?? x.order + i * 1e-6 }));
		}
		return [{ s: { kind: "series", items: x.items }, order: x.order }];
	};
	const legs = [...legsOf(a), ...legsOf(b)].sort((x, y) => x.order - y.order);
	return { node: { kind: "parallel", legs: legs.map((l) => l.s) }, orders: legs.map((l) => l.order) };
}

/** Items of an edge, turning a pin bundle into a Parallel with pins. */
function finish(w: Work): Node[] {
	if (!w.pinLegs) return w.items;
	return [
		{
			kind: "parallel",
			legs: w.pinLegs.map((l) => ({ kind: "series", items: l.items })),
			pins: w.pinLegs.map((l) => l.pin),
		},
	];
}
