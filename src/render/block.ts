/**
 * Code block entry point: header, format detection, parse, layout, render.
 * Plain DOM APIs only, so this runs under a test DOM as well as inside Obsidian.
 */
import { detectFormat, splitHeader, type BlockHeader, type Format } from "../detect";
import { layoutRungs, type LayoutStyle } from "../layout/layout";
import type { FrontEndResult, Section } from "../parsers/common";
import { parseL5K } from "../parsers/l5k";
import { parseL5X } from "../parsers/l5x";
import { parseNeutralText } from "../parsers/neutralText";
import { renderGeometry } from "./svg";

export interface BlockError {
	/** 1-based line within the code block source. */
	line: number;
	/** 1-based column, when known. */
	col?: number;
	message: string;
}

const FORMAT_LABELS: Record<Format, string> = {
	neutral: "Studio 5000 neutral text",
	l5x: "L5X rungs",
	l5k: "L5K routine text",
	plcopen: "PLCopen XML",
};

const PENDING: Partial<Record<Format, string>> = {
	plcopen: "M3",
};

function parseBody(format: Format, body: string): FrontEndResult | undefined {
	switch (format) {
		case "neutral": {
			const r = parseNeutralText(body);
			return { sections: r.rungs.length > 0 ? [{ rungs: r.rungs }] : [], errors: r.errors, notices: [] };
		}
		case "l5x":
			return parseL5X(body);
		case "l5k":
			return parseL5K(body);
		default:
			return undefined;
	}
}

export function renderBlock(source: string, el: HTMLElement): void {
	const doc = el.ownerDocument;
	el.replaceChildren();

	const root = doc.createElement("div");
	root.className = "ldd-block";
	el.appendChild(root);

	const split = splitHeader(source);
	const { header, body, bodyLineOffset } = split;
	const format = header.format ?? detectFormat(body);
	root.dataset.format = format;
	const errors: BlockError[] = [...split.errors];

	const parsed = parseBody(format, body);
	for (const e of parsed?.errors ?? []) errors.push({ line: e.line + bodyLineOffset, col: e.col, message: e.message });

	if (errors.length > 0) root.appendChild(renderErrors(doc, errors, source));
	for (const n of parsed?.notices ?? []) root.appendChild(note(doc, n));

	const pending = PENDING[format];
	if (pending || !parsed) {
		root.appendChild(note(doc, `${FORMAT_LABELS[format]} detected. Rendering for this format arrives in ${pending ?? "a later version"}.`));
		return;
	}
	if (parsed.sections.length === 0) {
		if (errors.length === 0 && parsed.notices.length === 0) root.appendChild(note(doc, "No rungs found."));
		return;
	}

	const style = styleFor(header);
	const start = header.start ?? 0;
	for (const section of parsed.sections) renderSection(doc, root, section, start, style);
}

function renderSection(doc: Document, root: HTMLElement, section: Section, start: number, style: Partial<LayoutStyle>): void {
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
	rungs.forEach((r, i) => {
		if (r.number === undefined) r.number = start + i;
	});
	const geometry = layoutRungs(rungs, style);
	const where = section.title ? `, ${section.title}` : "";
	const label = `Ladder diagram${where}, ${rungs.length} rung${rungs.length === 1 ? "" : "s"}`;
	root.appendChild(renderGeometry(doc, geometry, label));
}

function styleFor(header: BlockHeader): Partial<LayoutStyle> {
	const style: Partial<LayoutStyle> = {};
	if (header.numbers !== undefined) style.numbers = header.numbers;
	if (header.align !== undefined) style.align = header.align;
	return style;
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
