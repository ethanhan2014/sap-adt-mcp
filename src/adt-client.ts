import axios, { AxiosInstance, AxiosResponse } from "axios";
import https from "https";
import { AdtConfig, buildBaseUrl } from "./types.js";

export class AdtClient {
  private http: AxiosInstance;
  private csrfToken: string | null = null;
  private cookieJar: Record<string, string> = {};

  constructor(private config: AdtConfig) {
    this.http = axios.create({
      baseURL: buildBaseUrl(config),
      headers: { "sap-client": config.client, "sap-language": config.language },
      auth: { username: config.username, password: config.password },
      httpsAgent: new https.Agent({ rejectUnauthorized: false }),
      timeout: 30000,
    });

    this.http.interceptors.response.use((resp) => {
      const setCookies = resp.headers["set-cookie"];
      if (setCookies) {
        for (const c of setCookies) {
          const [kv] = c.split(";");
          const eq = kv.indexOf("=");
          if (eq > 0) {
            this.cookieJar[kv.substring(0, eq).trim()] = kv.substring(eq + 1).trim();
          }
        }
      }
      return resp;
    });
  }

  private getCookieString(): string {
    return Object.entries(this.cookieJar).map(([k, v]) => `${k}=${v}`).join("; ");
  }

  private statefulHeaders(extra?: Record<string, string>): Record<string, string> {
    return {
      "X-CSRF-Token": this.csrfToken!,
      Cookie: this.getCookieString(),
      "X-sap-adt-sessiontype": "stateful",
      ...extra,
    };
  }

  async getSource(path: string): Promise<string> {
    const response = await this.http.get<string>(path, {
      headers: { Accept: "text/plain" },
      responseType: "text",
    });
    return response.data;
  }

  async getMetadata(path: string): Promise<string> {
    const response = await this.http.get<string>(path, {
      headers: { Accept: "*/*" },
      responseType: "text",
    });
    return response.data;
  }

