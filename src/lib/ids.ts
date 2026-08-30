import { randomBytes } from "node:crypto";

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

function randomSuffix(len: number): string {
  const bytes = randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i += 1) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return out;
}

/** Sortable, readable ids: `ord_lx3k9d_4fq2` */
export function newId(prefix: string, now: number = Date.now()): string {
  return `${prefix}_${now.toString(36)}_${randomSuffix(6)}`;
}

export function newNonce(): string {
  return randomBytes(16).toString("hex");
}
