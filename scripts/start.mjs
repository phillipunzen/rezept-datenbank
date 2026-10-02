import { spawn } from "node:child_process";
const children = [];
let stopping = false;
function stop(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  const timer = setTimeout(() => {
    for (const child of children) child.kill("SIGKILL");
    process.exit(code);
  }, 120000);
  Promise.all(
    children.map((child) =>
      child.exitCode !== null
        ? Promise.resolve()
        : new Promise((resolve) => child.once("exit", resolve)),
    ),
  ).then(() => {
    clearTimeout(timer);
    process.exit(code);
  });
}
for (const [file, extraEnv] of [
  ["dist/api.js", {}],
  [
    ".next/standalone/server.js",
    { HOSTNAME: "0.0.0.0", PORT: process.env.PORT ?? "3000" },
  ],
]) {
  const child = spawn(process.execPath, [file], {
    stdio: "inherit",
    env: { ...process.env, ...extraEnv },
  });
  children.push(child);
  child.on("error", () => stop(1));
  child.on("exit", (code) => {
    if (!stopping) stop(code || 1);
  });
}
process.on("SIGTERM", () => stop(0));
process.on("SIGINT", () => stop(0));
