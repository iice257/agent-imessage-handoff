import { spawnSync } from "node:child_process";
import path from "node:path";

const root = process.cwd();
const shimPath = path.join(root, "scripts");
const env = {
  ...process.env,
  PATH: `${shimPath}${path.delimiter}${process.env.PATH || ""}`,
  Path: `${shimPath}${path.delimiter}${process.env.Path || process.env.PATH || ""}`,
};

const commands = [
  ["pnpm", ["--filter", "@gaberagland/imessage-handoff-relay", "test"]],
  [process.execPath, ["--test", "tests/plus/*.test.mjs"]],
  [process.execPath, ["--experimental-strip-types", "--test", "tests/skill/*.test.ts"]],
];

for (const [command, args] of commands) {
  const result = spawnSync(command, args, { cwd: root, env, stdio: "inherit", shell: process.platform === "win32" && command === "pnpm" });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}
