interface Column {
  name: string;
  values: string[];
}

export interface St22Dump {
  date: string;
  time: string;
  user: string;
  host: string;
  runtimeError: string;
  program: string;
}

function extractColumns(xml: string): Column[] {
  const columns: Column[] = [];
  const columnRegex = /<dataPreview:columns>([\s\S]*?)<\/dataPreview:columns>/g;
  let match;

  while ((match = columnRegex.exec(xml)) !== null) {
    const block = match[1];
    const nameMatch = block.match(/dataPreview:name="([^"]+)"/);
    if (!nameMatch) continue;

    const values: string[] = [];
    const dataRegex = /<dataPreview:data>([\s\S]*?)<\/dataPreview:data>/g;
    let dataMatch;
    while ((dataMatch = dataRegex.exec(block)) !== null) {
      values.push(dataMatch[1]);
    }

    columns.push({ name: nameMatch[1], values });
  }

  return columns;
}

function extractTotalRows(xml: string): number {
  const match = xml.match(/<dataPreview:totalRows>(\d+)<\/dataPreview:totalRows>/);
  return match ? parseInt(match[1], 10) : 0;
}

function parseFlistField(flist: string): { runtimeError: string; program: string } {
  const errorMatch = flist.match(/^FC(\d{3})(.+?)(?:AP\d{3}|$)/);
  if (!errorMatch) {
    return { runtimeError: "UNKNOWN", program: "UNKNOWN" };
  }

  const errorLen = parseInt(errorMatch[1], 10);
  const runtimeError = flist.substring(5, 5 + errorLen);

  const programMatch = flist.match(/AP(\d{3})/);
  if (!programMatch) {
    return { runtimeError, program: "UNKNOWN" };
  }

  const apPos = flist.indexOf("AP", 5 + errorLen);
  const progLen = parseInt(programMatch[1], 10);
  const program = flist.substring(apPos + 5, apPos + 5 + progLen).replace(/\s+$/, "");

  return { runtimeError, program };
}

function formatTime(uzeit: string): string {
  const t = uzeit.padStart(6, "0");
  return `${t.substring(0, 2)}:${t.substring(2, 4)}:${t.substring(4, 6)}`;
}

function formatDate(datum: string): string {
  return `${datum.substring(0, 4)}-${datum.substring(4, 6)}-${datum.substring(6, 8)}`;
}

export function parseSnapDumps(xml: string): St22Dump[] {
  const columns = extractColumns(xml);
  if (columns.length === 0) return [];

  const colMap = new Map(columns.map((c) => [c.name, c.values]));
  const datumVals = colMap.get("DATUM") ?? [];
  const uzeitVals = colMap.get("UZEIT") ?? [];
  const unameVals = colMap.get("UNAME") ?? [];
  const ahostVals = colMap.get("AHOST") ?? [];
  const flistVals = colMap.get("FLIST") ?? [];

  const dumps: St22Dump[] = [];
  for (let i = 0; i < datumVals.length; i++) {
    const { runtimeError, program } = parseFlistField(flistVals[i] ?? "");
    dumps.push({
      date: datumVals[i] ?? "",
      time: uzeitVals[i] ?? "",
      user: (unameVals[i] ?? "").trim(),
      host: (ahostVals[i] ?? "").trim(),
      runtimeError,
      program,
    });
  }

  return dumps;
}

export function formatSt22Dumps(dumps: St22Dump[], date: string): string {
  if (dumps.length === 0) {
    return `No ST22 dumps found for ${date}`;
  }

  const totalRows = extractTotalRows("");
  const header = `Found ${dumps.length} ST22 dump(s) on ${date}\n`;

  const padRight = (s: string, w: number) =>
    s.length > w ? s.substring(0, w - 1) + "~" : s.padEnd(w);

  const cols = [
    { label: "#", width: 4 },
    { label: "Time", width: 8 },
    { label: "User", width: 12 },
    { label: "Runtime Error", width: 32 },
    { label: "Program", width: 40 },
  ];

  const headerLine = cols.map((c) => padRight(c.label, c.width)).join(" | ");
  const separator = cols.map((c) => "-".repeat(c.width)).join("-+-");

  const rows = dumps.map((d, i) => {
    const values = [
      String(i + 1),
      formatTime(d.time),
      d.user,
      d.runtimeError,
      d.program,
    ];
    return values.map((v, j) => padRight(v, cols[j].width)).join(" | ");
  });

  return [header, headerLine, separator, ...rows].join("\n");
}
