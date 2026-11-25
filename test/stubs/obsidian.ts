/**
 * Minimal runtime stand-in for the "obsidian" module (which ships types only), aliased in
 * vitest.config.ts. Implements just what the plugin calls, with hooks for assertions.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

export class Component {
	private loaded = false;
	private readonly children: Component[] = [];
	private readonly cleanups: (() => void)[] = [];

	load(): void {
		if (this.loaded) return;
		this.loaded = true;
		this.onload();
		for (const c of this.children) c.load();
	}

	unload(): void {
		for (const c of this.children) c.unload();
		for (const f of this.cleanups.splice(0)) f();
		this.onunload();
		this.loaded = false;
	}

	onload(): void {}
	onunload(): void {}

	addChild<T extends Component>(child: T): T {
		this.children.push(child);
		if (this.loaded) child.load();
		return child;
	}

	registerDomEvent(el: EventTarget, type: string, cb: (evt: any) => void): void {
		el.addEventListener(type, cb);
		this.cleanups.push(() => el.removeEventListener(type, cb));
	}
}

export class MarkdownRenderChild extends Component {
	constructor(public containerEl: HTMLElement) {
		super();
	}
}

export class Plugin extends Component {
	readonly processors = new Map<string, (source: string, el: HTMLElement, ctx: any) => void>();
	readonly settingTabs: PluginSettingTab[] = [];
	stored: unknown = null;

	constructor(
		public app: any,
		public manifest: any,
	) {
		super();
	}

	registerMarkdownCodeBlockProcessor(lang: string, fn: (source: string, el: HTMLElement, ctx: any) => void): void {
		this.processors.set(lang, fn);
	}

	addSettingTab(tab: PluginSettingTab): void {
		this.settingTabs.push(tab);
	}

	async loadData(): Promise<unknown> {
		return this.stored;
	}

	async saveData(data: unknown): Promise<void> {
		this.stored = JSON.parse(JSON.stringify(data));
	}
}

export class PluginSettingTab {
	containerEl: HTMLElement;

	constructor(
		public app: any,
		public plugin: any,
	) {
		const el = document.createElement("div");
		this.containerEl = Object.assign(el, { empty: () => el.replaceChildren() });
	}
}

/** Chainable control; `change` simulates the user picking a value. */
class Control {
	value: unknown;
	options: Record<string, string> = {};
	private handler: ((v: any) => unknown) | undefined;
	addOptions(o: Record<string, string>) {
		this.options = o;
		return this;
	}
	setLimits() {
		return this;
	}
	setDynamicTooltip() {
		return this;
	}
	setValue(v: unknown) {
		this.value = v;
		return this;
	}
	onChange(f: (v: any) => unknown) {
		this.handler = f;
		return this;
	}
	change(v: unknown) {
		this.value = v;
		return this.handler?.(v);
	}
}

export class Setting {
	static all: Setting[] = [];
	name = "";
	control = new Control();

	constructor(_el: HTMLElement) {
		Setting.all.push(this);
	}
	setName(n: string) {
		this.name = n;
		return this;
	}
	setDesc() {
		return this;
	}
	addDropdown(cb: (c: Control) => unknown) {
		cb(this.control);
		return this;
	}
	addToggle(cb: (c: Control) => unknown) {
		cb(this.control);
		return this;
	}
	addSlider(cb: (c: Control) => unknown) {
		cb(this.control);
		return this;
	}
}

interface StubMenuItem {
	title: string;
	click: () => unknown;
}

export class Menu {
	static last: Menu | undefined;
	items: StubMenuItem[] = [];

	addItem(cb: (item: any) => unknown): this {
		const item = {
			title: "",
			click: (): unknown => undefined,
			setTitle(t: string) {
				this.title = t;
				return this;
			},
			setIcon() {
				return this;
			},
			onClick(f: () => unknown) {
				this.click = f;
				return this;
			},
		};
		cb(item);
		this.items.push(item);
		return this;
	}

	showAtMouseEvent(): this {
		Menu.last = this;
		return this;
	}
}

export class Notice {
	static messages: string[] = [];
	constructor(message: string) {
		Notice.messages.push(message);
	}
}
