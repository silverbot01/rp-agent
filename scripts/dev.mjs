import { spawn } from "node:child_process";

const children = [
  spawn("npm", ["run", "dev", "-w", "@rp/server"], { stdio: "inherit" }),
  spawn("npm", ["run", "dev", "-w", "@rp/web"], { stdio: "inherit" }),
];

function stop() {
  for (const child of children) child.kill("SIGTERM");
}

process.on("SIGINT", () => {
  stop();
  process.exit(0);
});
process.on("SIGTERM", () => {
  stop();
  process.exit(0);
});

for (const child of children) {
  child.on("exit", (code) => {
    stop();
    process.exit(code ?? 0);
  });
}
