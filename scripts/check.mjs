import { spawnSync } from "node:child_process";
const checks = [
  ["npm", ["run", "typecheck"]],
  ["npm", ["run", "build"]],
  [".venv/bin/ruff", ["check", "apps/api", "--select", "F,I"]],
  ["../../.venv/bin/python", ["-m", "pytest", "-q"], "apps/api"],
];
for (const [command, args, cwd] of checks) {
  const r = spawnSync(command, args, {
    cwd: cwd || process.cwd(),
    stdio: "inherit",
  });
  if (r.status !== 0) process.exit(r.status || 1);
}
