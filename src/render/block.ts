/**
 * Code block entry point: header, format detection, parse, layout, render.
 * Plain DOM APIs only, so this runs under a test DOM as well as inside Obsidian.
 *
 * Parsing happens once per source text (and is cached across re-renders); laying out again for a
 * new width or new settings reuses the parsed rungs.
 */
import { detectFormat, splitHeader, type Format } from "../detect";
import { layoutRungs } from "../layout/layout";
import type { FrontEndResult, Section } from "../parsers/common";
import { parseL5K } from "../parsers/l5k";
import { parseL5X } from "../parsers/l5x";
import { parseNeutralText } from "../parsers/neutralText";
import { parsePLCopen } from "../parsers/plcopen";
import { DEFAULT_SETTINGS, resolveStyle, type LadderSettings, type ResolvedStyle } from "../settings";
import { renderGeometry } from "./svg";

export interface BlockError {
	/** 1-based line within the code block source. */
	line: number;
	/** 1-based column, when known. */
	col?: number;
	message: string;
}

function parseBody(format: Format, body: string): FrontEndResult {
	switch (format) {
		case "neutral": {
			const r = parseNeutralText(body);
			return { sections: r.rungs.length > 0 ? [{ rungs: r.rungs }] : [], errors: r.errors, notices: [] };
		}
		case "l5x":
			return parseL5X(body);
		case "l5k":
			return parseL5K(body);
		case "plcopen":
			return parsePLCopen(body);
	}
}

/** Parsed results keyed by format and body, so re-renders (Live Preview, resize) skip parsing. */
const PARSE_CACHE_SIZE = 16;
const parseCache = new Map<string, FrontEndResult>();

function parseCached(format: Format, body: string): FrontEndResult {
	const key = `${format}\u0000${body}`;
	const hit = parseCache.get(key);
	if (hit) {
		parseCache.delete(key);
		parseCache.set(key, hit);
		return hit;
	}
	const parsed = parseBody(format, body);
	parseCache.set(key, parsed);
	if (parseCache.size > PARSE_CACHE_SIZE) parseCache.delete(parseCache.keys().next().value ?? "");
	return parsed;
}

export interface BlockOptions {
	settings?: LadderSettings;
	/** Width available on screen in CSS pixels; 0 or absent turns wrapping off. */
	width?: number;
}

export interface RenderedBlock {
	/** Lay the diagrams out again for a new width (cheap: no parsing). */
	relayout(width: number): void;
}

/** Widths closer than this are treated as unchanged, so small jitters do not redraw. */
const WIDTH_STEP = 8;

export function renderBlock(source: string, el: HTMLElement, options: BlockOptions = {}): RenderedBlock {
	const doc = el.ownerDocument;
	const settings = options.settings ?? DEFAULT_SETTINGS;
	el.replaceChildren();

	const root = doc.createElement("div");
	root.className = "ldd-block";
	el.appendChild(root);

	const split = splitHeader(source);
	const { header, body, bodyLineOffset } = split;
	const format = header.format ?? detectFormat(body);
	root.dataset.format = format;
	const errors: BlockError[] = [...split.errors];

	const parsed = parseCached(format, body);
	for (const e of parsed.errors) errors.push({ line: e.line + bodyLineOffset, col: e.col, message: e.message });

	if (errors.length > 0) root.appendChild(renderErrors(doc, errors, source));
	for (const n of parsed.notices) root.appendChild(note(doc, n));

	if (parsed.sections.length === 0) {
		if (errors.length === 0 && parsed.notices.length === 0) root.appendChild(note(doc, "No rungs found."));
		return { relayout: () => undefined };
	}

	const diagrams = doc.createElement("div");
	diagrams.className = "ldd-diagrams";
	root.appendChild(diagrams);

	let drawnWidth = -1;
	const draw = (width: number) => {
		drawnWidth = width;
		const style = resolveStyle(header, settings, format, width);
		root.dataset.style = style.layout.symbols;
		diagrams.replaceChildren();
		for (const section of parsed.sections) renderSection(doc, diagrams, section, style);
	};
	draw(options.width ?? 0);

	return {
		relayout(width: number) {
			if (Math.abs(width - drawnWidth) < WIDTH_STEP) return;
			draw(width);
		},
	};
}

function renderSection(doc: Document, root: HTMLElement, section: Section, style: ResolvedStyle): void {
	if (section.title) {
		const h = doc.createElement("div");
		h.className = "ldd-section-title";
		h.textContent = section.title;
		root.appendChild(h);
	}
	const { rungs } = section;
	if (rungs.length === 0) {
		root.appendChild(note(doc, "No rungs."));
		return;
	}
	// Parsed rungs are shared through the cache: number copies, never the originals.
	const numbered = rungs.map((r, i) => (r.number === undefined ? { ...r, number: style.start + i } : r));
	const geometry = layoutRungs(numbered, style.layout);
	const where = section.title ? `, ${section.title}` : "";
	const label = `Ladder diagram${where}, ${rungs.length} rung${rungs.length === 1 ? "" : "s"}`;
	root.appendChild(renderGeometry(doc, geometry, label, style.scale));
}

function note(doc: Document, text: string): HTMLElement {
	const div = doc.createElement("div");
	div.className = "ldd-note";
	div.textContent = text;
	return div;
}

const SNIPPET_RADIUS = 40;

function renderErrors(doc: Document, errors: BlockError[], source: string): HTMLElement {
	const lines = source.replace(/^﻿/, "").split(/\r?\n/);
	const box = doc.createElement("div");
	box.className = "ldd-error";
	for (const e of errors) {
		const item = doc.createElement("div");
		item.className = "ldd-error-item";
		const msg = doc.createElement("div");
		msg.textContent = e.col !== undefined ? `Line ${e.line}, col ${e.col}: ${e.message}` : `Line ${e.line}: ${e.message}`;
		item.appendChild(msg);

		const text = lines[e.line - 1];
		if (e.col !== undefined && text !== undefined) {
			const pre = doc.createElement("pre");
			pre.className = "ldd-error-src";
			pre.textContent = caretSnippet(text, e.col);
			item.appendChild(pre);
		}
		box.appendChild(item);
	}
	return box;
}

/** Source line (windowed around the column for long lines) with a caret under the column. */
export function caretSnippet(line: string, col: number): string {
	const flat = line.replace(/\t/g, " ");
	const idx = Math.max(0, Math.min(col - 1, flat.length));
	const from = Math.max(0, idx - SNIPPET_RADIUS);
	const to = Math.min(flat.length, idx + SNIPPET_RADIUS);
	const prefix = from > 0 ? "..." : "";
	const suffix = to < flat.length ? "..." : "";
	const shown = prefix + flat.slice(from, to) + suffix;
	const caretAt = prefix.length + (idx - from);
	return `${shown}\n${" ".repeat(caretAt)}^`;
}
