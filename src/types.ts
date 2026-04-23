export interface AdtConfig {
  hostname: string;
  sysnr: string;
  username: string;
  password: string;
  client: string;
  language: string;
  authType?: "basic" | "certificate";
  certThumbprint?: string;
}

export interface SystemConfig extends AdtConfig {
  id: string;
  default?: boolean;
}

export function buildBaseUrl(config: AdtConfig): string {
  return `https://${config.hostname}:443${config.sysnr}`;
}
