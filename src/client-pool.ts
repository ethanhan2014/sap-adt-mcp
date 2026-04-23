import { AdtClient } from "./adt-client.js";
import { SystemConfig } from "./types.js";
import { authenticateWithCertificate } from "./cert-auth.js";

export class ClientPool {
  private clients = new Map<string, AdtClient>();
  private pending = new Map<string, Promise<AdtClient>>();

  private defaultId: string;

  constructor(private systems: SystemConfig[]) {
    if (systems.length === 0) {
      throw new Error("At least one SAP system must be configured");
    }
    this.defaultId = systems.find((s) => s.default)?.id ?? systems[0].id;
  }

  async getClient(systemId?: string): Promise<AdtClient> {
    const id = systemId ?? this.defaultId;

    const existing = this.clients.get(id);
    if (existing) return existing;

    const inflight = this.pending.get(id);
    if (inflight) return inflight;

    const config = this.systems.find((s) => s.id === id);
    if (!config) {
      const available = this.systems.map((s) => s.id).join(", ");
      throw new Error(`Unknown system_id "${id}". Available: ${available}`);
    }

    const promise = this.initClient(id, config);
    this.pending.set(id, promise);
    try {
      const client = await promise;
      this.clients.set(id, client);
      return client;
    } finally {
      this.pending.delete(id);
    }
  }

  private async initClient(id: string, config: SystemConfig): Promise<AdtClient> {
    const client = new AdtClient(config);

    if (config.authType === "certificate") {
      const result = await authenticateWithCertificate(config);
      client.seedSession(result.cookies, result.csrfToken);
      console.error(`[${id}] Authenticated via X.509 certificate`);
    }

    return client;
  }

  getSystems(): { id: string; hostname: string; client: string; authType: string; isDefault: boolean }[] {
    return this.systems.map(({ id, hostname, client, authType }) => ({
      id,
      hostname,
      client,
      authType: authType ?? "basic",
      isDefault: id === this.defaultId,
    }));
  }
}