  async getSourceOrMetadata(sourcePath: string, metadataPath: string): Promise<string> {
    try {
      return await this.getSource(sourcePath);
    } catch (error: unknown) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        return await this.getMetadata(metadataPath);
      }
      throw error;
    }
  }

  async executeFreestyleSql(query: string): Promise<string> {
    const response = await this.postWithCsrf(
      "/sap/bc/adt/datapreview/freestyle",
      query,
      "application/vnd.sap.adt.datapreview.table.v1+xml"
    );
    return response.data as string;
  }

  async searchObject(query: string, maxResults = 100): Promise<string> {
    const response = await this.http.get<string>(
      `/sap/bc/adt/repository/informationsystem/search?operation=quickSearch&query=${encodeURIComponent(query)}&maxResults=${maxResults}`,
      { headers: { Accept: "*/*" }, responseType: "text" }
    );
    return response.data;
  }

  async getTransactionDetails(name: string): Promise<string> {
    const adtUri = `/sap/bc/adt/vit/wb/object_type/trant/object_name/${encodeURIComponent(name.toUpperCase())}`;
    const response = await this.http.get<string>(
      `/sap/bc/adt/repository/informationsystem/objectproperties/values?uri=${encodeURIComponent(adtUri)}&facet=package&facet=appl`,
      { headers: { Accept: "*/*" }, responseType: "text" }
    );
    return response.data;
  }

  async getPackageContents(name: string): Promise<string> {
    const body = `parent_type=DEVC%2FK&parent_name=${encodeURIComponent(name.toUpperCase())}&withShortDescriptions=true`;
    return (await this.postWithCsrf(
      "/sap/bc/adt/repository/nodestructure",
      body,
      "*/*",
      "application/x-www-form-urlencoded"
    )).data as string;
  }

  // --- Transport Management ---

  async getTransportInfo(uri: string, devclass: string, operation = "I_CTS_OBJECT_CHECK"): Promise<string> {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">
  <asx:values>
    <DATA>
      <OPERATION>${this.escapeXml(operation)}</OPERATION>
      <DEVCLASS>${this.escapeXml(devclass)}</DEVCLASS>
      <URI>${this.escapeXml(uri)}</URI>
    </DATA>
  </asx:values>
</asx:abap>`;
    return (await this.postWithCsrf(
      "/sap/bc/adt/cts/transportchecks",
      xml,
      "*/*",
      "application/vnd.sap.as+xml; charset=UTF-8; dataname=com.sap.adt.transport.service.checkData"
    )).data as string;
  }

  async createTransport(devclass: string, description: string, ref = "", operation = "I_CTS_OBJECT_CHECK"): Promise<string> {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">
  <asx:values>
    <DATA>
      <OPERATION>${this.escapeXml(operation)}</OPERATION>
      <DEVCLASS>${this.escapeXml(devclass)}</DEVCLASS>
      <REQUEST_TEXT>${this.escapeXml(description)}</REQUEST_TEXT>
      <REF>${this.escapeXml(ref)}</REF>
    </DATA>
  </asx:values>
</asx:abap>`;
    return (await this.postWithCsrf(
      "/sap/bc/adt/cts/transports",
      xml,
      "*/*",
      "application/vnd.sap.as+xml; charset=UTF-8; dataname=com.sap.adt.transport.service.createData"
    )).data as string;
  }

  async getTransport(transportNumber: string): Promise<string> {
    const response = await this.http.get<string>(
      `/sap/bc/adt/cts/transportrequests/${encodeURIComponent(transportNumber.toUpperCase())}`,
      { headers: { Accept: "*/*" }, responseType: "text" }
    );
    return response.data;
  }

  private static readonly LIST_TR_SOURCE = [
    "REPORT zhanz_list_transports.",
    "TYPES: BEGIN OF ty_req,",
    "  trkorr TYPE e070-trkorr, trfunction TYPE e070-trfunction,",
    "  trstatus TYPE e070-trstatus, as4user TYPE e070-as4user,",
    "  as4date TYPE e070-as4date, strkorr TYPE e070-strkorr,",
    "END OF ty_req.",
    "DATA: lt_req TYPE TABLE OF ty_req, lt_txt TYPE TABLE OF e07t.",
    "SELECT trkorr trfunction trstatus as4user as4date strkorr",
    "  FROM e070 INTO TABLE lt_req WHERE as4user = sy-uname AND trstatus = 'D'.",
    "IF lines( lt_req ) = 0. WRITE: / 'No modifiable transports found.'. RETURN. ENDIF.",
    "SELECT trkorr as4text FROM e07t INTO CORRESPONDING FIELDS OF TABLE lt_txt",
    "  FOR ALL ENTRIES IN lt_req WHERE trkorr = lt_req-trkorr AND langu = 'E'.",
    "WRITE: / 'TR Number   Func Stat Owner    Date       Parent     Description'.",
    "WRITE: / '----------- ---- ---- -------- ---------- ---------- --------------------'.",
    "LOOP AT lt_req ASSIGNING FIELD-SYMBOL(<r>).",
    "  DATA(lv_d) = VALUE #( lt_txt[ trkorr = <r>-trkorr ]-as4text OPTIONAL ).",
    "  WRITE: / <r>-trkorr, <r>-trfunction, <r>-trstatus, <r>-as4user, <r>-as4date, <r>-strkorr, lv_d.",
    "ENDLOOP.",
    "WRITE: /. WRITE: / 'Total:', lines( lt_req ), 'modifiable request(s)'.",
    "WRITE: / 'Func: K=Workbench W=Customizing S=Task Q=Customizing Task'.",
  ].join("\n");

  private async ensureHelperProgram(name: string, source: string): Promise<void> {
    try {
      await this.getSource(`/sap/bc/adt/programs/programs/${name}/source/main`);
    } catch (error: unknown) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        await this.createAbapProgram(name.toUpperCase(), "MCP helper program", source);
      } else {
        throw error;
      }
    }
  }

  async listUserTransports(): Promise<string> {
    await this.ensureHelperProgram("zhanz_list_transports", AdtClient.LIST_TR_SOURCE);
    return await this.executeProgram("ZHANZ_LIST_TRANSPORTS");
  }

  async releaseTransport(transportNumber: string): Promise<string> {
    return (await this.postWithCsrf(
      `/sap/bc/adt/cts/transportrequests/${encodeURIComponent(transportNumber.toUpperCase())}/newreleasejobs`,
      "",
      "*/*"
    )).data as string;
  }

  async deleteTransport(transportNumber: string): Promise<string> {
    const resp = await this.deleteWithCsrf(
      `/sap/bc/adt/cts/transportrequests/${encodeURIComponent(transportNumber.toUpperCase())}`
    );
    return resp.data as string || "Transport deleted";
  }

  async getSystemUsers(): Promise<string> {
    const response = await this.http.get<string>(
      "/sap/bc/adt/system/users",
      { headers: { Accept: "*/*" }, responseType: "text" }
    );
    return response.data;
  }

  // --- Trace Management ---

  async listTraces(user?: string): Promise<string> {
    const u = encodeURIComponent((user ?? this.config.username).toUpperCase());
    const response = await this.http.get<string>(
      `/sap/bc/adt/runtime/traces/abaptraces?user=${u}`,
      { headers: { Accept: "*/*" }, responseType: "text" }
    );
    return response.data;
  }

  async getTraceHitlist(traceId: string): Promise<string> {
    const response = await this.http.get<string>(
      `/sap/bc/adt/runtime/traces/abaptraces/${encodeURIComponent(traceId)}/hitlist`,
      { headers: { Accept: "*/*" }, responseType: "text", timeout: 120000 }
    );
    return response.data;
  }

  async getTraceDbAccess(traceId: string): Promise<string> {
    const response = await this.http.get<string>(
      `/sap/bc/adt/runtime/traces/abaptraces/${encodeURIComponent(traceId)}/dbAccesses`,
      { headers: { Accept: "*/*" }, responseType: "text", timeout: 120000 }
    );
    return response.data;
  }

  async getTraceStatements(traceId: string): Promise<string> {
    const response = await this.http.get<string>(
      `/sap/bc/adt/runtime/traces/abaptraces/${encodeURIComponent(traceId)}/statements`,
      { headers: { Accept: "*/*" }, responseType: "text", timeout: 120000 }
    );
    return response.data;
  }

  async deleteTrace(traceId: string): Promise<string> {
    const resp = await this.deleteWithCsrf(
      `/sap/bc/adt/runtime/traces/abaptraces/${encodeURIComponent(traceId)}`
    );
    return resp.data as string || "Trace deleted";
  }

  async createTraceConfig(objectName: string, processType = "any", description = "", maxExecutions = 10, objectType = "any"): Promise<string> {
    const processTypeUri = processType.startsWith("/sap/")
      ? processType
      : `/sap/bc/adt/runtime/traces/abaptraces/processtypes/${processType}`;
    const objectTypeUri = objectType.startsWith("/sap/")
      ? objectType
      : `/sap/bc/adt/runtime/traces/abaptraces/objecttypes/${objectType}`;
    const params = new URLSearchParams({
      objectName,
      objectType: objectTypeUri,
      processType: processTypeUri,
      description,
      maximalExecutions: String(maxExecutions),
    });
    return (await this.postWithCsrf(
      `/sap/bc/adt/runtime/traces/abaptraces/requests?${params.toString()}`,
      "",
      "*/*"
    )).data as string;
  }

  async deleteTraceConfig(configId: string): Promise<string> {
    const resp = await this.deleteWithCsrf(
      `/sap/bc/adt/runtime/traces/abaptraces/requests/${encodeURIComponent(configId)}`
    );
    return resp.data as string || "Trace configuration deleted";
  }

  // --- Service Binding ---

  async getBindingDetails(name: string): Promise<string> {
    const response = await this.http.get<string>(
      `/sap/bc/adt/ddic/srvb/srvbsources/${encodeURIComponent(name.toUpperCase())}`,
      { headers: { Accept: "*/*" }, responseType: "text" }
    );
    return response.data;
  }

  async publishServiceBinding(name: string, version: string): Promise<string> {
    const encoded = encodeURIComponent(name.toUpperCase());
    return (await this.postWithCsrf(
      `/sap/bc/adt/ddic/srvb/srvbsources/${encoded}/publish?version=${encodeURIComponent(version)}`,
      "",
      "*/*"
    )).data as string;
  }

  async unpublishServiceBinding(name: string, version: string): Promise<string> {
    const encoded = encodeURIComponent(name.toUpperCase());
    return (await this.postWithCsrf(
      `/sap/bc/adt/ddic/srvb/srvbsources/${encoded}/unpublish?version=${encodeURIComponent(version)}`,
      "",
      "*/*"
    )).data as string;
  }

  // --- Cross Trace ---

  async getCrossTraceComponents(): Promise<string[]> {
    const response = await this.http.get<string>(
      "/sap/bc/adt/crosstrace/components",
      { headers: { Accept: "*/*" }, responseType: "text" }
    );
    const names = [...response.data.matchAll(/<nameditem:name>([^<]+)<\/nameditem:name>/g)].map(m => m[1]);
    return [...new Set(names)];
  }

  async getCrossTraceActivations(): Promise<string> {
    const response = await this.http.get<string>(
      "/sap/bc/adt/crosstrace/activations",
      { headers: { Accept: "application/vnd.sap.adt.crosstrace.activations.v1+xml" }, responseType: "text" }
    );
    return response.data;
  }

  async enableCrossTrace(options: {
    user?: string;
    description?: string;
    maxTraces?: number;
    expiryHours?: number;
    components?: string[];
    traceLevel?: number;
    requestTypeFilter?: string;
  }): Promise<string> {
    const traceUser = (options.user ?? this.config.username).toUpperCase();
    const desc = options.description ?? `Cross trace ${traceUser}`;
    const maxTraces = options.maxTraces ?? 100;
    const expiryHours = options.expiryHours ?? 24;
    const traceLevel = options.traceLevel ?? 2;

    const expiry = new Date(Date.now() + expiryHours * 3600000);
    const deletionTime = expiry.toISOString().replace(/\.\d+Z$/, ".0000000Z");

    let componentNames = options.components;
    if (!componentNames || componentNames.length === 0) {
      componentNames = await this.getCrossTraceComponents();
    }

    const componentsXml = componentNames
      .map(c => `    <sxt:component><sxt:component>${this.escapeXml(c)}</sxt:component><sxt:traceLevel>${traceLevel}</sxt:traceLevel></sxt:component>`)
      .join("\n");

    const requestTypeFilter = options.requestTypeFilter ?? "";

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<sxt:activation xmlns:sxt="http://www.sap.com/adt/crosstrace/traces">
  <sxt:deletionTime>${deletionTime}</sxt:deletionTime>
  <sxt:description>${this.escapeXml(desc)}</sxt:description>
  <sxt:enabled>true</sxt:enabled>
  <sxt:userFilter>${this.escapeXml(traceUser)}</sxt:userFilter>
  <sxt:requestTypeFilter>${this.escapeXml(requestTypeFilter)}</sxt:requestTypeFilter>
  <sxt:components>
${componentsXml}
  </sxt:components>
  <sxt:maxNumberOfTraces>${maxTraces}</sxt:maxNumberOfTraces>
</sxt:activation>`;

    return (await this.postWithCsrf(
      "/sap/bc/adt/crosstrace/activations",
      xml,
      "application/vnd.sap.adt.crosstrace.activations.v1+xml",
      "application/vnd.sap.adt.crosstrace.activations.v1+xml"
    )).data as string;
  }

  async disableCrossTrace(activationId: string): Promise<string> {
    const resp = await this.deleteWithCsrf(
      `/sap/bc/adt/crosstrace/activations/${encodeURIComponent(activationId)}`
    );
    return resp.data as string || "Cross trace activation deleted";
  }

  async listCrossTraces(user?: string): Promise<string> {
    const traceUser = (user ?? this.config.username).toUpperCase();
    const response = await this.http.get<string>(
      `/sap/bc/adt/crosstrace/traces?traceUser=${encodeURIComponent(traceUser)}`,
      { headers: { Accept: "application/vnd.sap.adt.crosstrace.traces.v1+xml" }, responseType: "text" }
    );
    return response.data;
  }

  async getCrossTraceDetail(traceId: string): Promise<string> {
    const response = await this.http.get<string>(
      `/sap/bc/adt/crosstrace/traces/${encodeURIComponent(traceId)}`,
      { headers: { Accept: "application/vnd.sap.adt.crosstrace.traces.v1+xml" }, responseType: "text" }
    );
    return response.data;
  }

  async getCrossTraceRecords(traceId: string): Promise<string> {
    const response = await this.http.get<string>(
      `/sap/bc/adt/crosstrace/traces/${encodeURIComponent(traceId)}/records`,
      { headers: { Accept: "*/*" }, responseType: "text" }
    );
    return response.data;
  }

  // --- Debugger ---

  private debugSessionActive = false;

  private ensureDebugSession(): void {
    if (!this.debugSessionActive) {
      throw new Error("No active debug session. Call start_debugger_listener first.");
    }
  }

  async debuggerListen(terminalId = "MCP_TERMINAL", ideId = "MCP_IDE", user?: string): Promise<string> {
    await this.fetchStatefulCsrf();
    this.debugSessionActive = true;
    const u = encodeURIComponent((user ?? this.config.username).toUpperCase());
    const resp = await this.http.post(
      `/sap/bc/adt/debugger/listeners?debuggingMode=user&terminalId=${encodeURIComponent(terminalId)}&ideId=${encodeURIComponent(ideId)}&requestUser=${u}`,
      "",
      {
        headers: this.statefulHeaders({ Accept: "application/xml" }),
        responseType: "text",
        timeout: 360000000,
      }
    );
    return resp.data as string;
  }

  async debuggerDeleteListener(terminalId = "MCP_TERMINAL", ideId = "MCP_IDE", user?: string): Promise<string> {
    this.ensureDebugSession();
    const u = encodeURIComponent((user ?? this.config.username).toUpperCase());
    try {
      const resp = await this.http.delete(
        `/sap/bc/adt/debugger/listeners?debuggingMode=user&terminalId=${encodeURIComponent(terminalId)}&ideId=${encodeURIComponent(ideId)}&requestUser=${u}`,
        { headers: this.statefulHeaders(), responseType: "text" }
      );
      return resp.data as string || "Debugger listener stopped";
    } finally {
      this.debugSessionActive = false;
      await this.endStatefulSession();
    }
  }

  async debuggerGetSession(terminalId = "MCP_TERMINAL", ideId = "MCP_IDE", user?: string): Promise<string> {
    this.ensureDebugSession();
    const u = encodeURIComponent((user ?? this.config.username).toUpperCase());
    const resp = await this.http.get(
      `/sap/bc/adt/debugger/listeners?debuggingMode=user&terminalId=${encodeURIComponent(terminalId)}&ideId=${encodeURIComponent(ideId)}&requestUser=${u}`,
      {
        headers: this.statefulHeaders({ Accept: "application/xml" }),
        responseType: "text",
      }
    );
    return resp.data as string;
  }

  async debuggerSetBreakpoints(uri: string, line: number, user?: string): Promise<string> {
    this.ensureDebugSession();
    const u = (user ?? this.config.username).toUpperCase();
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<dbg:breakpoints xmlns:dbg="http://www.sap.com/adt/debugger">
  <dbg:breakpoint dbg:kind="line" dbg:uri="${this.escapeXml(uri)}" dbg:line="${line}" dbg:user="${this.escapeXml(u)}"/>
</dbg:breakpoints>`;
    const resp = await this.http.post("/sap/bc/adt/debugger/breakpoints", xml, {
      headers: this.statefulHeaders({
        "Content-Type": "application/xml",
        Accept: "application/xml",
      }),
      responseType: "text",
    });
    return resp.data as string;
  }

  async debuggerDeleteBreakpoint(breakpointId: string): Promise<string> {
    this.ensureDebugSession();
    const resp = await this.http.delete(
      `/sap/bc/adt/debugger/breakpoints/${encodeURIComponent(breakpointId)}`,
      { headers: this.statefulHeaders(), responseType: "text" }
    );
    return resp.data as string || "Breakpoint deleted";
  }

  async debuggerAttach(debugMode = "user"): Promise<string> {
    this.ensureDebugSession();
    const resp = await this.http.post(
      `/sap/bc/adt/debugger?method=attach&debuggingMode=${encodeURIComponent(debugMode)}&requestUser=${encodeURIComponent(this.config.username.toUpperCase())}`,
      "",
      {
        headers: this.statefulHeaders({ Accept: "application/xml" }),
        responseType: "text",
      }
    );
    return resp.data as string;
  }

  async debuggerGetStack(): Promise<string> {
    this.ensureDebugSession();
    const resp = await this.http.post(
      "/sap/bc/adt/debugger?method=getStack",
      "",
      {
        headers: this.statefulHeaders({ Accept: "application/xml" }),
        responseType: "text",
      }
    );
    return resp.data as string;
  }

  async debuggerGetVariables(variableNames: string[]): Promise<string> {
    this.ensureDebugSession();
    const items = variableNames.map(n => `<dbg:variable><dbg:name>${this.escapeXml(n)}</dbg:name></dbg:variable>`).join("");
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<dbg:variableRequests xmlns:dbg="http://www.sap.com/adt/debugger">${items}</dbg:variableRequests>`;
    const resp = await this.http.post("/sap/bc/adt/debugger?method=getVariables", xml, {
      headers: this.statefulHeaders({
        "Content-Type": "application/xml",
        Accept: "application/xml",
      }),
      responseType: "text",
    });
    return resp.data as string;
  }

  async debuggerGetChildVariables(variableName: string): Promise<string> {
    this.ensureDebugSession();
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<dbg:variableRequests xmlns:dbg="http://www.sap.com/adt/debugger">
  <dbg:variable><dbg:name>${this.escapeXml(variableName)}</dbg:name></dbg:variable>
</dbg:variableRequests>`;
    const resp = await this.http.post("/sap/bc/adt/debugger?method=getChildVariables", xml, {
      headers: this.statefulHeaders({
        "Content-Type": "application/xml",
        Accept: "application/xml",
      }),
      responseType: "text",
    });
    return resp.data as string;
  }

  async debuggerStep(stepType: string, uri?: string): Promise<string> {
    this.ensureDebugSession();
    let url = `/sap/bc/adt/debugger?method=${encodeURIComponent(stepType)}`;
    if (uri) url += `&uri=${encodeURIComponent(uri)}`;
    const resp = await this.http.post(url, "", {
      headers: this.statefulHeaders({ Accept: "application/xml" }),
      responseType: "text",
    });
    return resp.data as string;
  }

  async debuggerGoToStack(stackType: string, position: number): Promise<string> {
    this.ensureDebugSession();
    const resp = await this.http.put(
      `/sap/bc/adt/debugger/stack/type/${encodeURIComponent(stackType)}/position/${position}`,
      "",
      {
        headers: this.statefulHeaders(),
        responseType: "text",
      }
    );
    return resp.data as string || "Navigated to stack frame";
  }

  async debuggerSetVariableValue(variableName: string, value: string): Promise<string> {
    this.ensureDebugSession();
    const resp = await this.http.post(
      `/sap/bc/adt/debugger?method=setVariableValue&variableName=${encodeURIComponent(variableName)}`,
      value,
      {
        headers: this.statefulHeaders({ "Content-Type": "text/plain", Accept: "text/plain" }),
        responseType: "text",
      }
    );
    return resp.data as string;
  }

  async debuggerInsertWatchpoint(variableName: string, condition?: string): Promise<string> {
    this.ensureDebugSession();
    const params = new URLSearchParams({ variableName });
    if (condition) params.set("condition", condition);
    const resp = await this.http.post(
      `/sap/bc/adt/debugger/watchpoints?${params.toString()}`,
      "",
      {
        headers: this.statefulHeaders({ Accept: "application/xml" }),
        responseType: "text",
      }
    );
    return resp.data as string;
  }

  async debuggerGetWatchpoints(): Promise<string> {
    this.ensureDebugSession();
    const resp = await this.http.get("/sap/bc/adt/debugger/watchpoints", {
      headers: this.statefulHeaders({ Accept: "application/xml" }),
      responseType: "text",
    });
    return resp.data as string;
  }

  async getCsrfToken(): Promise<{ token: string; cookies: string }> {
    await this.fetchCsrfToken();
    return { token: this.csrfToken!, cookies: this.getCookieString() };
  }

  async executeProgram(name: string): Promise<string> {
    await this.fetchStatefulCsrf();
    try {
      const resp = await this.http.post(
        `/sap/bc/adt/programs/programrun/${encodeURIComponent(name.toLowerCase())}`,
        "",
        {
          headers: this.statefulHeaders({ Accept: "text/plain" }),
          responseType: "text",
        }
      );
      return resp.data as string;
    } finally {
      await this.endStatefulSession();
    }
  }

  async createAbapProgram(name: string, description: string, source: string, pkg = "$TMP"): Promise<string> {
    await this.fetchStatefulCsrf();
    const log: string[] = [];

    try {
      // 1. Create program shell
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<program:abapProgram xmlns:program="http://www.sap.com/adt/programs/programs"
  xmlns:adtcore="http://www.sap.com/adt/core"
  adtcore:type="PROG/P" adtcore:description="${this.escapeXml(description)}"
  adtcore:language="EN" adtcore:name="${name.toUpperCase()}"
  adtcore:masterLanguage="EN" adtcore:responsible="${this.config.username.toUpperCase()}">
  <adtcore:packageRef adtcore:name="${pkg}"/>
</program:abapProgram>`;

      await this.http.post("/sap/bc/adt/programs/programs", xml, {
        headers: this.statefulHeaders({
          "Content-Type": "application/vnd.sap.adt.programs.programs+xml; charset=utf-8",
          Accept: "application/vnd.sap.adt.programs.programs+xml",
        }),
      });
      log.push(`Created program ${name.toUpperCase()} in package ${pkg}`);

      // 2. Lock
      const lockResp = await this.http.post(
        `/sap/bc/adt/programs/programs/${name.toLowerCase()}?_action=LOCK&accessMode=MODIFY`,
        "",
        { headers: this.statefulHeaders(), responseType: "text" }
      );
      const lockMatch = (lockResp.data as string).match(/<LOCK_HANDLE>([^<]+)<\/LOCK_HANDLE>/);
      const lockHandle = lockMatch?.[1];
      if (!lockHandle) throw new Error("Failed to obtain lock handle");
      log.push("Locked for editing");

      // 3. Write source
      await this.http.put(
        `/sap/bc/adt/programs/programs/${name.toLowerCase()}/source/main?lockHandle=${encodeURIComponent(lockHandle)}`,
        source,
        {
          headers: this.statefulHeaders({ "Content-Type": "text/plain; charset=utf-8" }),
          responseType: "text",
        }
      );
      log.push("Source code written");

      // 4. Unlock
      await this.http.post(
        `/sap/bc/adt/programs/programs/${name.toLowerCase()}?_action=UNLOCK&lockHandle=${encodeURIComponent(lockHandle)}`,
        "",
        { headers: this.statefulHeaders(), responseType: "text" }
      );
      log.push("Unlocked");

      // 5. Activate
      const activateBody = `<?xml version="1.0" encoding="UTF-8"?>
<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core">
  <adtcore:objectReference adtcore:uri="/sap/bc/adt/programs/programs/${name.toLowerCase()}" adtcore:name="${name.toUpperCase()}"/>
</adtcore:objectReferences>`;

      const actResp = await this.http.post(
        "/sap/bc/adt/activation?method=activate&preauditRequested=true",
        activateBody,
        {
          headers: this.statefulHeaders({
            "Content-Type": "application/xml",
            Accept: "application/xml",
          }),
          responseType: "text",
          validateStatus: () => true,
        }
      );

      const actData = actResp.data as string;
      if (actData.includes('activationExecuted="true"')) {
        log.push("Activated successfully");
      } else if (actData.includes("<msg:shortText>")) {
        const msgMatch = actData.match(/<msg:shortText>([\s\S]*?)<\/msg:shortText>/);
        log.push(`Activation warning: ${msgMatch?.[1] ?? "check messages"}`);
      } else {
        log.push(`Activation response: ${actResp.status}`);
      }
    } finally {
      await this.endStatefulSession();
    }

    return log.join("\n");
  }

  async changeAbapProgram(name: string, source: string, transport?: string): Promise<string> {
    await this.fetchStatefulCsrf();
    const log: string[] = [];
    const nameLower = name.toLowerCase();
    const nameUpper = name.toUpperCase();

    try {
      // 1. Lock
      const lockResp = await this.http.post(
        `/sap/bc/adt/programs/programs/${nameLower}?_action=LOCK&accessMode=MODIFY`,
        "",
        { headers: this.statefulHeaders(), responseType: "text", validateStatus: () => true }
      );
      const lockData = lockResp.data as string;
      const lockMatch = lockData.match(/<LOCK_HANDLE>([^<]+)<\/LOCK_HANDLE>/);

      if (!lockMatch?.[1]) {
        log.push(`Failed to lock program ${nameUpper} (HTTP ${lockResp.status})`);
        log.push(lockData.substring(0, 500));
        return log.join("\n");
      }

      const lockHandle = lockMatch[1];
      log.push(`Locked ${nameUpper} for editing`);

      // 2. Write source (auto-detect transport if not provided)
      let corrNr = transport ?? "";
      let writeResp = await this.http.put(
        `/sap/bc/adt/programs/programs/${nameLower}/source/main?lockHandle=${encodeURIComponent(lockHandle)}&corrNr=${corrNr}`,
        source,
        {
          headers: this.statefulHeaders({ "Content-Type": "text/plain; charset=utf-8" }),
          responseType: "text",
          validateStatus: () => true,
        }
      );
      if (writeResp.status >= 400 && !transport) {
        const trMatch = (writeResp.data as string).match(/request\s+([A-Z]{3}K\d{6})/);
        if (trMatch) {
          corrNr = trMatch[1];
          log.push(`Auto-detected transport ${corrNr}`);
          writeResp = await this.http.put(
            `/sap/bc/adt/programs/programs/${nameLower}/source/main?lockHandle=${encodeURIComponent(lockHandle)}&corrNr=${corrNr}`,
            source,
            {
              headers: this.statefulHeaders({ "Content-Type": "text/plain; charset=utf-8" }),
              responseType: "text",
              validateStatus: () => true,
            }
          );
        }
      }
      if (writeResp.status >= 400) {
        log.push(`Write failed (HTTP ${writeResp.status}): ${(writeResp.data as string).substring(0, 500)}`);
      } else {
        log.push("Source code written");
      }

      // 3. Unlock (must unlock before activation)
      await this.http.post(
        `/sap/bc/adt/programs/programs/${nameLower}?_action=UNLOCK&lockHandle=${encodeURIComponent(lockHandle)}`,
        "",
        { headers: this.statefulHeaders(), responseType: "text", validateStatus: () => true }
      );
      log.push("Unlocked");

      // 4. Activate
      const activateBody = `<?xml version="1.0" encoding="UTF-8"?>
<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core">
  <adtcore:objectReference adtcore:uri="/sap/bc/adt/programs/programs/${nameLower}" adtcore:name="${nameUpper}"/>
</adtcore:objectReferences>`;

      const actResp = await this.http.post(
        "/sap/bc/adt/activation?method=activate&preauditRequested=true",
        activateBody,
        {
          headers: this.statefulHeaders({
            "Content-Type": "application/xml",
            Accept: "application/xml",
          }),
          responseType: "text",
          validateStatus: () => true,
        }
      );

      const actData = actResp.data as string;
      if (actData.includes('activationExecuted="true"')) {
        log.push("Activated successfully");
      } else {
        const msgMatch = actData.match(/<msg:shortText>([\s\S]*?)<\/msg:shortText>/);
        log.push(`Activation: ${msgMatch?.[1] ?? `HTTP ${actResp.status}`}`);
      }
    } finally {
      await this.endStatefulSession();
    }

    return log.join("\n");
  }

  async changeCdsView(name: string, source: string): Promise<string> {
    await this.fetchStatefulCsrf();
    const log: string[] = [];
    const nameLower = name.toLowerCase();
    const nameUpper = name.toUpperCase();

    try {
      // 1. Lock
      const lockResp = await this.http.post(
        `/sap/bc/adt/ddic/ddl/sources/${nameLower}?_action=LOCK&accessMode=MODIFY`,
        "",
        { headers: this.statefulHeaders(), responseType: "text", validateStatus: () => true }
      );
      const lockData = lockResp.data as string;
      const lockMatch = lockData.match(/<LOCK_HANDLE>([^<]+)<\/LOCK_HANDLE>/);

      if (!lockMatch?.[1]) {
        log.push(`Failed to lock DDL source ${nameUpper} (HTTP ${lockResp.status})`);
        log.push(lockData.substring(0, 500));
        return log.join("\n");
      }

      const lockHandle = lockMatch[1];
      log.push(`Locked ${nameUpper} for editing`);

      // 2. Write source
      await this.http.put(
        `/sap/bc/adt/ddic/ddl/sources/${nameLower}/source/main?lockHandle=${encodeURIComponent(lockHandle)}`,
        source,
        {
          headers: this.statefulHeaders({ "Content-Type": "text/plain; charset=utf-8" }),
          responseType: "text",
        }
      );
      log.push("Source code written");

      // 3. Activate
      const activateBody = `<?xml version="1.0" encoding="UTF-8"?>
<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core">
  <adtcore:objectReference adtcore:uri="/sap/bc/adt/ddic/ddl/sources/${nameLower}" adtcore:name="${nameUpper}"/>
</adtcore:objectReferences>`;

      const actResp = await this.http.post(
        "/sap/bc/adt/activation?method=activate&preauditRequested=true",
        activateBody,
        {
          headers: this.statefulHeaders({
            "Content-Type": "application/xml",
            Accept: "application/xml",
          }),
          responseType: "text",
          validateStatus: () => true,
        }
      );

      const actData = actResp.data as string;
      if (actData.includes('activationExecuted="true"')) {
        log.push("Activated successfully");
      } else {
        const msgMatch = actData.match(/<msg:shortText>([\s\S]*?)<\/msg:shortText>/);
        log.push(`Activation: ${msgMatch?.[1] ?? `HTTP ${actResp.status}`}`);
      }

      // 4. Unlock
      await this.http.post(
        `/sap/bc/adt/ddic/ddl/sources/${nameLower}?_action=UNLOCK&lockHandle=${encodeURIComponent(lockHandle)}`,
        "",
        { headers: this.statefulHeaders(), responseType: "text" }
      );
      log.push("Unlocked");
    } finally {
      await this.endStatefulSession();
    }

    return log.join("\n");
  }

  async createCdsView(name: string, description: string, source: string, pkg = "$TMP"): Promise<string> {
    await this.fetchStatefulCsrf();
    const log: string[] = [];
    const nameLower = name.toLowerCase();
    const nameUpper = name.toUpperCase();

    try {
      // 1. Create DDL source shell
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ddl:ddlSource xmlns:ddl="http://www.sap.com/adt/ddic/ddlsources"
  xmlns:adtcore="http://www.sap.com/adt/core"
  adtcore:type="DDLS/DF" adtcore:description="${this.escapeXml(description)}"
  adtcore:language="EN" adtcore:name="${nameUpper}"
  adtcore:masterLanguage="EN" adtcore:responsible="${this.config.username.toUpperCase()}">
  <adtcore:packageRef adtcore:name="${pkg}"/>
</ddl:ddlSource>`;

      const createResp = await this.http.post("/sap/bc/adt/ddic/ddl/sources", xml, {
        headers: this.statefulHeaders({
          "Content-Type": "application/vnd.sap.adt.ddlSource+xml; charset=utf-8",
          Accept: "application/vnd.sap.adt.ddlSource+xml",
        }),
        validateStatus: () => true,
      });

      if (createResp.status >= 400) {
        const errData = createResp.data as string;
        const msgMatch = errData.match(/<msg:shortText>([\s\S]*?)<\/msg:shortText>/);
        log.push(`Failed to create DDL source ${nameUpper} (HTTP ${createResp.status}): ${msgMatch?.[1] ?? errData.substring(0, 500)}`);
        return log.join("\n");
      }
      log.push(`Created DDL source ${nameUpper} in package ${pkg}`);

      // 2. Lock
      const lockResp = await this.http.post(
        `/sap/bc/adt/ddic/ddl/sources/${nameLower}?_action=LOCK&accessMode=MODIFY`,
        "",
        { headers: this.statefulHeaders(), responseType: "text", validateStatus: () => true }
      );
      const lockData = lockResp.data as string;
      const lockMatch = lockData.match(/<LOCK_HANDLE>([^<]+)<\/LOCK_HANDLE>/);

      if (!lockMatch?.[1]) {
        log.push(`Failed to lock DDL source (HTTP ${lockResp.status}): ${lockData.substring(0, 500)}`);
        return log.join("\n");
      }

      const lockHandle = lockMatch[1];
      log.push("Locked for editing");

      // 3. Write source
      await this.http.put(
        `/sap/bc/adt/ddic/ddl/sources/${nameLower}/source/main?lockHandle=${encodeURIComponent(lockHandle)}`,
        source,
        {
          headers: this.statefulHeaders({ "Content-Type": "text/plain; charset=utf-8" }),
          responseType: "text",
        }
      );
      log.push("Source code written");

      // 4. Activate (must happen while still locked)
      const activateBody = `<?xml version="1.0" encoding="UTF-8"?>
<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core">
  <adtcore:objectReference adtcore:uri="/sap/bc/adt/ddic/ddl/sources/${nameLower}" adtcore:name="${nameUpper}"/>
</adtcore:objectReferences>`;

      const actResp = await this.http.post(
        "/sap/bc/adt/activation?method=activate&preauditRequested=true",
        activateBody,
        {
          headers: this.statefulHeaders({
            "Content-Type": "application/xml",
            Accept: "application/xml",
          }),
          responseType: "text",
          validateStatus: () => true,
        }
      );

      const actData = actResp.data as string;
      if (actData.includes('activationExecuted="true"')) {
        log.push("Activated successfully");
      } else {
        const msgMatch = actData.match(/<msg:shortText>([\s\S]*?)<\/msg:shortText>/);
        log.push(`Activation: ${msgMatch?.[1] ?? `HTTP ${actResp.status}`}`);
      }

      // 5. Unlock (after activation)
      await this.http.post(
        `/sap/bc/adt/ddic/ddl/sources/${nameLower}?_action=UNLOCK&lockHandle=${encodeURIComponent(lockHandle)}`,
        "",
        { headers: this.statefulHeaders(), responseType: "text" }
      );
      log.push("Unlocked");
    } finally {
      await this.endStatefulSession();
    }

    return log.join("\n");
  }

  private async fetchStatefulCsrf(): Promise<void> {
    const response = await this.http.get("/sap/bc/adt/discovery", {
      headers: {
        "X-CSRF-Token": "Fetch",
        Accept: "*/*",
        "X-sap-adt-sessiontype": "stateful",
      },
    });
    const token = response.headers["x-csrf-token"];
    if (!token) throw new Error("Failed to fetch CSRF token");
    this.csrfToken = token;
  }

  private async endStatefulSession(): Promise<void> {
    try {
      await this.http.post("/sap/bc/adt/discovery", "", {
        headers: {
          ...this.statefulHeaders(),
          "X-sap-adt-sessiontype": "stateless",
        },
        validateStatus: () => true,
      });
    } catch {
      // Best-effort session cleanup
    }
  }

  // --- ST05 Performance Trace ---

  async getSt05TraceState(): Promise<string> {
    const response = await this.http.get<string>(
      "/sap/bc/adt/st05/trace/state",
      { headers: { Accept: "*/*" }, responseType: "text" }
    );
    return response.data;
  }

  async enableSt05Trace(options: {
    user?: string;
    sql?: boolean;
    buffer?: boolean;
    enqueue?: boolean;
    rfc?: boolean;
    http?: boolean;
    auth?: boolean;
    stackTrace?: boolean;
  }): Promise<string> {
    const state = await this.getSt05TraceState();

    const instanceMatch = state.match(/<ts:instance>([^<]+)<\/ts:instance>/);
    const hostMatch = state.match(/<ts:host>([^<]+)<\/ts:host>/);
    const instance = instanceMatch?.[1] ?? "";
    const host = hostMatch?.[1] ?? "";
    const traceUser = (options.user ?? this.config.username).toUpperCase();

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ts:traceStateInstanceTable xmlns:ts="http://www.sap.com/adt/tools/performance/tracestate">
  <ts:traceStateInstance>
    <ts:instance>${this.escapeXml(instance)}</ts:instance>
    <ts:host>${this.escapeXml(host)}</ts:host>
    <ts:isLocal>true</ts:isLocal>
    <ts:isSelected>true</ts:isSelected>
    <ts:modificationUser>${this.escapeXml(this.config.username.toUpperCase())}</ts:modificationUser>
    <ts:modificationDateTime>${new Date().toISOString().replace(/\.\d+Z$/, "Z")}</ts:modificationDateTime>
    <ts:traceTypes>
      <ts:sqlOn>${options.sql !== false}</ts:sqlOn>
      <ts:bufOn>${options.buffer ?? false}</ts:bufOn>
      <ts:enqOn>${options.enqueue ?? false}</ts:enqOn>
      <ts:rfcOn>${options.rfc ?? false}</ts:rfcOn>
      <ts:httpOn>${options.http ?? false}</ts:httpOn>
      <ts:apcOn>false</ts:apcOn>
      <ts:amcOn>false</ts:amcOn>
      <ts:authOn>${options.auth ?? false}</ts:authOn>
    </ts:traceTypes>
    <ts:traceProperties>
      <ts:includeMissingTableNameOn>false</ts:includeMissingTableNameOn>
      <ts:authErrorsOnly>false</ts:authErrorsOnly>
      <ts:stackTraceOn>${options.stackTrace !== false}</ts:stackTraceOn>
      <ts:includedTables/>
      <ts:excludedTables/>
    </ts:traceProperties>
    <ts:traceFilter>
      <ts:traceUser>${this.escapeXml(traceUser)}</ts:traceUser>
      <ts:transactionCode/>
      <ts:program/>
      <ts:rfcFunction/>
      <ts:url/>
      <ts:wpId/>
    </ts:traceFilter>
  </ts:traceStateInstance>
</ts:traceStateInstanceTable>`;

    return (await this.putWithCsrf(
      "/sap/bc/adt/st05/trace/state",
      xml,
      "application/vnd.sap.adt.perf.trace.state.v1+xml",
      "application/vnd.sap.adt.perf.trace.state.v1+xml"
    )).data as string;
  }

  async disableSt05Trace(): Promise<string> {
    const state = await this.getSt05TraceState();

    const instanceMatch = state.match(/<ts:instance>([^<]+)<\/ts:instance>/);
    const hostMatch = state.match(/<ts:host>([^<]+)<\/ts:host>/);
    const instance = instanceMatch?.[1] ?? "";
    const host = hostMatch?.[1] ?? "";

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ts:traceStateInstanceTable xmlns:ts="http://www.sap.com/adt/tools/performance/tracestate">
  <ts:traceStateInstance>
    <ts:instance>${this.escapeXml(instance)}</ts:instance>
    <ts:host>${this.escapeXml(host)}</ts:host>
    <ts:isLocal>true</ts:isLocal>
    <ts:isSelected>false</ts:isSelected>
    <ts:modificationUser>${this.escapeXml(this.config.username.toUpperCase())}</ts:modificationUser>
    <ts:modificationDateTime>${new Date().toISOString().replace(/\.\d+Z$/, "Z")}</ts:modificationDateTime>
    <ts:traceTypes>
      <ts:sqlOn>false</ts:sqlOn>
      <ts:bufOn>false</ts:bufOn>
      <ts:enqOn>false</ts:enqOn>
      <ts:rfcOn>false</ts:rfcOn>
      <ts:httpOn>false</ts:httpOn>
      <ts:apcOn>false</ts:apcOn>
      <ts:amcOn>false</ts:amcOn>
      <ts:authOn>false</ts:authOn>
    </ts:traceTypes>
    <ts:traceProperties>
      <ts:includeMissingTableNameOn>false</ts:includeMissingTableNameOn>
      <ts:authErrorsOnly>false</ts:authErrorsOnly>
      <ts:stackTraceOn>false</ts:stackTraceOn>
      <ts:includedTables/>
      <ts:excludedTables/>
    </ts:traceProperties>
    <ts:traceFilter>
      <ts:traceUser/>
      <ts:transactionCode/>
      <ts:program/>
      <ts:rfcFunction/>
      <ts:url/>
      <ts:wpId/>
    </ts:traceFilter>
  </ts:traceStateInstance>
</ts:traceStateInstanceTable>`;

    return (await this.putWithCsrf(
      "/sap/bc/adt/st05/trace/state",
      xml,
      "application/vnd.sap.adt.perf.trace.state.v1+xml",
      "application/vnd.sap.adt.perf.trace.state.v1+xml"
    )).data as string;
  }

  private escapeXml(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  private async fetchCsrfToken(): Promise<void> {
    const response = await this.http.get("/sap/bc/adt/discovery", {
      headers: { "X-CSRF-Token": "Fetch", Accept: "*/*" },
    });
    const token = response.headers["x-csrf-token"];
    if (!token) throw new Error("Failed to fetch CSRF token");
    this.csrfToken = token;
  }

  private async postWithCsrf(
    path: string,
    body: string,
    accept: string,
    contentType = "text/plain"
  ): Promise<AxiosResponse> {
    if (!this.csrfToken) await this.fetchCsrfToken();

    const headers: Record<string, string> = {
      "X-CSRF-Token": this.csrfToken!,
      "Content-Type": contentType,
      Accept: accept,
      Cookie: this.getCookieString(),
    };

    try {
      return await this.http.post(path, body, { headers, responseType: "text" });
    } catch (error: unknown) {
      if (axios.isAxiosError(error) && error.response?.status === 403) {
        this.csrfToken = null;
        await this.fetchCsrfToken();
        headers["X-CSRF-Token"] = this.csrfToken!;
        headers["Cookie"] = this.getCookieString();
        return await this.http.post(path, body, { headers, responseType: "text" });
      }
      throw error;
    }
  }

  private async deleteWithCsrf(path: string, accept = "*/*"): Promise<AxiosResponse> {
    if (!this.csrfToken) await this.fetchCsrfToken();

    const headers: Record<string, string> = {
      "X-CSRF-Token": this.csrfToken!,
      Accept: accept,
      Cookie: this.getCookieString(),
    };

    try {
      return await this.http.delete(path, { headers, responseType: "text" });
    } catch (error: unknown) {
      if (axios.isAxiosError(error) && error.response?.status === 403) {
        this.csrfToken = null;
        await this.fetchCsrfToken();
        headers["X-CSRF-Token"] = this.csrfToken!;
        headers["Cookie"] = this.getCookieString();
        return await this.http.delete(path, { headers, responseType: "text" });
      }
      throw error;
    }
  }

  private async putWithCsrf(
    path: string,
    body: string,
    accept: string,
    contentType = "text/plain"
  ): Promise<AxiosResponse> {
    if (!this.csrfToken) await this.fetchCsrfToken();

    const headers: Record<string, string> = {
      "X-CSRF-Token": this.csrfToken!,
      "Content-Type": contentType,
      Accept: accept,
      Cookie: this.getCookieString(),
    };

    try {
      return await this.http.put(path, body, { headers, responseType: "text" });
    } catch (error: unknown) {
      if (axios.isAxiosError(error) && error.response?.status === 403) {
        this.csrfToken = null;
        await this.fetchCsrfToken();
        headers["X-CSRF-Token"] = this.csrfToken!;
        headers["Cookie"] = this.getCookieString();
        return await this.http.put(path, body, { headers, responseType: "text" });
      }
      throw error;
    }
  }
}
