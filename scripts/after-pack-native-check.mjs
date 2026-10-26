// electron-builder `afterPack` hook. Fails the build when a packaged native file (`.node`, `.dll`,
// `.dylib`, `.so`) is not built for the target. A Windows cross-build on macOS once shipped the macOS
// uiohook and sherpa-onnx addons, and the app ended at launch with "not a valid Win32 application".
// Plain JavaScript, because electron-builder loads this file directly.

import { open, readdir } from "node:fs/promises";
import { join, relative } from "node:path";

const NATIVE_FILE = /\.(node|dll|dylib|so)$/u;
// electron-builder `Arch`: ia32 0, x64 1, armv7l 2, arm64 3, universal 4.
const ARCH_NAMES = ["ia32", "x64", "armv7l", "arm64", "universal"];
const PE_MACHINE = { ia32: 0x14c, x64: 0x8664, arm64: 0xaa64 };
const MACHO_CPU = { x64: 0x01000007, arm64: 0x0100000c };
const ELF_MACHINE = { ia32: 3, x64: 62, arm64: 183, armv7l: 40 };

/**
 * Names the format of a native binary from its first bytes.
 * @param {Uint8Array} bytes the start of the file; 4 KiB is enough for a PE header.
 * @returns {{ format: "pe" | "macho" | "elf" | "unknown", machine: string }}
 */
export function describeBinary(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length >= 64 && bytes[0] === 0x4d && bytes[1] === 0x5a) {
    const peOffset = view.getUint32(0x3c, true);
    if (peOffset + 6 <= bytes.length && view.getUint32(peOffset, true) === 0x00004550) {
      return { format: "pe", machine: archName(PE_MACHINE, view.getUint16(peOffset + 4, true)) };
    }
    return { format: "unknown", machine: "unknown" };
  }
  if (bytes.length >= 8) {
    const magic = view.getUint32(0, false);
    if (magic === 0xcafebabe) return { format: "macho", machine: "universal" };
    if (magic === 0xcffaedfe || magic === 0xcefaedfe) {
      return { format: "macho", machine: archName(MACHO_CPU, view.getUint32(4, true)) };
    }
  }
  if (bytes.length >= 20 && bytes[0] === 0x7f && bytes[1] === 0x45 && bytes[2] === 0x4c && bytes[3] === 0x46) {
    return { format: "elf", machine: archName(ELF_MACHINE, view.getUint16(18, bytes[5] === 1)) };
  }
  return { format: "unknown", machine: "unknown" };
}

function archName(table, value) {
  return Object.entries(table).find(([, code]) => code === value)?.[0] ?? `0x${value.toString(16)}`;
}

/**
 * The format a platform loads.
 * @param {string} platform electron-builder platform name or Node platform
 */
export function expectedFormat(platform) {
  if (platform === "win32" || platform === "windows") return "pe";
  if (platform === "darwin" || platform === "mac") return "macho";
  return "elf";
}

/**
 * Whether one binary loads on the target.
 * @param {{ format: string, machine: string }} binary
 * @param {string} platform
 * @param {string} arch
 */
export function binaryMatches(binary, platform, arch) {
  if (binary.format !== expectedFormat(platform)) return false;
  if (binary.machine === "universal") return binary.format === "macho";
  return binary.machine === arch;
}

async function* nativeFiles(root) {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) yield* nativeFiles(path);
    else if (entry.isFile() && NATIVE_FILE.test(entry.name)) yield path;
  }
}

async function readHead(path) {
  const file = await open(path, "r");
  try {
    const bytes = new Uint8Array(4096);
    const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
    return bytes.subarray(0, bytesRead);
  } finally {
    await file.close();
  }
}

/**
 * Checks every native file under `root`. Returns the files that do not match.
 * @param {string} root
 * @param {string} platform
 * @param {string} arch
 */
export async function findForeignBinaries(root, platform, arch) {
  const foreign = [];
  const checked = [];
  for await (const path of nativeFiles(root)) {
    const binary = describeBinary(await readHead(path));
    const entry = { path: relative(root, path), ...binary };
    checked.push(entry);
    if (!binaryMatches(binary, platform, arch)) foreign.push(entry);
  }
  return { checked, foreign };
}

/** @param {{ appOutDir: string, arch: number, electronPlatformName: string }} context */
export default async function afterPack(context) {
  // Only Windows is checked: the macOS build may carry universal or helper binaries on purpose.
  if (context.electronPlatformName !== "win32") return;
  const arch = ARCH_NAMES[context.arch] ?? String(context.arch);
  const { checked, foreign } = await findForeignBinaries(context.appOutDir, "win32", arch);
  for (const entry of checked) console.log(`  • native ${entry.format}/${entry.machine} ${entry.path}`);
  if (foreign.length > 0) {
    const list = foreign.map((entry) => `${entry.path} (${entry.format}/${entry.machine})`).join("\n  ");
    throw new Error(`Native files not built for win32-${arch}:\n  ${list}`);
  }
  console.log(`  • all ${checked.length} native files are PE ${arch}`);
}
