// Real-API browser checks always use a fresh temporary database, test-only
// credentials and a loopback listener. Never load a developer's .env file.
import { cleanupTestDb, createTestApp } from "./testApp.js";
delete process.env.RESEND_API_KEY;
const { app, db, dbPath } = await createTestApp(false);
const server = app.listen(4317, "127.0.0.1");
function stop() {
  server.close(() => { db.close(); cleanupTestDb(dbPath); process.exit(0); });
}
process.once("SIGTERM", stop);
process.once("SIGINT", stop);
