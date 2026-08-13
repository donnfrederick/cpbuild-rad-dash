import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;

function getEncryptionKeyBytes(): Buffer {
  const hex = process.env.ENCRYPTION_KEY?.trim();
  if (!hex || hex.length !== KEY_LENGTH * 2) {
    throw new Error("ENCRYPTION_KEY must be set to 64 hex characters (32 bytes)");
  }
  if (!/^[0-9a-fA-F]+$/.test(hex)) {
    throw new Error("ENCRYPTION_KEY must be hexadecimal only");
  }
  return Buffer.from(hex, "hex");
}

/**
 * AES-256-GCM encrypt. Returns "iv:authTag:ciphertext" (all hex, colon-separated).
 */
export function encrypt(plaintext: string): string {
  const key = getEncryptionKeyBytes();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${enc.toString("hex")}`;
}

/**
 * Decrypt payload from `encrypt()`.
 */
export function decrypt(stored: string): string {
  const key = getEncryptionKeyBytes();
  const parts = stored.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted payload format");
  }
  const [ivHex, tagHex, dataHex] = parts;
  const iv = Buffer.from(ivHex ?? "", "hex");
  const tag = Buffer.from(tagHex ?? "", "hex");
  const data = Buffer.from(dataHex ?? "", "hex");
  if (iv.length !== IV_LENGTH || tag.length !== AUTH_TAG_LENGTH) {
    throw new Error("Invalid IV or auth tag length");
  }
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
