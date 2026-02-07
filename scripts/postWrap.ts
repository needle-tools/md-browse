import { readdirSync, readFileSync, writeFileSync, rmSync, cpSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import tar from "tar";
import { ZstdInit } from "@oneidentity/zstd-js/wasm";

const wrapperBundlePath = process.env.ELECTROBUN_WRAPPER_BUNDLE_PATH;
const targetOS = process.env.ELECTROBUN_OS;

if (!wrapperBundlePath || targetOS !== "macos") {
  process.exit(0);
}

const resourcesDir = join(wrapperBundlePath, "Contents", "Resources");
const zstFile = readdirSync(resourcesDir).find((name) => name.endsWith(".tar.zst"));

if (!zstFile) {
  console.log("[postWrap] No .tar.zst found in wrapper Resources; skipping.");
  process.exit(0);
}

const zstPath = join(resourcesDir, zstFile);
const zstData = readFileSync(zstPath);
const tempDir = mkdtempSync(join(tmpdir(), "electrobun-wrapper-"));
const tarPath = join(tempDir, "bundle.tar");

const { ZstdSimple } = await ZstdInit();
const tarData = ZstdSimple.decompress(new Uint8Array(zstData));
writeFileSync(tarPath, tarData);

await tar.x({ file: tarPath, cwd: tempDir });

const extractedAppName = readdirSync(tempDir).find((name) => name.endsWith(".app"));
if (!extractedAppName) {
  throw new Error("[postWrap] Failed to locate extracted .app bundle.");
}

const extractedContents = join(tempDir, extractedAppName, "Contents");
const wrapperContents = join(wrapperBundlePath, "Contents");

rmSync(wrapperContents, { recursive: true, force: true });
cpSync(extractedContents, wrapperContents, { recursive: true, dereference: true });

rmSync(tempDir, { recursive: true, force: true });

console.log("[postWrap] Rehydrated wrapper bundle to standard app layout for macOS compatibility.");
