import type { Client } from "@libsql/client";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanupTestDb, createTestApp } from "./testApp.js";

function verificationToken(text: string): string {
  const match = text.match(/\/verify-email#token=([A-Za-z0-9_-]{43})/u);
  if (!match) throw new Error("Verification token missing from test email");
  return match[1];
}

describe("signup email validation and account email changes", () => {
  let app: Express;
  let db: Client;
  let dbPath: string;
  let outbox: Array<{ to: string; text: string; tag?: string }>;

  beforeAll(async () => {
    ({ app, db, dbPath } = await createTestApp({ authRateLimit: 100 }));
    ({ outbox } = (await import("../src/email/transport.js")).testOutbox);
  });
  afterAll(() => cleanupTestDb(dbPath));

  async function signupAndLogin(email: string, password: string) {
    const signup = await request(app).post("/api/auth/signup").send({ name: "Email Test", email, password, rate: 27.5 });
    expect(signup.status).toBe(201);
    expect(signup.body.token).toBeTypeOf("string");
    const login = await request(app).post("/api/auth/login").send({ email, password });
    expect(login.status).toBe(200);
    return login.body as { token: string; user: { id: string; email: string } };
  }

  it("validates format and blocks likely provider typos until they are corrected", async () => {
    const invalid = await request(app).post("/api/auth/signup").send({
      name: "Invalid",
      email: "not an address",
      password: "Shanto552527",
      rate: 20,
    });
    expect(invalid.status).toBe(400);
    expect(invalid.body).toMatchObject({ code: "INVALID_EMAIL", field: "email" });

    const typo = await request(app).post("/api/auth/signup").send({
      name: "Typo",
      email: "person@hmail.com",
      password: "Shanto552527",
      rate: 20,
    });
    expect(typo.status).toBe(400);
    expect(typo.body).toMatchObject({ code: "EMAIL_DOMAIN_TYPO", suggestion: "person@gmail.com" });

    const repeatedLetterTypo = await request(app).post("/api/auth/signup").send({
      name: "Repeated letter typo",
      email: "akibali@gmmail.com",
      password: "Shanto552527",
      rate: 20,
    });
    expect(repeatedLetterTypo.status).toBe(400);
    expect(repeatedLetterTypo.body).toMatchObject({
      code: "EMAIL_DOMAIN_TYPO",
      field: "email",
      suggestion: "akibali@gmail.com",
    });

    const overrideAttempt = await request(app).post("/api/auth/signup").send({
      name: "Typo",
      email: "akibali@gmmail.com",
      acceptEmailAsEntered: true,
      password: "Shanto552527",
      rate: 20,
    });
    expect(overrideAttempt.status).toBe(400);
    expect(overrideAttempt.body).toMatchObject({
      code: "EMAIL_DOMAIN_TYPO",
      suggestion: "akibali@gmail.com",
    });

    const corrected = await request(app).post("/api/auth/signup").send({
      name: "Corrected",
      email: "akibali@gmail.com",
      password: "Shanto552527",
      rate: 20,
    });
    expect(corrected.status).toBe(201);
  });

  it("creates a login-ready account without sending an ownership confirmation email", async () => {
    const email = "signup-no-confirmation@example.com";
    const password = "Shanto552527";
    const signupMailCount = outbox.filter((item) => item.tag === "signup-verification").length;
    const signup = await request(app).post("/api/auth/signup").send({ name: "Signup User", email, password, rate: 22 });
    expect(signup.status).toBe(201);
    expect(signup.body.token).toBeTypeOf("string");
    expect(signup.body.verificationRequired).toBeUndefined();
    expect(outbox.filter((item) => item.tag === "signup-verification")).toHaveLength(signupMailCount);

    const stored = await db.execute({ sql: "SELECT email_verified FROM users WHERE email = ?", args: [email] });
    expect(Number(stored.rows[0].email_verified)).toBe(1);
    const login = await request(app).post("/api/auth/login").send({ email, password });
    expect(login.status).toBe(200);
    expect(login.body.token).toBeTypeOf("string");
  });

  it("activates a self-service email change only after new-address verification", async () => {
    const password = "SamePassword552527";
    const oldEmail = "self-old@example.com";
    const newEmail = "self-new@example.com";
    const account = await signupAndLogin(oldEmail, password);
    await request(app)
      .post("/api/shifts")
      .set("Authorization", `Bearer ${account.token}`)
      .set("X-Client-Time-Zone", "Australia/Sydney")
      .send({ date: "2026-09-10", signIn: "09:00", signOut: "17:00" });
    const before = await db.execute({ sql: "SELECT id, password_hash, rate FROM users WHERE id = ?", args: [account.user.id] });

    const started = await request(app)
      .post("/api/me/email-change")
      .set("Authorization", `Bearer ${account.token}`)
      .send({ currentPassword: password, newEmail });
    expect(started.status).toBe(202);
    expect((await request(app).post("/api/auth/login").send({ email: oldEmail, password })).status).toBe(200);
    expect((await request(app).post("/api/auth/login").send({ email: newEmail, password })).status).toBe(401);

    const mail = outbox.findLast((item) => item.to === newEmail && item.tag === "email-change-verification")!;
    expect((await request(app).post("/api/auth/verify-email").send({ token: verificationToken(mail.text) })).status).toBe(200);
    expect((await request(app).post("/api/auth/login").send({ email: oldEmail, password })).status).toBe(401);
    expect((await request(app).post("/api/auth/login").send({ email: newEmail, password })).status).toBe(200);

    const after = await db.execute({ sql: "SELECT id, password_hash, rate FROM users WHERE id = ?", args: [account.user.id] });
    expect(after.rows[0]).toMatchObject(before.rows[0]);
    const shifts = await db.execute({ sql: "SELECT COUNT(*) AS count FROM shifts WHERE user_id = ?", args: [account.user.id] });
    expect(Number(shifts.rows[0].count)).toBe(1);
    expect(outbox.some((item) => item.to === oldEmail && item.tag === "email-changed")).toBe(true);
    expect(outbox.some((item) => item.to === newEmail && item.tag === "email-changed")).toBe(true);
  });

  it("lets an authenticated admin edit only the email and rejects duplicates or non-admins", async () => {
    const password = "AdminUnchanged552527";
    const oldEmail = "admin-old@example.com";
    const newEmail = "admin-new@example.com";
    const account = await signupAndLogin(oldEmail, password);
    const other = await signupAndLogin("duplicate@example.com", "Duplicate552527");
    const adminLogin = await request(app).post("/api/admin/login").send({ password: process.env.ADMIN_PASSWORD });
    const auth = { Authorization: `Bearer ${adminLogin.body.token}` };
    const before = await db.execute({ sql: "SELECT id, password_hash, rate, goal_hours FROM users WHERE id = ?", args: [account.user.id] });

    expect((await request(app).patch(`/api/admin/users/${account.user.id}/email`).send({ email: newEmail })).status).toBe(401);
    expect((await request(app).patch(`/api/admin/users/${account.user.id}/email`).set("Authorization", `Bearer ${other.token}`).send({ email: newEmail })).status).toBe(403);
    const duplicate = await request(app).patch(`/api/admin/users/${account.user.id}/email`).set(auth).send({ email: "duplicate@example.com" });
    expect(duplicate.status).toBe(409);

    const changed = await request(app).patch(`/api/admin/users/${account.user.id}/email`).set(auth).send({ email: newEmail });
    expect(changed.status).toBe(200);
    expect(changed.body.user.email).toBe(newEmail);
    expect((await request(app).post("/api/auth/login").send({ email: newEmail, password })).status).toBe(200);
    expect((await request(app).post("/api/auth/login").send({ email: oldEmail, password })).status).toBe(401);
    const after = await db.execute({ sql: "SELECT id, password_hash, rate, goal_hours FROM users WHERE id = ?", args: [account.user.id] });
    expect(after.rows[0]).toMatchObject(before.rows[0]);
  });
});
