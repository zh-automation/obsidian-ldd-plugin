import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, normalizeSettings, resolveStyle, type LadderSettings } from "../src/settings";

const settings = (patch: Partial<LadderSettings> = {}): LadderSettings => ({ ...DEFAULT_SETTINGS, ...patch });

describe("normalizeSettings", () => {
	it("returns defaults for missing or broken data", () => {
		expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
		expect(normalizeSettings("nonsense")).toEqual(DEFAULT_SETTINGS);
		expect(normalizeSettings({ style: "fancy", numbers: "yes", scale: Number.NaN })).toEqual(DEFAULT_SETTINGS);
	});

	it("keeps valid values and clamps numbers into range", () => {
		expect(normalizeSettings({ style: "iec", align: "inline", wrap: false, cellChars: 99, scale: 10.4 })).toEqual({
			...DEFAULT_SETTINGS,
			style: "iec",
			align: "inline",
			wrap: false,
			cellChars: 32,
			scale: 50,
		});
	});
});

describe("resolveStyle precedence: header, then settings, then format", () => {
	it("matches the source by default", () => {
		const logix = resolveStyle({}, settings(), "neutral", 0);
		expect([logix.layout.symbols, logix.layout.align, logix.start]).toEqual(["rockwell", "inline", 0]);
		const iec = resolveStyle({}, settings(), "plcopen", 0);
		expect([iec.layout.symbols, iec.layout.align, iec.start]).toEqual(["iec", "right", 1]);
	});

	it("applies settings over the format default, and alignment follows the chosen style", () => {
		const r = resolveStyle({}, settings({ style: "iec" }), "l5x", 0);
		expect([r.layout.symbols, r.layout.align]).toEqual(["iec", "right"]);
		const a = resolveStyle({}, settings({ style: "iec", align: "inline" }), "l5x", 0);
		expect(a.layout.align).toBe("inline");
	});

	it("lets the block header override settings", () => {
		const r = resolveStyle({ style: "rockwell", align: "right", numbers: false, start: 7 }, settings({ style: "iec", numbers: true }), "plcopen", 0);
		expect([r.layout.symbols, r.layout.align, r.layout.numbers, r.start]).toEqual(["rockwell", "right", false, 7]);
	});

	it("wraps to the screen width divided by the diagram scale, unless wrapping is off", () => {
		expect(resolveStyle({}, settings({ scale: 200 }), "neutral", 800).layout.wrapWidth).toBe(400);
		expect(resolveStyle({}, settings({ wrap: false }), "neutral", 800).layout.wrapWidth).toBe(0);
		expect(resolveStyle({ wrap: true }, settings({ wrap: false }), "neutral", 800).layout.wrapWidth).toBe(800);
		expect(resolveStyle({ wrap: false }, settings(), "neutral", 800).layout.wrapWidth).toBe(0);
		expect(resolveStyle({}, settings(), "neutral", 0).layout.wrapWidth).toBe(0);
	});
});
