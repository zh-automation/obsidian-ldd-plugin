/**
 * Code block pre-processing: optional `---` header and input format detection.
 */

export type Format = "neutral" | "l5x" | "l5k" | "plcopen";
export type Style = "rockwell" | "iec";
export type Align = "inline" | "right";

export interface BlockHeader {
	format?: Format;
	style?: Style;
	start?: number;
	numbers?: boolean;
	align?: Align;
	wrap?: boolean;
}

export interface BlockMessage {
	/** 1-based line within the code block source. */
	line: number;
	message: string;
}

export interface SplitResult {
	header: BlockHeader;
	body: string;
	/** Number of source lines before the body (header lines included), for mapping body line numbers back. */
	bodyLineOffset: number;
	errors: BlockMessage[];
}

const FORMATS: readonly Format[] = ["neutral", "l5x", "l5k", "plcopen"];
const STYLES: readonly Style[] = ["rockwell", "iec"];
const ALIGNS: readonly Align[] = ["inline", "right"];
const BOOL_TRUE = ["on", "true", "yes"];
const BOOL_FALSE = ["off", "false", "no"];

function oneOf<T extends string>(value: string, allowed: readonly T[]): T | undefined {
	return (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

/**
 * Split an optional header off the top of a code block. The header is the region between a first
 * line of `---` and the next `---` line, holding `key: value` pairs.
 */
export function splitHeader(source: string): SplitResult {
	const text = source.replace(/^﻿/, "");
	const lines = text.split(/\r?\n/);
	const header: BlockHeader = {};
	const errors: BlockMessage[] = [];

	if (lines[0]?.trim() !== "---") {
		return { header, body: text, bodyLineOffset: 0, errors };
	}

	const close = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
	if (close === -1) {
		errors.push({ line: 1, message: "Header opened with '---' but never closed." });
		return { header, body: text, bodyLineOffset: 0, errors };
	}

	for (let i = 1; i < close; i++) {
		const raw = lines[i] ?? "";
		const lineNo = i + 1;
		if (raw.trim() === "" || raw.trim().startsWith("#")) continue;
		const m = /^\s*([A-Za-z]+)\s*:\s*(.*?)\s*$/.exec(raw);
		if (!m) {
			errors.push({ line: lineNo, message: `Expected 'key: value', got '${raw.trim()}'.` });
			continue;
		}
		const key = (m[1] ?? "").toLowerCase();
		const value = (m[2] ?? "").toLowerCase();
		switch (key) {
			case "format": {
				const v = oneOf(value, FORMATS);
				if (v) header.format = v;
				else errors.push({ line: lineNo, message: `format must be one of ${FORMATS.join(", ")}.` });
				break;
			}
			case "style": {
				const v = oneOf(value, STYLES);
				if (v) header.style = v;
				else errors.push({ line: lineNo, message: `style must be one of ${STYLES.join(", ")}.` });
				break;
			}
			case "align": {
				const v = oneOf(value, ALIGNS);
				if (v) header.align = v;
				else errors.push({ line: lineNo, message: `align must be one of ${ALIGNS.join(", ")}.` });
				break;
			}
			case "start": {
				if (/^\d+$/.test(value)) header.start = Number(value);
				else errors.push({ line: lineNo, message: "start must be a whole number." });
				break;
			}
			case "numbers":
			case "wrap": {
				if (BOOL_TRUE.includes(value)) header[key] = true;
				else if (BOOL_FALSE.includes(value)) header[key] = false;
				else errors.push({ line: lineNo, message: `${key} must be on or off.` });
				break;
			}
			default:
				errors.push({ line: lineNo, message: `Unknown header key '${m[1]}'.` });
		}
	}

	return {
		header,
		body: lines.slice(close + 1).join("\n"),
		bodyLineOffset: close + 1,
		errors,
	};
}

/**
 * Guess the input format from the block body.
 *
 * - XML mentioning Rockwell rung elements -> L5X
 * - any other XML -> PLCopen
 * - lines starting `N:` or `RC:` -> L5K
 * - otherwise -> neutral text
 */
export function detectFormat(body: string): Format {
	const text = body.replace(/^﻿/, "").trimStart();
	if (text.startsWith("<")) {
		return /<(RSLogix5000Content|RLLContent|Rung)\b/.test(text) ? "l5x" : "plcopen";
	}
	if (/^\s*(N|RC)\s*:/m.test(text)) return "l5k";
	return "neutral";
}
