import { execFile } from "child_process";
import { buildBaseUrl, AdtConfig } from "./types.js";

interface CertAuthResult {
  cookies: Record<string, string>;
  csrfToken: string;
}

const PS_SCRIPT = (url: string, client: string, thumbprint: string) => `
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
[Net.ServicePointManager]::ServerCertificateValidationCallback = { $true }
$cert = Get-ChildItem -Path Cert:\\CurrentUser\\My | Where-Object { $_.Thumbprint -eq '${thumbprint}' }
if (-not $cert) { Write-Output "ERROR:Certificate not found"; exit 1 }
$req = [Net.HttpWebRequest]::Create('${url}/sap/bc/adt/discovery')
$req.ClientCertificates.Add($cert)
$req.Headers.Add('sap-client', '${client}')
$req.Headers.Add('x-csrf-token', 'fetch')
$req.Accept = 'application/atomsvc+xml'
$req.Method = 'GET'
try {
  $resp = $req.GetResponse()
  Write-Output "STATUS:$([int]$resp.StatusCode)"
  Write-Output "CSRF:$($resp.Headers['x-csrf-token'])"
  Write-Output "COOKIES:$($resp.Headers['Set-Cookie'])"
  $resp.Close()
} catch [System.Net.WebException] {
  $r = $_.Exception.Response
  if ($r) { Write-Output "ERROR:HTTP $([int]$r.StatusCode)" }
  else { Write-Output "ERROR:$($_.Exception.Message)" }
}
`;

function parseCookieHeader(header: string): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const part of header.split(",")) {
    const trimmed = part.trim();
    const [kv] = trimmed.split(";");
    const eq = kv.indexOf("=");
    if (eq > 0) {
      const key = kv.substring(0, eq).trim();
      if (!key.startsWith("path") && !key.startsWith("expires") && !key.startsWith("secure")) {
        cookies[key] = kv.substring(eq + 1).trim();
      }
    }
  }
  return cookies;
}

export function authenticateWithCertificate(config: AdtConfig): Promise<CertAuthResult> {
  const baseUrl = buildBaseUrl(config);
  const script = PS_SCRIPT(baseUrl, config.client, config.certThumbprint!);

  return new Promise((resolve, reject) => {
    execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
      timeout: 30000,
    }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`Certificate auth failed: ${stderr || error.message}`));
        return;
      }

      const lines = stdout.trim().split("\n").map((l) => l.trim());
      const statusLine = lines.find((l) => l.startsWith("STATUS:"));
      const csrfLine = lines.find((l) => l.startsWith("CSRF:"));
      const cookieLine = lines.find((l) => l.startsWith("COOKIES:"));
      const errorLine = lines.find((l) => l.startsWith("ERROR:"));

      if (errorLine) {
        reject(new Error(`Certificate auth failed: ${errorLine.substring(6)}`));
        return;
      }

      if (!statusLine || !csrfLine || !cookieLine) {
        reject(new Error(`Certificate auth returned unexpected output: ${stdout}`));
        return;
      }

      const status = parseInt(statusLine.substring(7));
      if (status !== 200) {
        reject(new Error(`Certificate auth returned HTTP ${status}`));
        return;
      }

      resolve({
        csrfToken: csrfLine.substring(5),
        cookies: parseCookieHeader(cookieLine.substring(8)),
      });
    });
  });
}
