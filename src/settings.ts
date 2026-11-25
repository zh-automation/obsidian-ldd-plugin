/**
 * Plugin settings and how they combine with a block's header. Pure (no Obsidian imports) so the
 * precedence rules are unit-tested: block header, then settings, then the format's own default.
 */
import type { Align, BlockHeader, Format, Style } from "./detect";
import type { LayoutStyle } from "./layout/layout";

export interface LadderSettings {
	/** Symbol style: "match" draws Logix formats in Rockwell style and PLCopen in IEC style. */
	style: "match" | Style;
	/** Output alignment: "match" is inline for Rockwell style and right rail for IEC style. */
	align: "match" | Align;
	numbers: boolean;
	/** Wrap rungs wider than the note to further rows instead of scrolling sideways. */
	wrap: boolean;
	/** Contact and coil cell width in characters. */
	cellChars: number;
	/** Diagram size in percent. */
	scale: number;
}

export const DEFAULT_SETTINGS: LadderSettings = {
	style: "match",
	align: "match",
	numbers: true,
	wrap: true,
	cellChars: 16,
	scale: 100,
};

export const CELL_CHARS_RANGE = { min: 10, max: 32 } as const;
export const SCALE_RANGE = { min: 50, max: 200 } as const;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Settings from data.json, with unknown or out-of-range values replaced by defaults. */
export function normalizeSettings(raw: unknown): LadderSettings {
	const r = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<keyof LadderSettings, unknown>>;
	const pick = <T extends string>(v: unknown, allowed: readonly T[], d: T): T => (allowed.includes(v as T) ? (v as T) : d);
	const num = (v: unknown, d: number, lo: number, hi: number) => (typeof v === "number" && Number.isFinite(v) ? clamp(Math.round(v), lo, hi) : d);
	return {
		style: pick(r.style, ["match", "rockwell", "iec"], DEFAULT_SETTINGS.style),
		align: pick(r.align, ["match", "inline", "right"], DEFAULT_SETTINGS.align),
		numbers: typeof r.numbers === "boolean" ? r.numbers : DEFAULT_SETTINGS.numbers,
		wrap: typeof r.wrap === "boolean" ? r.wrap : DEFAULT_SETTINGS.wrap,
		cellChars: num(r.cellChars, DEFAULT_SETTINGS.cellChars, CELL_CHARS_RANGE.min, CELL_CHARS_RANGE.max),
		scale: num(r.scale, DEFAULT_SETTINGS.scale, SCALE_RANGE.min, SCALE_RANGE.max),
	};
}

export interface ResolvedStyle {
	layout: Partial<LayoutStyle> & Pick<LayoutStyle, "symbols" | "align" | "numbers" | "wrapWidth">;
	/** Number for the first rung of each section when the source has none. */
	start: number;
	/** SVG size factor (1 = 100%). */
	scale: number;
}

/**
 * Drawing style for one block. `width` is the space the block has on screen in CSS pixels
 * (0 when unknown, which turns wrapping off).
 */
export function resolveStyle(header: BlockHeader, settings: LadderSettings, format: Format, width: number): ResolvedStyle {
	const symbols: Style = header.style ?? (settings.style !== "match" ? settings.style : format === "plcopen" ? "iec" : "rockwell");
	const align: Align = header.align ?? (settings.align !== "match" ? settings.align : symbols === "iec" ? "right" : "inline");
	const scale = settings.scale / 100;
	const wrap = header.wrap ?? settings.wrap;
	return {
		layout: {
			symbols,
			align,
			numbers: header.numbers ?? settings.numbers,
			cellChars: settings.cellChars,
			wrapWidth: wrap && width > 0 ? width / scale : 0,
		},
		// CODESYS numbers networks from 1; Logix numbers rungs from 0.
		start: header.start ?? (format === "plcopen" ? 1 : 0),
		scale,
	};
}
