import { Plugin } from "obsidian";
import { LadderBlockChild } from "./blockChild";
import { DEFAULT_SETTINGS, normalizeSettings, type LadderSettings } from "./settings";
import { LadderSettingTab } from "./settingsTab";

/** Code fence languages handled by this plugin. */
export const FENCE_LANGUAGES = ["ladder", "ldd"] as const;

export default class LadderLogicPlugin extends Plugin {
	settings: LadderSettings = { ...DEFAULT_SETTINGS };
	/** Blocks currently on screen, re-rendered when settings change. */
	readonly blocks = new Set<LadderBlockChild>();

	override async onload(): Promise<void> {
		this.settings = normalizeSettings(await this.loadData());
		this.addSettingTab(new LadderSettingTab(this.app, this));
		for (const lang of FENCE_LANGUAGES) {
			this.registerMarkdownCodeBlockProcessor(lang, (source, el, ctx) => {
				const child = new LadderBlockChild(el, source, this);
				// Draw right away; the child adds resize handling and the menu once it loads.
				child.render();
				ctx.addChild(child);
			});
		}
	}

	override onunload(): void {
		this.blocks.clear();
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		for (const block of this.blocks) block.render();
	}
}
