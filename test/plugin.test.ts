// @vitest-environment happy-dom
/**
 * Plugin wiring against the Obsidian stand-in (test/stubs/obsidian.ts): code block registration,
 * render children, the copy menu, settings, and cleanup.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as stub from "./stubs/obsidian";
import LadderLogicPlugin, { FENCE_LANGUAGES } from "../src/main";
import { DEFAULT_SETTINGS } from "../src/settings";

type StubPlugin = LadderLogicPlugin & stub.Plugin;

async function loadPlugin(stored: unknown = null): Promise<StubPlugin> {
	const plugin = new LadderLogicPlugin({} as never, {} as never) as StubPlugin;
	plugin.stored = stored;
	await plugin.onload();
	return plugin;
}

/** Run the code block processor the way Obsidian does, with a loaded parent component. */
function renderInto(plugin: StubPlugin, source: string, lang = "ladder") {
	const el = document.createElement("div");
	document.body.appendChild(el);
	const parent = new stub.Component();
	parent.load();
	plugin.processors.get(lang)?.(source, el, { addChild: (c: stub.Component) => parent.addChild(c) });
	return { el, parent };
}

describe("plugin", () => {
	beforeEach(() => {
		stub.Notice.messages = [];
		stub.Setting.all = [];
		stub.Menu.last = undefined;
		document.body.replaceChildren();
	});

	it("registers both fence languages and loads normalized settings", async () => {
		const plugin = await loadPlugin({ style: "iec", scale: 999 });
		expect([...plugin.processors.keys()]).toEqual([...FENCE_LANGUAGES]);
		expect(plugin.settings).toEqual({ ...DEFAULT_SETTINGS, style: "iec", scale: 200 });
	});

	it("renders a block and tracks it until it is unloaded", async () => {
		const plugin = await loadPlugin();
		const { el, parent } = renderInto(plugin, "XIC(A)OTE(B);", "ldd");
		expect(el.querySelector("svg.ldd-svg")).not.toBeNull();
		expect(plugin.blocks.size).toBe(1);
		parent.unload();
		expect(plugin.blocks.size).toBe(0);
	});

	it("re-renders open blocks when settings change", async () => {
		const plugin = await loadPlugin();
		const { el } = renderInto(plugin, "XIC(A)OTE(B);");
		expect((el.querySelector(".ldd-block") as HTMLElement).dataset.style).toBe("rockwell");
		plugin.settings.style = "iec";
		await plugin.saveSettings();
		expect((el.querySelector(".ldd-block") as HTMLElement).dataset.style).toBe("iec");
		expect(plugin.stored).toMatchObject({ style: "iec" });
	});

	it("offers copy SVG, copy PNG, and copy source on right-click", async () => {
		const plugin = await loadPlugin();
		const writeText = vi.fn(async (_text: string) => undefined);
		Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
		const { el } = renderInto(plugin, "XIC(A)OTE(B);");

		el.querySelector("svg")!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
		const items = stub.Menu.last?.items ?? [];
		expect(items.map((i) => i.title)).toEqual(["Copy diagram as SVG", "Copy diagram as PNG", "Copy ladder source"]);

		await items[2]!.click();
		expect(writeText).toHaveBeenLastCalledWith("XIC(A)OTE(B);");
		await items[0]!.click();
		const calls = writeText.mock.calls;
		expect(calls[calls.length - 1]?.[0]).toContain('xmlns="http://www.w3.org/2000/svg"');
		expect(stub.Notice.messages).toEqual(["Ladder source copied.", "Diagram copied as SVG."]);
	});

	it("builds the settings tab, and changes there re-render blocks", async () => {
		const plugin = await loadPlugin();
		const { el } = renderInto(plugin, "XIC(A)OTE(B);");
		const tab = plugin.settingTabs[0] as unknown as { display(): void };
		tab.display();
		expect(stub.Setting.all.map((s) => s.name)).toEqual([
			"Symbol style",
			"Output position",
			"Rung numbers",
			"Wrap long rungs",
			"Cell width",
			"Diagram size",
		]);
		await stub.Setting.all[2]!.control.change(false);
		expect(el.querySelectorAll("text.ldd-num")).toHaveLength(0);
		expect(plugin.stored).toMatchObject({ numbers: false });
	});
});
