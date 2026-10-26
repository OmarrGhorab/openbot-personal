export interface BinaryDescription {
  format: "pe" | "macho" | "elf" | "unknown";
  machine: string;
}
export interface CheckedBinary extends BinaryDescription {
  path: string;
}
export function describeBinary(bytes: Uint8Array): BinaryDescription;
export function expectedFormat(platform: string): "pe" | "macho" | "elf";
export function binaryMatches(binary: BinaryDescription, platform: string, arch: string): boolean;
export function findForeignBinaries(
  root: string,
  platform: string,
  arch: string,
): Promise<{ checked: CheckedBinary[]; foreign: CheckedBinary[] }>;
export default function afterPack(context: {
  appOutDir: string;
  arch: number;
  electronPlatformName: string;
}): Promise<void>;
