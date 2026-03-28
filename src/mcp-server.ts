import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { AdtClient } from "./adt-client.js";
import { parseDataElementXml } from "./dtel-parser.js";
import { parseSqlResultXml } from "./sql-parser.js";
import { AdtConfig } from "./types.js";

const NameSchema = z.object({ name: z.string() });
const FunctionModuleSchema = z.object({
  function_group: z.string(),
  function_name: z.string(),
});
const SqlSchema = z.object({ query: z.string() });
const CreateProgramSchema = z.object({
  name: z.string(),
  description: z.string(),
  source: z.string(),
  package: z.string().optional(),
});
const CreateCdsViewSchema = z.object({
  name: z.string(),
  description: z.string(),
  source: z.string(),
  package: z.string().optional(),
});

export function createMcpServer(config: AdtConfig): Server {
  const client = new AdtClient(config);

  const server = new Server(
    { name: "sap-adt-mcp", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "get_abap_program",
        description: "Fetch ABAP program/report source code from SAP system",
        inputSchema: {
          type: "object" as const,
          properties: { name: { type: "string", description: "Program name (e.g. ZHANZ_CMR)" } },
          required: ["name"],
        },
      },
      {
        name: "get_data_element",
        description: "Fetch DDIC data element definition from SAP system",
        inputSchema: {
          type: "object" as const,
          properties: { name: { type: "string", description: "Data element name (e.g. MATNR)" } },
          required: ["name"],
        },
      },
      {
        name: "get_structure",
        description: "Fetch DDIC structure definition from SAP system",
        inputSchema: {
          type: "object" as const,
          properties: { name: { type: "string", description: "Structure name (e.g. BAPISDHD1)" } },
          required: ["name"],
        },
      },
      {
        name: "get_function_module",
        description: "Fetch function module source code from SAP system",
        inputSchema: {
          type: "object" as const,
          properties: {
            function_group: { type: "string", description: "Function group name (e.g. 2032)" },
            function_name: { type: "string", description: "Function module name (e.g. SD_SALESDOCUMENT_CREATE)" },
          },
          required: ["function_group", "function_name"],
        },
      },
      {
        name: "get_class",
        description: "Fetch ABAP class source code from SAP system",
        inputSchema: {
          type: "object" as const,
          properties: { name: { type: "string", description: "Class name (e.g. CL_ABAP_TYPEDESCR)" } },
          required: ["name"],
        },
      },
      {
        name: "get_cds_view",
        description: "Fetch CDS view DDL source definition from SAP system",
        inputSchema: {
          type: "object" as const,
          properties: { name: { type: "string", description: "CDS view name (e.g. I_BUSINESSPARTNER)" } },
          required: ["name"],
        },
      },
      {
        name: "execute_program",
        description: "Execute an ABAP program/report on the SAP system and return the list output. The program must be activated. Returns the WRITE output as plain text.",
        inputSchema: {
          type: "object" as const,
          properties: { name: { type: "string", description: "Program name to execute (e.g. ZHANZ_MCP_HELLO)" } },
          required: ["name"],
        },
      },
      {
        name: "create_cds_view",
        description: "Create a new CDS view (DDL source) in the SAP system. Creates the DDL source, writes the definition, and activates it. By default creates in $TMP.",
        inputSchema: {
          type: "object" as const,
          properties: {
            name: { type: "string", description: "CDS view name (must start with Z or Y, e.g. ZHANZ_MY_VIEW)" },
            description: { type: "string", description: "Short description (max 70 chars)" },
            source: { type: "string", description: "CDS DDL source code including annotations and define view statement" },
            package: { type: "string", description: "Development package (default: $TMP)" },
          },
          required: ["name", "description", "source"],
        },
      },
      {
        name: "create_abap_program",
        description: "Create a new ABAP program/report in the SAP system. Creates the program, writes source code, and activates it. By default creates in $TMP (local objects, no transport required).",
        inputSchema: {
          type: "object" as const,
          properties: {
            name: { type: "string", description: "Program name (must start with Z or Y, e.g. ZHANZ_TEST)" },
            description: { type: "string", description: "Short description of the program (max 70 chars)" },
            source: { type: "string", description: "ABAP source code. Must start with REPORT statement." },
            package: { type: "string", description: "Development package (default: $TMP for local objects)" },
          },
          required: ["name", "description", "source"],
        },
      },
      {
        name: "get_csrf_token",
        description: "Fetch a CSRF token and session cookie from the SAP system. Useful for making authenticated POST/PUT/DELETE requests to ADT or other SAP ICF services.",
        inputSchema: {
          type: "object" as const,
          properties: {},
          required: [],
        },
      },
      {
        name: "execute_sql",
        description: "Execute an ABAP SQL query on the SAP system and return results as a table. Use standard ABAP SQL syntax (e.g. SELECT vbeln, erdat FROM vbak UP TO 10 ROWS).",
        inputSchema: {
          type: "object" as const,
          properties: { query: { type: "string", description: "ABAP SQL query" } },
          required: ["query"],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        case "get_abap_program": {
          const { name: progName } = NameSchema.parse(args);
          const source = await client.getSource(
            `/sap/bc/adt/programs/programs/${encodeURIComponent(progName.toUpperCase())}/source/main`
          );
          return { content: [{ type: "text", text: source }] };
        }

        case "get_data_element": {
          const { name: dtelName } = NameSchema.parse(args);
          const encoded = encodeURIComponent(dtelName.toUpperCase());
          const result = await client.getSourceOrMetadata(
            `/sap/bc/adt/ddic/dataelements/${encoded}/source/main`,
            `/sap/bc/adt/ddic/dataelements/${encoded}`
          );
          const text = result.includes("<dtel:dataElement")
            ? parseDataElementXml(result)
            : result;
          return { content: [{ type: "text", text }] };
        }

        case "get_structure": {
          const { name: structName } = NameSchema.parse(args);
          const source = await client.getSource(
            `/sap/bc/adt/ddic/structures/${encodeURIComponent(structName.toUpperCase())}/source/main`
          );
          return { content: [{ type: "text", text: source }] };
        }

        case "get_function_module": {
          const { function_group, function_name } = FunctionModuleSchema.parse(args);
          const source = await client.getSource(
            `/sap/bc/adt/functions/groups/${encodeURIComponent(function_group.toUpperCase())}/fmodules/${encodeURIComponent(function_name.toUpperCase())}/source/main`
          );
          return { content: [{ type: "text", text: source }] };
        }

        case "get_class": {
          const { name: className } = NameSchema.parse(args);
          const source = await client.getSource(
            `/sap/bc/adt/oo/classes/${encodeURIComponent(className.toUpperCase())}/source/main`
          );
          return { content: [{ type: "text", text: source }] };
        }

        case "get_cds_view": {
          const { name: cdsName } = NameSchema.parse(args);
          const source = await client.getSource(
            `/sap/bc/adt/ddic/ddl/sources/${encodeURIComponent(cdsName.toUpperCase())}/source/main`
          );
          return { content: [{ type: "text", text: source }] };
        }

        case "execute_program": {
          const { name: progName } = NameSchema.parse(args);
          const output = await client.executeProgram(progName);
          return { content: [{ type: "text", text: output || "(no output)" }] };
        }

        case "create_cds_view": {
          const { name: cdsName, description, source, package: pkg } = CreateCdsViewSchema.parse(args);
          const log = await client.createCdsView(cdsName, description, source, pkg ?? "$TMP");
          return { content: [{ type: "text", text: log }] };
        }

        case "create_abap_program": {
          const { name: progName, description, source, package: pkg } = CreateProgramSchema.parse(args);
          const log = await client.createAbapProgram(progName, description, source, pkg ?? "$TMP");
          return { content: [{ type: "text", text: log }] };
        }

        case "get_csrf_token": {
          const { token, cookies } = await client.getCsrfToken();
          const text = `CSRF Token: ${token}\nSession Cookie: ${cookies}`;
          return { content: [{ type: "text", text }] };
        }

        case "execute_sql": {
          const { query } = SqlSchema.parse(args);
          const xml = await client.executeFreestyleSql(query);
          const table = parseSqlResultXml(xml);
          return { content: [{ type: "text", text: table }] };
        }

        default:
          return {
            content: [{ type: "text", text: `Unknown tool: ${name}` }],
            isError: true,
          };
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);

      if (message.includes("401")) {
        return {
          content: [{ type: "text", text: "Authentication failed. Check SAP_USERNAME and SAP_PASSWORD in .env" }],
          isError: true,
        };
      }
      if (message.includes("404")) {
        return {
          content: [{ type: "text", text: `Object not found. Verify the name exists in the SAP system.` }],
          isError: true,
        };
      }
      if (message.includes("403")) {
        return {
          content: [{ type: "text", text: "Access denied. Your user may lack ADT development authorization (S_ADT_RES)." }],
          isError: true,
        };
      }
      if (message.includes("ECONNREFUSED") || message.includes("ETIMEDOUT")) {
        return {
          content: [{ type: "text", text: `Cannot reach SAP system. Check SAP_HOSTNAME and SAP_SYSNR in .env` }],
          isError: true,
        };
      }

      return {
        content: [{ type: "text", text: `Error: ${message}` }],
        isError: true,
      };
    }
  });

  return server;
}
