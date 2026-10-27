// The sealed-secret envelope of `instance-transfer-v3`: X25519 to agree a key, HKDF-SHA256 to turn
// it into one AES-256-GCM key per item, and the migration id and item id as associated data. The
// target's private key lives in memory only, for one migration, and for five minutes.
//
// Nothing here logs, and every failure reads the same to the caller: a wrong key, a changed item and
// a truncated envelope all return null or throw one sentence with no value in it.

import {
  createCipheriv,
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
} from "node:crypto";
import { INSTANCE_TRANSFER_SECRET_LIMITS } from "@openbot/contracts/ipc";

/** The DER prefixes of a raw X25519 key: PKCS#8 for a private key, SubjectPublicKeyInfo for a public one. */
const PKCS8_PREFIX = Buffer.from("302e020100300506032b656e04220420", "hex");
const SPKI_PREFIX = Buffer.from("302a300506032b656e032100", "hex");

const KEY_BYTES = 32;
const SALT_BYTES = 16;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const MAX_KEYS = 64;

export interface SecretKeyPair {
  /** Base64 raw X25519 public key. */
  publicKey: string;
  privateKey: Buffer;
}

export interface SealedValue {
  /** The source's ephemeral public key, base64. */
  publicKey: string;
  salt: string;
  nonce: string;
  ciphertext: string;
}

function fromBase64(value: string, expected: number | null): Buffer {
  if (!/^[A-Za-z0-9+/]*={0,2}$/u.test(value)) throw new Error("Invalid sealed secret.");
  const bytes = Buffer.from(value, "base64");
  if ((expected !== null && bytes.length !== expected) || bytes.toString("base64") !== value)
    throw new Error("Invalid sealed secret.");
  return bytes;
}

function rawPrivate(privateKey: Buffer) {
  return createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, privateKey]), format: "der", type: "pkcs8" });
}

function rawPublic(publicKey: Buffer) {
  return createPublicKey({ key: Buffer.concat([SPKI_PREFIX, publicKey]), format: "der", type: "spki" });
}

/** The same bytes are the key derivation info and the AES-GCM associated data. */
function context(migrationId: string, id: string): Buffer {
  return Buffer.from(`openbot-instance-transfer-v3\n${migrationId}\n${id}`, "utf8");
}

export function createSecretKeyPair(): SecretKeyPair {
  const pair = generateKeyPairSync("x25519");
  const publicKey = pair.publicKey.export({ format: "der", type: "spki" }).subarray(SPKI_PREFIX.length);
  const privateKey = pair.privateKey.export({ format: "der", type: "pkcs8" }).subarray(PKCS8_PREFIX.length);
  return { publicKey: publicKey.toString("base64"), privateKey };
}

/** True for a base64 raw X25519 public key, which is what a target publishes. */
export function isSecretPublicKey(value: string): boolean {
  try {
    fromBase64(value, KEY_BYTES);
    return true;
  } catch {
    return false;
  }
}

/** Encrypts one payload to the target's public key. Each item gets its own ephemeral key and salt. */
export function sealValue(plaintext: Buffer, targetPublicKey: string, migrationId: string, id: string): SealedValue {
  const pair = createSecretKeyPair();
  let shared: Buffer | null = null;
  let key: Buffer | null = null;
  try {
    shared = diffieHellman({
      privateKey: rawPrivate(pair.privateKey),
      publicKey: rawPublic(fromBase64(targetPublicKey, KEY_BYTES)),
    });
    const salt = randomBytes(SALT_BYTES);
    const info = context(migrationId, id);
    key = Buffer.from(hkdfSync("sha256", shared, salt, info, KEY_BYTES));
    const nonce = randomBytes(NONCE_BYTES);
    const cipher = createCipheriv("aes-256-gcm", key, nonce);
    cipher.setAAD(info);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
    return {
      publicKey: pair.publicKey,
      salt: salt.toString("base64"),
      nonce: nonce.toString("base64"),
      ciphertext: ciphertext.toString("base64"),
    };
  } finally {
    pair.privateKey.fill(0);
    shared?.fill(0);
    key?.fill(0);
  }
}

/** Null for a wrong key, a changed item or a changed context. Never throws with a value in it. */
export function openValue(sealed: SealedValue, privateKey: Buffer, migrationId: string, id: string): Buffer | null {
  try {
    const shared = diffieHellman({
      privateKey: rawPrivate(privateKey),
      publicKey: rawPublic(fromBase64(sealed.publicKey, KEY_BYTES)),
    });
    let key: Buffer | null = null;
    try {
      const salt = fromBase64(sealed.salt, SALT_BYTES);
      const info = context(migrationId, id);
      key = Buffer.from(hkdfSync("sha256", shared, salt, info, KEY_BYTES));
      const nonce = fromBase64(sealed.nonce, NONCE_BYTES);
      const ciphertext = fromBase64(sealed.ciphertext, null);
      if (ciphertext.length <= TAG_BYTES) return null;
      const decipher = createDecipheriv("aes-256-gcm", key, nonce);
      decipher.setAAD(info);
      decipher.setAuthTag(ciphertext.subarray(ciphertext.length - TAG_BYTES));
      return Buffer.concat([decipher.update(ciphertext.subarray(0, ciphertext.length - TAG_BYTES)), decipher.final()]);
    } finally {
      shared.fill(0);
      key?.fill(0);
    }
  } catch {
    return null;
  }
}

interface KeyEntry {
  privateKey: Buffer;
  createdAt: number;
}

/**
 * The target's private keys, one per owner and migration. A key is taken once, so a captured apply
 * request cannot be replayed, and an unused key expires so a migration that never follows leaves
 * nothing to open.
 */
export class InstanceTransferSecretKeyring {
  readonly #keys = new Map<string, KeyEntry>();

  constructor(private readonly now: () => number = Date.now) {}

  add(owner: string, migrationId: string, privateKey: Buffer): void {
    this.#prune();
    const key = `${owner}\0${migrationId}`;
    const replaced = this.#keys.get(key);
    if (replaced) replaced.privateKey.fill(0);
    this.#keys.set(key, { privateKey, createdAt: this.now() });
    if (this.#keys.size > MAX_KEYS) {
      const oldest = [...this.#keys.entries()].sort((left, right) => left[1].createdAt - right[1].createdAt)[0];
      if (oldest) {
        oldest[1].privateKey.fill(0);
        this.#keys.delete(oldest[0]);
      }
    }
  }

  take(owner: string, migrationId: string): Buffer | null {
    this.#prune();
    const key = `${owner}\0${migrationId}`;
    const entry = this.#keys.get(key);
    if (!entry) return null;
    this.#keys.delete(key);
    return entry.privateKey;
  }

  clear(): void {
    for (const entry of this.#keys.values()) entry.privateKey.fill(0);
    this.#keys.clear();
  }

  #prune(): void {
    const cutoff = this.now() - INSTANCE_TRANSFER_SECRET_LIMITS.keyTtlMs;
    for (const [key, entry] of this.#keys) {
      if (entry.createdAt > cutoff) continue;
      entry.privateKey.fill(0);
      this.#keys.delete(key);
    }
  }
}
