import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { AdtClient } from "./adt-client.js";
import { parseDataElementXml } from "./dtel-parser.js";
import { parseSqlResultXml } from "./sql-parser.js";
import { parseSnapDumps, formatSt22Dumps } from "./snap-parser.js";
import { AdtConfig } from "./types.js";

const NameSchema = z.object({ name: z.string() });
const FunctionModuleSchema = z.object({
  function_group: z.string(),
  function_name: z.string(),
});
const SqlSchema = z.object({ query: z.string() });
const SearchObjectSchema = z.object({
  query: z.string(),
  max_results: z.number().optional(),
});
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
const ChangeCdsViewSchema = z.object({
  name: z.string(),
  source: z.string(),
});
const ChangeAbapProgramSchema = z.object({
  name: z.string(),
  source: z.string(),
});

// Transport schemas
const TransportInfoSchema = z.object({
  uri: z.string(),
  devclass: z.string(),
  operation: z.string().optional(),
});
const CreateTransportSchema = z.object({
  devclass: z.string(),
  description: z.string(),
  ref: z.string().optional(),
  operation: z.string().optional(),
});
const TransportNumberSchema = z.object({ transport_number: z.string() });

// Trace schemas
const TraceUserSchema = z.object({ user: z.string().optional() });
const TraceIdSchema = z.object({ trace_id: z.string() });
const CreateTraceConfigSchema = z.object({
  object_name: z.string(),
  process_type: z.string().optional(),
  description: z.string().optional(),
});
const TraceConfigIdSchema = z.object({ config_id: z.string() });

// ST05 trace schemas
const EnableSt05Schema = z.object({
  user: z.string().optional(),
  sql: z.boolean().optional(),
  buffer: z.boolean().optional(),
  enqueue: z.boolean().optional(),
  rfc: z.boolean().optional(),
  http: z.boolean().optional(),
  auth: z.boolean().optional(),
  stack_trace: z.boolean().optional(),
});

// Cross trace schemas
const EnableCrossTraceSchema = z.object({
  user: z.string().optional(),
  description: z.string().optional(),
  max_traces: z.number().optional(),
  expiry_hours: z.number().optional(),
  components: z.array(z.string()).optional(),
  trace_level: z.number().optional(),
  request_type_filter: z.string().optional(),
});
const CrossTraceIdSchema = z.object({ activation_id: z.string() });
const CrossTraceUserSchema = z.object({ user: z.string().optional() });
const CrossTraceRecordsSchema = z.object({ trace_id: z.string() });

// ST22 dump schema
const FetchSt22Schema = z.object({
  date: z.string().describe("Date in YYYYMMDD or YYYY-MM-DD format"),
  user: z.string().optional().describe("Filter by SAP username"),
  max_results: z.number().optional().describe("Max dumps to return (default: 100)"),
});

// Service binding schemas
const ServiceBindingSchema = z.object({
  binding_name: z.string(),
  binding_version: z.string(),
});

