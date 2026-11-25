import { PluginSettingTab, Setting, type App } from "obsidian";
import type LadderLogicPlugin from "./main";
import { CELL_CHARS_RANGE, DEFAULT_SETTINGS, SCALE_RANGE, type LadderSettings } from "./settings";

export class LadderSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private readonly plugin: LadderLogicPlugin,
	) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		const s = this.plugin.settings;
		const save = async (patch: Partial<LadderSettings>) => {
			Object.assign(this.plugin.settings, patch);
			await this.plugin.saveSettings();
		};

		new Setting(containerEl)
			.setName("Symbol style")
			.setDesc("Match source draws Studio 5000 text, L5X, and L5K in Rockwell style and PLCopen in IEC style. A block's style: header wins.")
			.addDropdown((d) =>
				d
					.addOptions({ match: "Match source", rockwell: "Rockwell (] [ )", iec: "IEC (| |)" })
					.setValue(s.style)
					.onChange((v) => save({ style: v as LadderSettings["style"] })),
			);

		new Setting(containerEl)
			.setName("Output position")
			.setDesc("Match style puts outputs right after the last input in Rockwell style and against the right rail in IEC style.")
			.addDropdown((d) =>
				d
					.addOptions({ match: "Match style", inline: "After the last input", right: "Against the right rail" })
					.setValue(s.align)
					.onChange((v) => save({ align: v as LadderSettings["align"] })),
			);

		new Setting(containerEl)
			.setName("Rung numbers")
			.setDesc("Show rung and network numbers in the left margin.")
			.addToggle((t) => t.setValue(s.numbers).onChange((v) => save({ numbers: v })));

		new Setting(containerEl)
			.setName("Wrap long rungs")
			.setDesc("Continue rungs wider than the note on the next row, marked >>. Off scrolls them sideways. A block's wrap: header wins.")
			.addToggle((t) => t.setValue(s.wrap).onChange((v) => save({ wrap: v })));

		new Setting(containerEl)
			.setName("Cell width")
			.setDesc(`Characters per contact and coil cell; longer tag names wrap. Default ${DEFAULT_SETTINGS.cellChars}.`)
			.addSlider((sl) =>
				sl
					.setLimits(CELL_CHARS_RANGE.min, CELL_CHARS_RANGE.max, 1)
					.setValue(s.cellChars)
					.setDynamicTooltip()
					.onChange((v) => save({ cellChars: v })),
			);

		new Setting(containerEl)
			.setName("Diagram size")
			.setDesc(`Percent of normal size. Default ${DEFAULT_SETTINGS.scale}.`)
			.addSlider((sl) =>
				sl
					.setLimits(SCALE_RANGE.min, SCALE_RANGE.max, 10)
					.setValue(s.scale)
					.setDynamicTooltip()
					.onChange((v) => save({ scale: v })),
			);
	}
}
