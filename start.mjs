import { spawn } from "node:child_process";

const children = new Set();

function start(command, args, options = {}) {
  const child = spawn(command, args, {
    stdio: "inherit",
    ...options,
    env: { ...process.env, ...options.env },
  });
  children.add(child);
  child.on("exit", (code, signal) => {
    children.delete(child);
    if (signal || code === 0) return;
    console.error(`${command} exited with code ${code}`);
    shutdown(code || 1);
  });
  return child;
}

function shutdown(code = 0) {
  for (const child of children) child.kill("SIGTERM");
  setTimeout(() => process.exit(code), 250).unref();
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

start("npm", ["run", "start"], {
  cwd: new URL("./engine", import.meta.url),
  env: { PORT: "2000" },
});

start(process.execPath, ["server.mjs"], {
  cwd: new URL(".", import.meta.url),
  env: {
    PORT: process.env.PORT || "4173",
    EVE_ORIGIN: "http://127.0.0.1:2000",
  },
});
