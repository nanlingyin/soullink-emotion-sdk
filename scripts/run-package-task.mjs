import { spawnSync } from "node:child_process";

const task = process.argv[2];
if (!task) {
  console.error("Usage: node scripts/run-package-task.mjs <task>");
  process.exit(1);
}

const npmCli = process.env.npm_execpath;
if (!npmCli) {
  console.error("This script must be run through an npm script.");
  process.exit(1);
}

const packages = [
  "engine",
  "runtime-core",
  "planner-openai",
  "classifier-embedding",
  "live2d-pixi",
  "api-client",
  "profile-generator",
  "devtools-vue"
];

for (const packageName of packages) {
  const workspace = `@soullink-emotion/${packageName}`;
  console.log(`\n> ${workspace} ${task}`);

  const result = spawnSync(
    process.execPath,
    [npmCli, "run", task, "--workspace", workspace],
    { stdio: "inherit" }
  );

  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
