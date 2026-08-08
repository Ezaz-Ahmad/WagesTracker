import bcrypt from "bcryptjs";
import { describe, expect, it } from "vitest";
import { detectHashFormat, hashPassword, needsRehash, verifyPassword } from "../src/security/passwordHashing.js";

// Unit-level coverage of backend/src/security/passwordHashing.ts, independent
// of the HTTP layer: the Argon2id hashing itself, dual-format verification
// (Argon2id + legacy bcrypt), and the specific bcrypt weakness (its silent
// 72-byte truncation) that motivated moving off it in the first place.
describe("password hashing (Argon2id + legacy bcrypt)", () => {
  it("hashes a new password as Argon2id", async () => {
    const hash = await hashPassword("a-brand-new-secure-password-2026");
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(detectHashFormat(hash)).toBe("argon2id");
  });

  it("verifies a password against its own freshly created Argon2id hash, and rejects the wrong one", async () => {
    const hash = await hashPassword("correct-argon2id-password-2026");
    expect(await verifyPassword("correct-argon2id-password-2026", hash)).toBe(true);
    expect(await verifyPassword("wrong-argon2id-password-2026", hash)).toBe(false);
  });

  it("still verifies a password against a legacy bcrypt hash", async () => {
    const legacyHash = await bcrypt.hash("legacy-bcrypt-hashed-password", 10);
    expect(detectHashFormat(legacyHash)).toBe("bcrypt");
    expect(await verifyPassword("legacy-bcrypt-hashed-password", legacyHash)).toBe(true);
    expect(await verifyPassword("wrong-password-entirely", legacyHash)).toBe(false);
  });

  it("flags only bcrypt hashes as needing a rehash, never Argon2id ones", async () => {
    const bcryptHash = await bcrypt.hash("some-legacy-password-here", 10);
    const argon2Hash = await hashPassword("some-modern-password-here");
    expect(needsRehash(bcryptHash)).toBe(true);
    expect(needsRehash(argon2Hash)).toBe(false);
  });

  it("recognizes all three legacy bcrypt prefixes ($2a$, $2b$, $2y$)", () => {
    expect(detectHashFormat("$2a$10$abcdefghijklmnopqrstuv")).toBe("bcrypt");
    expect(detectHashFormat("$2b$10$abcdefghijklmnopqrstuv")).toBe("bcrypt");
    expect(detectHashFormat("$2y$10$abcdefghijklmnopqrstuv")).toBe("bcrypt");
  });

  it("fails closed (returns false, never throws) for an unrecognized hash format", async () => {
    expect(detectHashFormat("not-a-real-hash-at-all")).toBeNull();
    await expect(verifyPassword("anything", "not-a-real-hash-at-all")).resolves.toBe(false);
  });

  it("treats two passwords identical for the first 72 bytes but different afterward as genuinely different passwords", async () => {
    // bcrypt silently ignores anything past the 72nd byte of input, so two
    // passwords like these would incorrectly verify as equal under bcrypt.
    // Argon2id (via hash-wasm) hashes the full input with no such cutoff —
    // this is exactly the behavior that motivated the migration.
    const shared72ByteBase = "a".repeat(72);
    const passwordA = shared72ByteBase + "-first-tail-2026";
    const passwordB = shared72ByteBase + "-a-completely-different-tail-2026";
    expect(passwordA.slice(0, 72)).toBe(passwordB.slice(0, 72));
    expect(passwordA).not.toBe(passwordB);

    const hashA = await hashPassword(passwordA);
    expect(await verifyPassword(passwordA, hashA)).toBe(true);
    expect(await verifyPassword(passwordB, hashA)).toBe(false);
  });

  it("hashes and verifies a long Unicode password (emoji, Japanese, accented Latin) correctly", async () => {
    // Comfortably over 72 UTF-8 bytes, but well under the 128-code-point
    // policy maximum — proves multi-byte characters aren't mishandled or
    // silently truncated anywhere in the hashing path.
    const password = "🔥".repeat(20) + "パスワード" + "é".repeat(10) + "-secure-2026";
    const hash = await hashPassword(password);
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword(password, hash)).toBe(true);
    expect(await verifyPassword(password + "x", hash)).toBe(false);
  });
});
