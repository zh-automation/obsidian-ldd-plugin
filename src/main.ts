import { Plugin } from "obsidian";
import { renderBlock } from "./render/block";

/** Code fence languages handled by this plugin. */
export const FENCE_LANGUAGES = ["ladder", "ldd"] as const;

export default class LadderLogicPlugin extends Plugin {
	override async onload(): Promise<void> {
		for (const lang of FENCE_LANGUAGES) {
			this.registerMarkdownCodeBlockProcessor(lang, (source, el) => {
				renderBlock(source, el);
			});
		}
	}
}