// Debugger schemas
const DebuggerListenSchema = z.object({
  terminal_id: z.string().optional(),
  ide_id: z.string().optional(),
  user: z.string().optional(),
});
const DebuggerBreakpointSchema = z.object({
  uri: z.string(),
  line: z.number(),
  user: z.string().optional(),
});
const DebuggerBreakpointIdSchema = z.object({ breakpoint_id: z.string() });
const DebuggerStepSchema = z.object({
  step_type: z.enum([
    "stepInto", "stepOver", "stepReturn", "stepContinue",
    "stepRunToLine", "stepJumpToLine", "terminateDebuggee",
  ]),
  uri: z.string().optional(),
});
const DebuggerGotoStackSchema = z.object({
  stack_type: z.string(),
  position: z.number(),
});
const DebuggerVariablesSchema = z.object({ variable_names: z.array(z.string()) });
const DebuggerChildVariablesSchema = z.object({ variable_name: z.string() });
const DebuggerSetVariableSchema = z.object({
  variable_name: z.string(),
  value: z.string(),
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
        name: "change_cds_view",
        description: "Modify an existing CDS view (DDL source) in the SAP system. Locks the object, writes the new source, activates, and unlocks. Use get_cds_view first to read the current source.",
        inputSchema: {
          type: "object" as const,
          properties: {
            name: { type: "string", description: "CDS view name (e.g. ZHANZ_MY_VIEW)" },
            source: { type: "string", description: "Complete new CDS DDL source code including all annotations and define view statement" },
          },
          required: ["name", "source"],
        },
      },
      {
        name: "change_abap_program",
        description: "Modify an existing ABAP program/report in the SAP system. Locks the object, writes the new source, activates, and unlocks. Use get_abap_program first to read the current source.",
        inputSchema: {
          type: "object" as const,
          properties: {
            name: { type: "string", description: "Program name (e.g. ZHANZ_TEST)" },
            source: { type: "string", description: "Complete new ABAP source code. Must start with REPORT statement." },
          },
          required: ["name", "source"],
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
        name: "get_function_group",
        description: "Fetch ABAP function group source code from SAP system",
        inputSchema: {
          type: "object" as const,
          properties: { name: { type: "string", description: "Function group name (e.g. SVAT)" } },
          required: ["name"],
        },
      },
      {
        name: "get_include",
        description: "Fetch ABAP include source code from SAP system",
        inputSchema: {
          type: "object" as const,
          properties: { name: { type: "string", description: "Include name (e.g. LSVATF01)" } },
          required: ["name"],
        },
      },
      {
        name: "get_interface",
        description: "Fetch ABAP interface source code from SAP system",
        inputSchema: {
          type: "object" as const,
          properties: { name: { type: "string", description: "Interface name (e.g. IF_ABAP_TIMER_HANDLER)" } },
          required: ["name"],
        },
      },
      {
        name: "get_table",
        description: "Fetch ABAP database table definition from SAP system",
        inputSchema: {
          type: "object" as const,
          properties: { name: { type: "string", description: "Table name (e.g. VBAK)" } },
          required: ["name"],
        },
      },
      {
        name: "get_domain",
        description: "Fetch DDIC domain definition from SAP system",
        inputSchema: {
          type: "object" as const,
          properties: { name: { type: "string", description: "Domain name (e.g. MATNR)" } },
          required: ["name"],
        },
      },
      {
        name: "get_transaction",
        description: "Fetch ABAP transaction details (package, application component) from SAP system",
        inputSchema: {
          type: "object" as const,
          properties: { name: { type: "string", description: "Transaction code (e.g. VA01)" } },
          required: ["name"],
        },
      },
      {
        name: "get_package",
        description: "Fetch ABAP package contents (list of objects with types and descriptions) from SAP system",
        inputSchema: {
          type: "object" as const,
          properties: { name: { type: "string", description: "Package name (e.g. $TMP)" } },
          required: ["name"],
        },
      },
      {
        name: "search_object",
        description: "Search for ABAP repository objects by name pattern. Supports wildcards (*) for partial matches.",
        inputSchema: {
          type: "object" as const,
          properties: {
            query: { type: "string", description: "Search query (e.g. Z_MY* or CL_ABAP*)" },
            max_results: { type: "number", description: "Maximum results to return (default: 100)" },
          },
          required: ["query"],
        },
      },
      // --- Transport Management ---
      {
        name: "get_transport_info",
        description: "Check transport info for an ABAP object. Returns available transports and lock status.",
        inputSchema: {
          type: "object" as const,
          properties: {
            uri: { type: "string", description: "Object URI (e.g. /sap/bc/adt/programs/programs/ztest)" },
            devclass: { type: "string", description: "Development class/package (e.g. ZPACKAGE)" },
            operation: { type: "string", description: "Operation (default: I_CTS_OBJECT_CHECK)" },
          },
          required: ["uri", "devclass"],
        },
      },
      {
        name: "create_transport",
        description: "Create a new transport request in the SAP system",
        inputSchema: {
          type: "object" as const,
          properties: {
            devclass: { type: "string", description: "Development class/package (e.g. ZPACKAGE)" },
            description: { type: "string", description: "Transport description text" },
            ref: { type: "string", description: "Object reference URI" },
            operation: { type: "string", description: "Operation (default: I_CTS_OBJECT_CHECK)" },
          },
          required: ["devclass", "description"],
        },
      },
      {
        name: "list_user_transports",
        description: "List all modifiable transport requests for the current SAP user. Returns TR number, type, status, date, and description.",
        inputSchema: {
          type: "object" as const,
          properties: {},
          required: [],
        },
      },
      {
        name: "get_transport",
        description: "Get full details of a transport request by number. Returns description, status, owner, target system, tasks, and object list.",
        inputSchema: {
          type: "object" as const,
          properties: {
            transport_number: { type: "string", description: "Transport number (e.g. EUPK902297)" },
          },
          required: ["transport_number"],
        },
      },
      {
        name: "release_transport",
        description: "Release a transport request for import into target systems",
        inputSchema: {
          type: "object" as const,
          properties: {
            transport_number: { type: "string", description: "Transport number (e.g. DEVK900123)" },
          },
          required: ["transport_number"],
        },
      },
      {
        name: "delete_transport",
        description: "Delete a transport request from the SAP system",
        inputSchema: {
          type: "object" as const,
          properties: {
            transport_number: { type: "string", description: "Transport number (e.g. DEVK900123)" },
          },
          required: ["transport_number"],
        },
      },
      {
        name: "list_system_users",
        description: "List SAP system users. Useful for transport ownership and user lookups.",
        inputSchema: {
          type: "object" as const,
          properties: {},
          required: [],
        },
      },
      // --- Trace Management ---
      {
        name: "list_traces",
        description: "List ABAP runtime traces (SAT/SE30) for a user. Traces must be created via SAP GUI (transaction SAT or SE30) since the ADT REST API cannot profile programrun executions.",
        inputSchema: {
          type: "object" as const,
          properties: {
            user: { type: "string", description: "SAP username (default: current user)" },
          },
          required: [],
        },
      },
      {
        name: "get_trace_hitlist",
        description: "Get performance hit list for a trace (most expensive calls)",
        inputSchema: {
          type: "object" as const,
          properties: {
            trace_id: { type: "string", description: "Trace ID from list_traces" },
          },
          required: ["trace_id"],
        },
      },
      {
        name: "get_trace_db_access",
        description: "Get database access statistics for a trace",
        inputSchema: {
          type: "object" as const,
          properties: {
            trace_id: { type: "string", description: "Trace ID from list_traces" },
          },
          required: ["trace_id"],
        },
      },
      {
        name: "get_trace_statements",
        description: "Get aggregated call tree with statement-level performance for a trace",
        inputSchema: {
          type: "object" as const,
          properties: {
            trace_id: { type: "string", description: "Trace ID from list_traces" },
          },
          required: ["trace_id"],
        },
      },
      {
        name: "delete_trace",
        description: "Delete a runtime trace",
        inputSchema: {
          type: "object" as const,
          properties: {
            trace_id: { type: "string", description: "Trace ID to delete" },
          },
          required: ["trace_id"],
        },
      },
      {
        name: "create_trace_config",
        description: "Create a trace collection configuration to capture an ABAP runtime trace",
        inputSchema: {
          type: "object" as const,
          properties: {
            object_name: { type: "string", description: "Object name to trace (e.g. program or transaction)" },
            process_type: { type: "string", description: "Process type: HTTP, DIALOG, RFC, etc. (default: HTTP)" },
            description: { type: "string", description: "Description for the trace configuration" },
          },
          required: ["object_name"],
        },
      },
      {
        name: "delete_trace_config",
        description: "Delete a trace collection configuration",
        inputSchema: {
          type: "object" as const,
          properties: {
            config_id: { type: "string", description: "Configuration ID to delete" },
          },
          required: ["config_id"],
        },
      },
      // --- Service Binding ---
      {
        name: "get_binding_details",
        description: "Get OData service binding details (service URLs, versions, status)",
        inputSchema: {
          type: "object" as const,
          properties: {
            binding_name: { type: "string", description: "Service binding name (e.g. ZUI_TRAVEL_O4)" },
          },
          required: ["binding_name"],
        },
      },
      {
        name: "publish_service_binding",
        description: "Publish an OData service binding to make it accessible",
        inputSchema: {
          type: "object" as const,
          properties: {
            binding_name: { type: "string", description: "Service binding name" },
            binding_version: { type: "string", description: "Service version (e.g. 0001)" },
          },
          required: ["binding_name", "binding_version"],
        },
      },
      {
        name: "unpublish_service_binding",
        description: "Unpublish an OData service binding",
        inputSchema: {
          type: "object" as const,
          properties: {
            binding_name: { type: "string", description: "Service binding name" },
            binding_version: { type: "string", description: "Service version (e.g. 0001)" },
          },
          required: ["binding_name", "binding_version"],
        },
      },
      // --- Debugger ---
      {
        name: "start_debugger_listener",
        description: "Start an ABAP debugger listener. Opens a stateful session and waits for a debug event. Must call stop_debugger_listener when done.",
        inputSchema: {
          type: "object" as const,
          properties: {
            terminal_id: { type: "string", description: "Terminal identifier (default: MCP_TERMINAL)" },
            ide_id: { type: "string", description: "IDE identifier (default: MCP_IDE)" },
            user: { type: "string", description: "SAP username to debug (default: current user)" },
          },
          required: [],
        },
      },
      {
        name: "stop_debugger_listener",
        description: "Stop the debugger listener and close the stateful debug session",
        inputSchema: {
          type: "object" as const,
          properties: {
            terminal_id: { type: "string", description: "Terminal identifier (default: MCP_TERMINAL)" },
            ide_id: { type: "string", description: "IDE identifier (default: MCP_IDE)" },
            user: { type: "string", description: "SAP username (default: current user)" },
          },
          required: [],
        },
      },
      {
        name: "set_debugger_breakpoint",
        description: "Set a breakpoint at a specific source location in the debugger",
        inputSchema: {
          type: "object" as const,
          properties: {
            uri: { type: "string", description: "Object source URI (e.g. /sap/bc/adt/programs/programs/ztest/source/main)" },
            line: { type: "number", description: "Line number for breakpoint" },
            user: { type: "string", description: "SAP username (default: current user)" },
          },
          required: ["uri", "line"],
        },
      },
      {
        name: "delete_debugger_breakpoint",
        description: "Remove a breakpoint from the debugger",
        inputSchema: {
          type: "object" as const,
          properties: {
            breakpoint_id: { type: "string", description: "Breakpoint ID to delete" },
          },
          required: ["breakpoint_id"],
        },
      },
      {
        name: "attach_debugger",
        description: "Attach the debugger to a running ABAP session",
        inputSchema: {
          type: "object" as const,
          properties: {
            debug_mode: { type: "string", description: "Debugging mode (default: user)" },
          },
          required: [],
        },
      },
      {
        name: "get_debugger_stack",
        description: "Get the current call stack in the debugger",
        inputSchema: {
          type: "object" as const,
          properties: {},
          required: [],
        },
      },
      {
        name: "get_debugger_variables",
        description: "Get variable values in the current debug context",
        inputSchema: {
          type: "object" as const,
          properties: {
            variable_names: { type: "array", description: "Array of variable names to inspect" },
          },
          required: ["variable_names"],
        },
      },
      {
        name: "get_debugger_child_variables",
        description: "Get child/nested variable values (structure components, table rows)",
        inputSchema: {
          type: "object" as const,
          properties: {
            variable_name: { type: "string", description: "Parent variable name to expand" },
          },
          required: ["variable_name"],
        },
      },
      {
        name: "debugger_step",
        description: "Execute a debug step (into, over, return, continue, run-to-line, jump-to-line, terminate)",
        inputSchema: {
          type: "object" as const,
          properties: {
            step_type: { type: "string", description: "Step type: stepInto, stepOver, stepReturn, stepContinue, stepRunToLine, stepJumpToLine, terminateDebuggee" },
            uri: { type: "string", description: "Source URI (required for stepRunToLine/stepJumpToLine)" },
          },
          required: ["step_type"],
        },
      },
      {
        name: "debugger_goto_stack",
        description: "Navigate to a specific stack frame in the debugger",
        inputSchema: {
          type: "object" as const,
          properties: {
            stack_type: { type: "string", description: "Stack type identifier" },
            position: { type: "number", description: "Stack position (0-based)" },
          },
          required: ["stack_type", "position"],
        },
      },
      {
        name: "set_debugger_variable_value",
        description: "Set a variable value during debugging",
        inputSchema: {
          type: "object" as const,
          properties: {
            variable_name: { type: "string", description: "Variable name to modify" },
            value: { type: "string", description: "New value to set" },
          },
          required: ["variable_name", "value"],
        },
      },
      {
        name: "enable_st05_trace",
        description: "Enable ST05 performance trace (SQL trace, buffer trace, etc.) for a specific user. By default enables SQL trace with stack trace. The trace runs continuously until disabled with disable_st05_trace.",
        inputSchema: {
          type: "object" as const,
          properties: {
            user: { type: "string", description: "SAP username to trace (default: current user)" },
            sql: { type: "boolean", description: "Enable SQL trace (default: true)" },
            buffer: { type: "boolean", description: "Enable buffer trace (default: false)" },
            enqueue: { type: "boolean", description: "Enable enqueue trace (default: false)" },
            rfc: { type: "boolean", description: "Enable RFC trace (default: false)" },
            http: { type: "boolean", description: "Enable HTTP trace (default: false)" },
            auth: { type: "boolean", description: "Enable authorization trace (default: false)" },
            stack_trace: { type: "boolean", description: "Include ABAP stack traces (default: true)" },
          },
          required: [],
        },
      },
      {
        name: "disable_st05_trace",
        description: "Disable ST05 performance trace. Stops all active trace collection on the server.",
        inputSchema: {
          type: "object" as const,
          properties: {},
          required: [],
        },
      },
      {
        name: "get_st05_trace_state",
        description: "Get the current ST05 performance trace state — shows which trace types are active, the user filter, and server info.",
        inputSchema: {
          type: "object" as const,
          properties: {},
          required: [],
        },
      },
      {
        name: "enable_cross_trace",
        description: "Enable ABAP Cross Trace for a user. Traces RAP, OData, SADL, BAdI, Gateway and other framework components continuously (up to max_traces). Unlike SAT trace which captures only 1 execution, cross trace captures multiple requests over time.",
        inputSchema: {
          type: "object" as const,
          properties: {
            user: { type: "string", description: "SAP username to trace (default: current user)" },
            description: { type: "string", description: "Trace description (default: 'Cross trace <USER>')" },
            max_traces: { type: "number", description: "Maximum number of traces to capture (default: 100)" },
            expiry_hours: { type: "number", description: "Hours until trace auto-deletes (default: 24)" },
            components: { type: "array", items: { type: "string" }, description: "Component names to trace (default: all available components). Use list_cross_trace_components to see available names." },
            trace_level: { type: "number", description: "Trace detail level 1-3 (default: 2)" },
            request_type_filter: { type: "string", description: "Filter by request type: T=Transaction, C=RFC, U=URL, O=OData V2, 4=OData V4, B=Batch, etc. (default: all)" },
          },
          required: [],
        },
      },
      {
        name: "disable_cross_trace",
        description: "Disable an ABAP Cross Trace activation by its ID. Use get_cross_trace_activations to find the activation ID.",
        inputSchema: {
          type: "object" as const,
          properties: {
            activation_id: { type: "string", description: "Activation ID to delete" },
          },
          required: ["activation_id"],
        },
      },
      {
        name: "get_cross_trace_activations",
        description: "List all active ABAP Cross Trace activations. Shows activation IDs, user filters, enabled state, expiry, and component count.",
        inputSchema: {
          type: "object" as const,
          properties: {},
          required: [],
        },
      },
      {
        name: "list_cross_traces",
        description: "List captured ABAP Cross Trace results for a user. Shows trace IDs, request types (OData V2/V4, URL, RFC, etc.), and service names.",
        inputSchema: {
          type: "object" as const,
          properties: {
            user: { type: "string", description: "SAP username (default: current user)" },
          },
          required: [],
        },
      },
      {
        name: "get_cross_trace_records",
        description: "Get detailed records for a specific cross trace. Shows framework-level trace records with components, timestamps, and content.",
        inputSchema: {
          type: "object" as const,
          properties: {
            trace_id: { type: "string", description: "Trace ID from list_cross_traces" },
          },
          required: ["trace_id"],
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
      {
        name: "fetch_st22_dumps",
        description:
          "Fetch ABAP runtime error dumps (ST22/short dumps) for a specific date. " +
          "Returns dump time, user, runtime error type, and program. " +
          "Queries the SNAP table and parses the encoded dump headers.",
        inputSchema: {
          type: "object" as const,
          properties: {
            date: { type: "string", description: "Date in YYYYMMDD or YYYY-MM-DD format (e.g. 20260402)" },
            user: { type: "string", description: "Filter by SAP username (e.g. WF-BATCH)" },
            max_results: { type: "number", description: "Max dumps to return (default: 100)", default: 100 },
          },
          required: ["date"],
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

        case "get_function_group": {
          const { name: fgName } = NameSchema.parse(args);
          const source = await client.getSource(
            `/sap/bc/adt/functions/groups/${encodeURIComponent(fgName.toUpperCase())}/source/main`
          );
          return { content: [{ type: "text", text: source }] };
        }

        case "get_include": {
          const { name: inclName } = NameSchema.parse(args);
          const source = await client.getSource(
            `/sap/bc/adt/programs/includes/${encodeURIComponent(inclName.toUpperCase())}/source/main`
          );
          return { content: [{ type: "text", text: source }] };
        }

        case "get_interface": {
          const { name: ifName } = NameSchema.parse(args);
          const source = await client.getSource(
            `/sap/bc/adt/oo/interfaces/${encodeURIComponent(ifName.toUpperCase())}/source/main`
          );
          return { content: [{ type: "text", text: source }] };
        }

        case "get_table": {
          const { name: tableName } = NameSchema.parse(args);
          const source = await client.getSource(
            `/sap/bc/adt/ddic/tables/${encodeURIComponent(tableName.toUpperCase())}/source/main`
          );
          return { content: [{ type: "text", text: source }] };
        }

        case "get_domain": {
          const { name: domName } = NameSchema.parse(args);
          const encoded = encodeURIComponent(domName.toUpperCase());
          const result = await client.getSourceOrMetadata(
            `/sap/bc/adt/ddic/domains/${encoded}/source/main`,
            `/sap/bc/adt/ddic/domains/${encoded}`
          );
          return { content: [{ type: "text", text: result }] };
        }

        case "get_transaction": {
          const { name: txName } = NameSchema.parse(args);
          const details = await client.getTransactionDetails(txName);
          return { content: [{ type: "text", text: details }] };
        }

        case "get_package": {
          const { name: pkgName } = NameSchema.parse(args);
          const contents = await client.getPackageContents(pkgName);
          return { content: [{ type: "text", text: contents }] };
        }

        case "search_object": {
          const { query, max_results } = SearchObjectSchema.parse(args);
          const results = await client.searchObject(query, max_results);
          return { content: [{ type: "text", text: results }] };
        }

        // --- Transport Management ---
        case "get_transport_info": {
          const { uri, devclass, operation } = TransportInfoSchema.parse(args);
          const result = await client.getTransportInfo(uri, devclass, operation);
          return { content: [{ type: "text", text: result }] };
        }

        case "create_transport": {
          const { devclass, description, ref, operation } = CreateTransportSchema.parse(args);
          const result = await client.createTransport(devclass, description, ref, operation);
          return { content: [{ type: "text", text: result }] };
        }

        case "list_user_transports": {
          const result = await client.listUserTransports();
          return { content: [{ type: "text", text: result || "(no transports found)" }] };
        }

        case "get_transport": {
          const { transport_number } = TransportNumberSchema.parse(args);
          const result = await client.getTransport(transport_number);
          return { content: [{ type: "text", text: result }] };
        }

        case "release_transport": {
          const { transport_number } = TransportNumberSchema.parse(args);
          const result = await client.releaseTransport(transport_number);
          return { content: [{ type: "text", text: result }] };
        }

        case "delete_transport": {
          const { transport_number } = TransportNumberSchema.parse(args);
          const result = await client.deleteTransport(transport_number);
          return { content: [{ type: "text", text: result }] };
        }

        case "list_system_users": {
          const result = await client.getSystemUsers();
          return { content: [{ type: "text", text: result }] };
        }

        // --- Trace Management ---
        case "list_traces": {
          const { user } = TraceUserSchema.parse(args);
          const result = await client.listTraces(user);
          return { content: [{ type: "text", text: result }] };
        }

        case "get_trace_hitlist": {
          const { trace_id } = TraceIdSchema.parse(args);
          const result = await client.getTraceHitlist(trace_id);
          return { content: [{ type: "text", text: result }] };
        }

        case "get_trace_db_access": {
          const { trace_id } = TraceIdSchema.parse(args);
          const result = await client.getTraceDbAccess(trace_id);
          return { content: [{ type: "text", text: result }] };
        }

        case "get_trace_statements": {
          const { trace_id } = TraceIdSchema.parse(args);
          const result = await client.getTraceStatements(trace_id);
          return { content: [{ type: "text", text: result }] };
        }

        case "delete_trace": {
          const { trace_id } = TraceIdSchema.parse(args);
          const result = await client.deleteTrace(trace_id);
          return { content: [{ type: "text", text: result }] };
        }

        case "create_trace_config": {
          const { object_name, process_type, description } = CreateTraceConfigSchema.parse(args);
          const result = await client.createTraceConfig(object_name, process_type, description);
          return { content: [{ type: "text", text: result }] };
        }

        case "delete_trace_config": {
          const { config_id } = TraceConfigIdSchema.parse(args);
          const result = await client.deleteTraceConfig(config_id);
          return { content: [{ type: "text", text: result }] };
        }

        // --- Service Binding ---
        case "get_binding_details": {
          const { binding_name } = z.object({ binding_name: z.string() }).parse(args);
          const result = await client.getBindingDetails(binding_name);
          return { content: [{ type: "text", text: result }] };
        }

        case "publish_service_binding": {
          const { binding_name, binding_version } = ServiceBindingSchema.parse(args);
          const result = await client.publishServiceBinding(binding_name, binding_version);
          return { content: [{ type: "text", text: result }] };
        }

        case "unpublish_service_binding": {
          const { binding_name, binding_version } = ServiceBindingSchema.parse(args);
          const result = await client.unpublishServiceBinding(binding_name, binding_version);
          return { content: [{ type: "text", text: result }] };
        }

        // --- Debugger ---
        case "start_debugger_listener": {
          const { terminal_id, ide_id, user } = DebuggerListenSchema.parse(args);
          const result = await client.debuggerListen(terminal_id, ide_id, user);
          return { content: [{ type: "text", text: result }] };
        }

        case "stop_debugger_listener": {
          const { terminal_id, ide_id, user } = DebuggerListenSchema.parse(args);
          const result = await client.debuggerDeleteListener(terminal_id, ide_id, user);
          return { content: [{ type: "text", text: result }] };
        }

        case "set_debugger_breakpoint": {
          const { uri, line, user } = DebuggerBreakpointSchema.parse(args);
          const result = await client.debuggerSetBreakpoints(uri, line, user);
          return { content: [{ type: "text", text: result }] };
        }

        case "delete_debugger_breakpoint": {
          const { breakpoint_id } = DebuggerBreakpointIdSchema.parse(args);
          const result = await client.debuggerDeleteBreakpoint(breakpoint_id);
          return { content: [{ type: "text", text: result }] };
        }

        case "attach_debugger": {
          const debugMode = (args as Record<string, unknown>)?.debug_mode as string | undefined;
          const result = await client.debuggerAttach(debugMode);
          return { content: [{ type: "text", text: result }] };
        }

        case "get_debugger_stack": {
          const result = await client.debuggerGetStack();
          return { content: [{ type: "text", text: result }] };
        }

        case "get_debugger_variables": {
          const { variable_names } = DebuggerVariablesSchema.parse(args);
          const result = await client.debuggerGetVariables(variable_names);
          return { content: [{ type: "text", text: result }] };
        }

        case "get_debugger_child_variables": {
          const { variable_name } = DebuggerChildVariablesSchema.parse(args);
          const result = await client.debuggerGetChildVariables(variable_name);
          return { content: [{ type: "text", text: result }] };
        }

        case "debugger_step": {
          const { step_type, uri } = DebuggerStepSchema.parse(args);
          const result = await client.debuggerStep(step_type, uri);
          return { content: [{ type: "text", text: result }] };
        }

        case "debugger_goto_stack": {
          const { stack_type, position } = DebuggerGotoStackSchema.parse(args);
          const result = await client.debuggerGoToStack(stack_type, position);
          return { content: [{ type: "text", text: result }] };
        }

        case "set_debugger_variable_value": {
          const { variable_name, value } = DebuggerSetVariableSchema.parse(args);
          const result = await client.debuggerSetVariableValue(variable_name, value);
          return { content: [{ type: "text", text: result }] };
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

        case "change_cds_view": {
          const { name: cdsName, source } = ChangeCdsViewSchema.parse(args);
          const log = await client.changeCdsView(cdsName, source);
          return { content: [{ type: "text", text: log }] };
        }

        case "change_abap_program": {
          const { name: progName, source } = ChangeAbapProgramSchema.parse(args);
          const log = await client.changeAbapProgram(progName, source);
          return { content: [{ type: "text", text: log }] };
        }

        case "create_abap_program": {
          const { name: progName, description, source, package: pkg } = CreateProgramSchema.parse(args);
          const log = await client.createAbapProgram(progName, description, source, pkg ?? "$TMP");
          return { content: [{ type: "text", text: log }] };
        }

        case "enable_st05_trace": {
          const opts = EnableSt05Schema.parse(args);
          const result = await client.enableSt05Trace({
            user: opts.user,
            sql: opts.sql,
            buffer: opts.buffer,
            enqueue: opts.enqueue,
            rfc: opts.rfc,
            http: opts.http,
            auth: opts.auth,
            stackTrace: opts.stack_trace,
          });
          const sqlOn = result.match(/<ts:sqlOn>(\w+)<\/ts:sqlOn>/)?.[1];
          const bufOn = result.match(/<ts:bufOn>(\w+)<\/ts:bufOn>/)?.[1];
          const enqOn = result.match(/<ts:enqOn>(\w+)<\/ts:enqOn>/)?.[1];
          const rfcOn = result.match(/<ts:rfcOn>(\w+)<\/ts:rfcOn>/)?.[1];
          const httpOn = result.match(/<ts:httpOn>(\w+)<\/ts:httpOn>/)?.[1];
          const authOn = result.match(/<ts:authOn>(\w+)<\/ts:authOn>/)?.[1];
          const stackOn = result.match(/<ts:stackTraceOn>(\w+)<\/ts:stackTraceOn>/)?.[1];
          const traceUser = result.match(/<ts:traceUser>([^<]*)<\/ts:traceUser>/)?.[1] || "(all)";
          const lines = [
            "ST05 trace enabled:",
            `  User:        ${traceUser}`,
            `  SQL:         ${sqlOn}`,
            `  Buffer:      ${bufOn}`,
            `  Enqueue:     ${enqOn}`,
            `  RFC:         ${rfcOn}`,
            `  HTTP:        ${httpOn}`,
            `  Auth:        ${authOn}`,
            `  Stack trace: ${stackOn}`,
          ];
          return { content: [{ type: "text", text: lines.join("\n") }] };
        }

        case "disable_st05_trace": {
          await client.disableSt05Trace();
          return { content: [{ type: "text", text: "ST05 trace disabled." }] };
        }

        case "get_st05_trace_state": {
          const state = await client.getSt05TraceState();
          const sqlOn = state.match(/<ts:sqlOn>(\w+)<\/ts:sqlOn>/)?.[1];
          const bufOn = state.match(/<ts:bufOn>(\w+)<\/ts:bufOn>/)?.[1];
          const enqOn = state.match(/<ts:enqOn>(\w+)<\/ts:enqOn>/)?.[1];
          const rfcOn = state.match(/<ts:rfcOn>(\w+)<\/ts:rfcOn>/)?.[1];
          const httpOn = state.match(/<ts:httpOn>(\w+)<\/ts:httpOn>/)?.[1];
          const authOn = state.match(/<ts:authOn>(\w+)<\/ts:authOn>/)?.[1];
          const stackOn = state.match(/<ts:stackTraceOn>(\w+)<\/ts:stackTraceOn>/)?.[1];
          const traceUser = state.match(/<ts:traceUser>([^<]*)<\/ts:traceUser>/)?.[1] || "(none)";
          const selected = state.match(/<ts:isSelected>(\w+)<\/ts:isSelected>/)?.[1];
          const instance = state.match(/<ts:instance>([^<]+)<\/ts:instance>/)?.[1];
          const modUser = state.match(/<ts:modificationUser>([^<]*)<\/ts:modificationUser>/)?.[1];
          const modTime = state.match(/<ts:modificationDateTime>([^<]*)<\/ts:modificationDateTime>/)?.[1];
          const active = selected === "true" && (sqlOn === "true" || bufOn === "true" || enqOn === "true" || rfcOn === "true" || httpOn === "true" || authOn === "true");
          const lines = [
            `ST05 trace state: ${active ? "ACTIVE" : "INACTIVE"}`,
            `  Server:      ${instance}`,
            `  User filter: ${traceUser}`,
            `  SQL:         ${sqlOn}`,
            `  Buffer:      ${bufOn}`,
            `  Enqueue:     ${enqOn}`,
            `  RFC:         ${rfcOn}`,
            `  HTTP:        ${httpOn}`,
            `  Auth:        ${authOn}`,
            `  Stack trace: ${stackOn}`,
            `  Modified by: ${modUser} at ${modTime}`,
          ];
          return { content: [{ type: "text", text: lines.join("\n") }] };
        }

        case "enable_cross_trace": {
          const opts = EnableCrossTraceSchema.parse(args);
          const result = await client.enableCrossTrace({
            user: opts.user,
            description: opts.description,
            maxTraces: opts.max_traces,
            expiryHours: opts.expiry_hours,
            components: opts.components,
            traceLevel: opts.trace_level,
            requestTypeFilter: opts.request_type_filter,
          });
          const aid = result.match(/<sxt:activationId>([^<]+)<\/sxt:activationId>/)?.[1] ?? "?";
          const user = result.match(/<sxt:userFilter>([^<]*)<\/sxt:userFilter>/)?.[1] ?? "(all)";
          const enabled = result.match(/<sxt:enabled>([^<]+)<\/sxt:enabled>/)?.[1];
          const maxTr = result.match(/<sxt:maxNumberOfTraces>([^<]+)<\/sxt:maxNumberOfTraces>/)?.[1];
          const delTime = result.match(/<sxt:deletionTime>([^<]+)<\/sxt:deletionTime>/)?.[1];
          const comps = [...result.matchAll(/<sxt:component><sxt:component>([^<]+)<\/sxt:component>/g)];
          const lines = [
            "Cross Trace activated:",
            `  Activation ID: ${aid}`,
            `  User:          ${user}`,
            `  Enabled:       ${enabled}`,
            `  Max traces:    ${maxTr}`,
            `  Expires:       ${delTime}`,
            `  Components:    ${comps.length}`,
          ];
          return { content: [{ type: "text", text: lines.join("\n") }] };
        }

        case "disable_cross_trace": {
          const { activation_id } = CrossTraceIdSchema.parse(args);
          const result = await client.disableCrossTrace(activation_id);
          return { content: [{ type: "text", text: result }] };
        }

        case "get_cross_trace_activations": {
          const result = await client.getCrossTraceActivations();
          const activations = [...result.matchAll(/<sxt:activation>([\s\S]*?)<\/sxt:activation>/g)];
          if (activations.length === 0) {
            return { content: [{ type: "text", text: "No active cross trace activations." }] };
          }
          const lines = [`${activations.length} activation(s):\n`];
          for (const [, a] of activations) {
            const aid = a.match(/<sxt:activationId>([^<]+)<\/sxt:activationId>/)?.[1] ?? "?";
            const user = a.match(/<sxt:userFilter>([^<]*)<\/sxt:userFilter>/)?.[1] || "(all)";
            const enabled = a.match(/<sxt:enabled>([^<]+)<\/sxt:enabled>/)?.[1];
            const maxTr = a.match(/<sxt:maxNumberOfTraces>([^<]+)<\/sxt:maxNumberOfTraces>/)?.[1];
            const numTr = a.match(/<sxt:numberOfTraces>([^<]+)<\/sxt:numberOfTraces>/)?.[1];
            const delTime = a.match(/<sxt:deletionTime>([^<]+)<\/sxt:deletionTime>/)?.[1];
            const desc = a.match(/<sxt:description>([^<]*)<\/sxt:description>/)?.[1];
            const comps = [...a.matchAll(/<sxt:component><sxt:component>([^<]+)<\/sxt:component>/g)];
            lines.push(`  ID:          ${aid}`);
            lines.push(`  Description: ${desc}`);
            lines.push(`  User:        ${user}`);
            lines.push(`  Enabled:     ${enabled}`);
            lines.push(`  Traces:      ${numTr}/${maxTr}`);
            lines.push(`  Expires:     ${delTime}`);
            lines.push(`  Components:  ${comps.length}`);
            lines.push("");
          }
          return { content: [{ type: "text", text: lines.join("\n") }] };
        }

        case "list_cross_traces": {
          const { user } = CrossTraceUserSchema.parse(args);
          const result = await client.listCrossTraces(user);
          const traces = [...result.matchAll(/<sxt:trace>([\s\S]*?)<\/sxt:trace>/g)];
          if (traces.length === 0) {
            return { content: [{ type: "text", text: "No cross traces found." }] };
          }
          const typeMap: Record<string, string> = {
            T: "Transaction", C: "RFC", U: "URL", S: "Submit", B: "Batch",
            V: "Update", O: "OData V2", "4": "OData V4", D: "Daemon", Q: "SQL Service",
          };
          const counts: Record<string, number> = {};
          const traceLines: string[] = [];
          for (const [, t] of traces) {
            const tid = t.match(/<sxt:traceId>([^<]+)<\/sxt:traceId>/)?.[1] ?? "?";
            const rtype = t.match(/<sxt:requestType>([^<]*)<\/sxt:requestType>/)?.[1] ?? "?";
            const rname = t.match(/<sxt:requestName>([^<]*)<\/sxt:requestName>/)?.[1] ?? "?";
            const nrecs = t.match(/<sxt:numberOfRecords>([^<]+)<\/sxt:numberOfRecords>/)?.[1] ?? "0";
            const typeName = typeMap[rtype] ?? rtype;
            counts[rname] = (counts[rname] || 0) + 1;
            traceLines.push(`  ${tid}  ${typeName.padEnd(10)}  ${rname}  (${nrecs} records)`);
          }
          const summary = Object.entries(counts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([name, count]) => `  ${name}: ${count}`)
            .join("\n");
          const lines = [
            `${traces.length} cross trace(s):\n`,
            `Top services:\n${summary}\n`,
            `All traces:`,
            ...traceLines,
          ];
          return { content: [{ type: "text", text: lines.join("\n") }] };
        }

        case "get_cross_trace_records": {
          const { trace_id } = CrossTraceRecordsSchema.parse(args);
          const result = await client.getCrossTraceRecords(trace_id);
          return { content: [{ type: "text", text: result }] };
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

        case "fetch_st22_dumps": {
          const parsed = FetchSt22Schema.parse(args);
          const dateStr = parsed.date.replace(/-/g, "");
          const maxRows = parsed.max_results ?? 100;

          let query = `SELECT datum, uzeit, uname, ahost, flist FROM snap WHERE datum = '${dateStr}' AND seqno = '000'`;
          if (parsed.user) {
            query += ` AND uname = '${parsed.user.toUpperCase()}'`;
          }
          query += ` ORDER BY uzeit DESCENDING UP TO ${maxRows} ROWS`;

          const xml = await client.executeFreestyleSql(query);
          const dumps = parseSnapDumps(xml);
          const displayDate = `${dateStr.substring(0, 4)}-${dateStr.substring(4, 6)}-${dateStr.substring(6, 8)}`;
          const text = formatSt22Dumps(dumps, displayDate);
          return { content: [{ type: "text", text }] };
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
