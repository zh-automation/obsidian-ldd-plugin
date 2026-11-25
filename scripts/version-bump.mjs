/**
 * Run by `npm version <x.y.z>` (the "version" script in package.json): copies the new version into
 * manifest.json and adds it to versions.json with the current minAppVersion, so the git tag, the
 * release, and manifest.json agree. .npmrc sets tag-version-prefix="" (Obsidian tags have no "v").
 */
import { readFileSync, writeFileSync } from "node:fs";
import process from "node:process";

const version = process.env.npm_package_version;
if (!version) {
	console.error("Run this through `npm version <x.y.z>`, which sets npm_package_version.");
	process.exit(1);
}

const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
manifest.version = version;
writeFileSync("manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);

const versions = JSON.parse(readFileSync("versions.json", "utf8"));
versions[version] = manifest.minAppVersion;
writeFileSync("versions.json", `${JSON.stringify(versions, null, 2)}\n`);

console.log(`manifest.json and versions.json set to ${version} (minAppVersion ${manifest.minAppVersion})`);
