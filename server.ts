import nextEnv from "@next/env";
nextEnv.loadEnvConfig(process.cwd());

import { createServer } from "node:http";
import next from "next";
import { attachWebSocket } from "./src/server/ws";

const dev = process.env.NODE_ENV !== "production";
const app = next({ dev });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const server = createServer((req, res) => handle(req, res));
  attachWebSocket(server);
  const port = Number(process.env.PORT || 3000);
  server.listen(port, () => {
    console.log(`[LogiFence] listening on http://0.0.0.0:${port} (${dev ? "dev" : "prod"})`);
  });
});
