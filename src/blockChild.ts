/**
 * One rendered ladder code block inside Obsidian: renders it, re-lays it out when its width
 * changes (rung wrapping), re-renders when settings change, and offers a copy menu. Registered
 * with the post-processor context so everything is cleaned up when the block goes away.
 */
import { MarkdownRenderChild, Menu, Notice } from "obsidian";
import type LadderLogicPlugin from "./main";
import { renderBlock, type RenderedBlock } from "./render/block";
import { standaloneSvg, svgToPng, themeBackground } from "./render/export";

export class LadderBlockChild extends MarkdownRenderChild {
	private rendered: RenderedBlock | undefined;
	private observer: ResizeObserver | undefined;
	private frame = 0;

	constructor(
		containerEl: HTMLElement,
		private readonly source: string,
		private readonly plugin: LadderLogicPlugin,
	) {
		super(containerEl);
	}

	override onload(): void {
		this.plugin.blocks.add(this);
		if (!this.rendered) this.render();
		if (typeof ResizeObserver !== "undefined") {
			this.observer = new ResizeObserver(() => this.scheduleRelayout());
			this.observer.observe(this.containerEl);
		}
		this.registerDomEvent(this.containerEl, "contextmenu", (evt) => this.showMenu(evt));
	}

	override onunload(): void {
		this.observer?.disconnect();
		if (this.frame) cancelAnimationFrame(this.frame);
		this.plugin.blocks.delete(this);
	}

	/** Full render with current settings (also used when settings change). */
	render(): void {
		this.rendered = renderBlock(this.source, this.containerEl, {
			settings: this.plugin.settings,
			width: this.containerEl.clientWidth,
		});
	}

	private scheduleRelayout(): void {
		if (this.frame) return;
		this.frame = requestAnimationFrame(() => {
			this.frame = 0;
			this.rendered?.relayout(this.containerEl.clientWidth);
		});
	}

	private showMenu(evt: MouseEvent): void {
		const target = evt.target instanceof Element ? evt.target : null;
		const svg = (target?.closest("svg.ldd-svg") ?? this.containerEl.querySelector("svg.ldd-svg")) as SVGSVGElement | null;
		const menu = new Menu();
		if (svg) {
			menu.addItem((item) =>
				item
					.setTitle("Copy diagram as SVG")
					.setIcon("copy")
					.onClick(() => void this.copySvg(svg)),
			);
			menu.addItem((item) =>
				item
					.setTitle("Copy diagram as PNG")
					.setIcon("image")
					.onClick(() => void this.copyPng(svg)),
			);
		}
		menu.addItem((item) =>
			item
				.setTitle("Copy ladder source")
				.setIcon("file-code")
				.onClick(() => void this.copyText(this.source, "Ladder source copied.")),
		);
		menu.showAtMouseEvent(evt);
		evt.preventDefault();
	}

	private async copySvg(svg: SVGSVGElement): Promise<void> {
		await this.copyText(standaloneSvg(svg, themeBackground(svg)), "Diagram copied as SVG.");
	}

	private async copyPng(svg: SVGSVGElement): Promise<void> {
		if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) {
			new Notice("Copying images is not supported on this device.");
			return;
		}
		try {
			const background = themeBackground(svg);
			const width = Number(svg.getAttribute("width")) || svg.clientWidth;
			const height = Number(svg.getAttribute("height")) || svg.clientHeight;
			const png = await svgToPng(svg.ownerDocument, standaloneSvg(svg, background), width, height, background);
			await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
			new Notice("Diagram copied as PNG.");
		} catch (e) {
			new Notice(`Could not copy the diagram: ${e instanceof Error ? e.message : String(e)}`);
		}
	}

	private async copyText(text: string, done: string): Promise<void> {
		try {
			await navigator.clipboard.writeText(text);
			new Notice(done);
		} catch (e) {
			new Notice(`Could not copy: ${e instanceof Error ? e.message : String(e)}`);
		}
	}
}
