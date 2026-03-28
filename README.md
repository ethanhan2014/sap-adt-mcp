# SAP ADT MCP Server

MCP server for SAP ABAP Development Tools (ADT) REST API. Enables AI assistants to read ABAP source code, inspect DDIC objects, and execute SQL queries on SAP systems.

## Tools

| Tool | Description | Input |
|------|-------------|-------|
| `get_abap_program` | Fetch ABAP program/report source code | `name` |
| `get_data_element` | Fetch DDIC data element definition | `name` |
| `get_structure` | Fetch DDIC structure definition | `name` |
| `get_function_module` | Fetch function module source code | `function_group`, `function_name` |
| `get_class` | Fetch ABAP class source code | `name` |
| `get_cds_view` | Fetch CDS view DDL source | `name` |
| `execute_sql` | Execute ABAP SQL query and return results | `query` |

## Setup

```bash
npm install
cp .env.example .env   # Edit with your SAP system details
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

## Usage with Claude Code

Add to your Claude Code MCP configuration:

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

## Prerequisites

Your SAP user needs:
- **S_ADT_RES** authorization for ADT resource access
- ICF services activated under `/sap/bc/adt/` (via transaction `SICF`)
- Role **SAP_BC_DWB_ABAPDEVELOPER** or equivalent

## Tech Stack

- TypeScript + Node.js
- MCP SDK (`@modelcontextprotocol/sdk`)
- Axios for HTTP
- SAP ADT REST API over HTTPS with Basic Auth
