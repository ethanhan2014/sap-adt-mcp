# SAP ADT MCP Server

MCP server for SAP ABAP Development Tools (ADT) REST API. Enables AI assistants to read ABAP source code, inspect DDIC objects, execute SQL queries, manage transports, analyze traces, control the debugger, and more.

## Tools (46)

### Source Code & DDIC (11)

| Tool | Description | Input |
|------|-------------|-------|
| `get_abap_program` | Fetch ABAP program/report source code | `name` |
| `get_class` | Fetch ABAP class source code | `name` |
| `get_function_module` | Fetch function module source code | `function_group`, `function_name` |
| `get_function_group` | Fetch function group source code | `name` |
| `get_include` | Fetch ABAP include source code | `name` |
| `get_interface` | Fetch ABAP interface source code | `name` |
| `get_cds_view` | Fetch CDS view DDL source | `name` |
| `get_structure` | Fetch DDIC structure definition | `name` |
| `get_table` | Fetch ABAP database table definition | `name` |
| `get_data_element` | Fetch DDIC data element definition | `name` |
| `get_domain` | Fetch DDIC domain definition | `name` |

### Repository & Search (3)

| Tool | Description | Input |
|------|-------------|-------|
| `search_object` | Search ABAP objects by name pattern (wildcards supported) | `query`, `max_results?` |
| `get_transaction` | Fetch transaction details (package, app component) | `name` |
| `get_package` | Fetch package contents (objects with types/descriptions) | `name` |

### Create & Execute (4)

| Tool | Description | Input |
|------|-------------|-------|
| `create_abap_program` | Create, write source, and activate a program | `name`, `description`, `source`, `package?` |
| `create_cds_view` | Create, write source, and activate a CDS view | `name`, `description`, `source`, `package?` |
| `execute_program` | Execute a program and return WRITE output | `name` |
| `execute_sql` | Execute ABAP SQL query and return results as table | `query` |

### Transport Management (7)

| Tool | Description | Input |
|------|-------------|-------|
| `list_user_transports` | List all modifiable transports for current user | _(none)_ |
| `get_transport` | Get full transport details (tasks, objects, status) | `transport_number` |
| `get_transport_info` | Check transport requirements for an object | `uri`, `devclass`, `operation?` |
| `create_transport` | Create a new transport request | `devclass`, `description`, `ref?`, `operation?` |
| `release_transport` | Release a transport for import | `transport_number` |
| `delete_transport` | Delete a transport request | `transport_number` |
| `list_system_users` | List SAP system users | _(none)_ |

### Trace Management (7)

| Tool | Description | Input |
|------|-------------|-------|
| `list_traces` | List ABAP runtime traces (SAT/SE30) | `user?` |
| `get_trace_hitlist` | Get performance hit list for a trace | `trace_id` |
| `get_trace_db_access` | Get database access statistics for a trace | `trace_id` |
| `get_trace_statements` | Get statement-level call tree for a trace | `trace_id` |
| `delete_trace` | Delete a runtime trace | `trace_id` |
| `create_trace_config` | Create a trace collection configuration | `object_name`, `process_type?`, `description?` |
| `delete_trace_config` | Delete a trace configuration | `config_id` |

### Service Binding (3)

| Tool | Description | Input |
|------|-------------|-------|
| `get_binding_details` | Get OData service binding details | `binding_name` |
| `publish_service_binding` | Publish an OData service binding | `binding_name`, `binding_version` |
| `unpublish_service_binding` | Unpublish an OData service binding | `binding_name`, `binding_version` |

### Debugger (11)

| Tool | Description | Input |
|------|-------------|-------|
| `start_debugger_listener` | Start debugger listener (opens stateful session) | `terminal_id?`, `ide_id?`, `user?` |
| `stop_debugger_listener` | Stop listener and close debug session | `terminal_id?`, `ide_id?`, `user?` |
| `set_debugger_breakpoint` | Set a breakpoint at a source location | `uri`, `line`, `user?` |
| `delete_debugger_breakpoint` | Remove a breakpoint | `breakpoint_id` |
| `attach_debugger` | Attach to a running ABAP debug session | `debug_mode?` |
| `get_debugger_stack` | Get the current call stack | _(none)_ |
| `get_debugger_variables` | Get variable values | `variable_names[]` |
| `get_debugger_child_variables` | Get child/nested variable values | `variable_name` |
| `debugger_step` | Step into/over/return/continue/terminate | `step_type`, `uri?` |
| `debugger_goto_stack` | Navigate to a stack frame | `stack_type`, `position` |
| `set_debugger_variable_value` | Set a variable value during debugging | `variable_name`, `value` |

### Utility (1)

| Tool | Description | Input |
|------|-------------|-------|
| `get_csrf_token` | Fetch CSRF token and session cookie | _(none)_ |

## Prerequisites

- **Node.js** v18 or later
- SAP user with **S_ADT_RES** authorization for ADT resource access
- ICF services activated under `/sap/bc/adt/` (via transaction `SICF`)
- Role **SAP_BC_DWB_ABAPDEVELOPER** or equivalent

## Installation

```bash
git clone https://github.com/ethanhan2014/sap-adt-mcp.git
cd sap-adt-mcp
npm install
cp .env.example .env
```

Edit `.env` with your SAP system connection details:

```
SAP_HOSTNAME=your-sap-host.example.com
SAP_SYSNR=50
SAP_USERNAME=YOUR_USER
SAP_PASSWORD=YOUR_PASSWORD
SAP_CLIENT=001
SAP_LANGUAGE=EN
```

Build the project:

```bash
npm run build
```

## Configuration

| Variable | Description | Example |
|----------|-------------|---------|
| `SAP_HOSTNAME` | SAP system hostname | `your-sap-host.example.com` |
| `SAP_SYSNR` | System number (port = `443` + sysnr) | `50` → port 44350 |
| `SAP_USERNAME` | SAP user | `DEVELOPER` |
| `SAP_PASSWORD` | SAP password | `secret` |
| `SAP_CLIENT` | SAP client | `001` |
| `SAP_LANGUAGE` | Logon language (default: `EN`) | `EN` |

## Usage

### Claude Code

Add to `~/.claude.json`:

```json
{
  "mcpServers": {
    "sap-adt": {
      "command": "node",
      "args": ["/path/to/sap-adt-mcp/dist/index.js"]
    }
  }
}
```

### Cline (VS Code)

Add to Cline MCP settings (`cline_mcp_settings.json`):

```json
{
  "mcpServers": {
    "sap-adt": {
      "command": "node",
      "args": ["/path/to/sap-adt-mcp/dist/index.js"],
      "disabled": false,
      "autoApprove": []
    }
  }
}
```

### Standalone

```bash
npm start
```

### Development (with MCP Inspector)

```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

## Tech Stack

- TypeScript + Node.js
- MCP SDK (`@modelcontextprotocol/sdk`)
- Axios for HTTP
- SAP ADT REST API over HTTPS with Basic Auth
