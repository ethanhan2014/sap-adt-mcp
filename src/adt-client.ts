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
      headers: { "sap-client": config.client },
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

      await this.http.post("/sap/bc/adt/ddic/ddl/sources", xml, {
        headers: this.statefulHeaders({
          "Content-Type": "application/vnd.sap.adt.ddlSource+xml; charset=utf-8",
          Accept: "application/vnd.sap.adt.ddlSource+xml",
        }),
      });
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
        log.push(`Note: Could not lock DDL source (HTTP ${lockResp.status}). Source must be added via Eclipse ADT.`);
        log.push(`Open /sap/bc/adt/ddic/ddl/sources/${nameLower} in ADT to add source code.`);
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

      // 4. Unlock
      await this.http.post(
        `/sap/bc/adt/ddic/ddl/sources/${nameLower}?_action=UNLOCK&lockHandle=${encodeURIComponent(lockHandle)}`,
        "",
        { headers: this.statefulHeaders(), responseType: "text" }
      );
      log.push("Unlocked");

      // 5. Activate
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
    accept: string
  ): Promise<AxiosResponse> {
    if (!this.csrfToken) await this.fetchCsrfToken();

    const headers: Record<string, string> = {
      "X-CSRF-Token": this.csrfToken!,
      "Content-Type": "text/plain",
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
}
