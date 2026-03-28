export interface AdtConfig {
  hostname: string;
  sysnr: string;
  username: string;
  password: string;
  client: string;
}

export function buildBaseUrl(config: AdtConfig): string {
  return `https://${config.hostname}:443${config.sysnr}`;
}
