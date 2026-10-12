import EmbeddedPostgres from "embedded-postgres";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
const dir = path.resolve(".local/postgres");
mkdirSync(".local", { recursive: true });
const pg = new EmbeddedPostgres({
  databaseDir: dir,
  user: "yeoun",
  password: "yeoun",
  port: 54329,
  persistent: true,
  authMethod: "scram-sha-256",
  postgresFlags: ["-h", "127.0.0.1", "-k", path.resolve(".local")],
  onLog: () => {},
  onError: (m) => {
    if (String(m).includes("FATAL")) console.error(String(m));
  },
});
if (!existsSync(path.join(dir, "PG_VERSION"))) await pg.initialise();
await pg.start();
const client = pg.getPgClient();
await client.connect();
for (const name of ["yeoun", "yeoun_test"]) {
  const r = await client.query("SELECT 1 FROM pg_database WHERE datname=$1", [
    name,
  ]);
  if (!r.rowCount) await pg.createDatabase(name);
}
await client.end();
console.log("PostgreSQL ready at 127.0.0.1:54329 (yeoun, yeoun_test)");
async function stop() {
  await pg.stop();
  process.exit(0);
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
setInterval(() => {}, 60000);
