import dotenv from "dotenv";
import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");
dotenv.config({ path: resolve(projectRoot, ".env") });

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "./mcp-server.js";
import { SystemConfig } from "./types.js";

function loadSystems(): SystemConfig[] {
  const systemsPath = resolve(projectRoot, "systems.json");
  if (existsSync(systemsPath)) {
    const raw = readFileSync(systemsPath, "utf-8");
    const systems: SystemConfig[] = JSON.parse(raw);
    if (!Array.isArray(systems) || systems.length === 0) {
      console.error("systems.json must be a non-empty array of system configs.");
      process.exit(1);
    }
    for (const sys of systems) {
      if (!sys.id || !sys.hostname || !sys.sysnr || !sys.client) {
        console.error(`System "${sys.id || "unknown"}" missing required fields (id, hostname, sysnr, client).`);
        process.exit(1);
      }
      if (sys.authType === "certificate") {
        if (!sys.certThumbprint) {
          console.error(`System "${sys.id}" uses certificate auth but missing certThumbprint.`);
          process.exit(1);
        }
        sys.username = sys.username || "";
        sys.password = sys.password || "";
      } else if (!sys.username || !sys.password) {
        console.error(`System "${sys.id}" uses basic auth but missing username/password.`);
        process.exit(1);
      }
      sys.language = sys.language || "EN";
    }
    return systems;
  }

  const hostname = process.env.SAP_HOSTNAME;
  const sysnr = process.env.SAP_SYSNR;
  const username = process.env.SAP_USERNAME;
  const password = process.env.SAP_PASSWORD;
  const client = process.env.SAP_CLIENT;

  if (!hostname || !sysnr || !username || !password || !client) {
    console.error("No systems.json found and missing required .env variables.");
    console.error("Either create systems.json (see systems.json.example) or set SAP_HOSTNAME, SAP_SYSNR, SAP_USERNAME, SAP_PASSWORD, SAP_CLIENT in .env");
    process.exit(1);
  }

  const language = process.env.SAP_LANGUAGE || "EN";
  const id = process.env.SAP_SYSTEM_ID || hostname.split(".")[0].toUpperCase();

  return [{ id, hostname, sysnr, username, password, client, language }];
}

async function main() {
  const systems = loadSystems();
  const server = createMcpServer(systems);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  const systemList = systems.map((s) => s.id).join(", ");
  console.error(`SAP ADT MCP server started — systems: ${systemList}`);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
