import { spawn } from "node:child_process";

const commands = [
  [process.execPath, ["scripts/local-server.mjs", "--port", "8788", "--assets", "dist"]],
  [process.platform === "win32" ? "npm.cmd" : "npm", ["run", "dev:web"]],
];

const children = commands.map(([command, args]) => spawn(command, args, {
  cwd: process.cwd(),
  stdio: "inherit",
  env: process.env,
}));

let stopping = false;
function stop(signal = "SIGTERM") {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (!child.killed) child.kill(signal);
  }
}

for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => stop(signal));
for (const child of children) {
  child.on("exit", (code, signal) => {
    if (!stopping) {
      stop();
      process.exitCode = signal ? 1 : code ?? 1;
    }
  });
  child.on("error", (error) => {
    console.error(error);
    stop();
    process.exitCode = 1;
  });
}
