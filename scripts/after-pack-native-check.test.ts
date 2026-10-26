import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import afterPack, { binaryMatches, describeBinary, findForeignBinaries } from "./after-pack-native-check.mjs";

function pe(machine: number): Uint8Array {
  const bytes = new Uint8Array(256);
  const view = new DataView(bytes.buffer);
  bytes[0] = 0x4d;
  bytes[1] = 0x5a;
  view.setUint32(0x3c, 0x80, true);
  view.setUint32(0x80, 0x00004550, true);
  view.setUint16(0x84, machine, true);
  return bytes;
}

function macho(cpu: number): Uint8Array {
  const bytes = new Uint8Array(32);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0xcffaedfe, false);
  view.setUint32(4, cpu, true);
  return bytes;
}

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("after-pack native check", () => {
  it("reads PE, Mach-O and ELF headers", () => {
    expect(describeBinary(pe(0x8664))).toEqual({ format: "pe", machine: "x64" });
    expect(describeBinary(pe(0xaa64))).toEqual({ format: "pe", machine: "arm64" });
    expect(describeBinary(macho(0x01000007))).toEqual({ format: "macho", machine: "x64" });
    const elf = new Uint8Array(32);
    elf.set([0x7f, 0x45, 0x4c, 0x46, 2, 1]);
    new DataView(elf.buffer).setUint16(18, 62, true);
    expect(describeBinary(elf)).toEqual({ format: "elf", machine: "x64" });
    expect(describeBinary(new Uint8Array(4))).toEqual({ format: "unknown", machine: "unknown" });
  });

  it("accepts only PE x64 for a Windows x64 build", () => {
    expect(binaryMatches({ format: "pe", machine: "x64" }, "win32", "x64")).toBe(true);
    expect(binaryMatches({ format: "pe", machine: "arm64" }, "win32", "x64")).toBe(false);
    expect(binaryMatches({ format: "macho", machine: "x64" }, "win32", "x64")).toBe(false);
  });

  it("fails a Windows pack that holds a macOS addon, and passes a clean one", async () => {
    const root = await mkdtemp(join(tmpdir(), "after-pack-"));
    roots.push(root);
    const nested = join(root, "resources/app.asar.unpacked/node_modules/uiohook-napi/build/Release");
    await mkdir(nested, { recursive: true });
    await writeFile(join(root, "resources/onnxruntime.dll"), pe(0x8664));
    await writeFile(join(root, "readme.txt"), "not native");
    expect((await findForeignBinaries(root, "win32", "x64")).foreign).toEqual([]);
    await afterPack({ appOutDir: root, arch: 1, electronPlatformName: "win32" });

    await writeFile(join(nested, "uiohook_napi.node"), macho(0x01000007));
    const { foreign } = await findForeignBinaries(root, "win32", "x64");
    expect(foreign.map((entry) => entry.path)).toEqual([
      join("resources/app.asar.unpacked/node_modules/uiohook-napi/build/Release", "uiohook_napi.node"),
    ]);
    await expect(afterPack({ appOutDir: root, arch: 1, electronPlatformName: "win32" })).rejects.toThrow(
      /not built for win32-x64/u,
    );
    await expect(afterPack({ appOutDir: root, arch: 1, electronPlatformName: "darwin" })).resolves.toBeUndefined();
  });
});
