interface Column {
  name: string;
  values: string[];
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

function extractQueryTime(xml: string): string {
  const match = xml.match(/<dataPreview:queryExecutionTime>([\d.]+)<\/dataPreview:queryExecutionTime>/);
  return match ? match[1] : "?";
}

export function parseSqlResultXml(xml: string): string {
  const columns = extractColumns(xml);
  if (columns.length === 0) return "No results returned.";

  const totalRows = extractTotalRows(xml);
  const queryTime = extractQueryTime(xml);
  const rowCount = columns[0].values.length;

  const maxWidth = 40;
  const colWidths = columns.map((col) => {
    const maxVal = col.values.reduce(
      (max, v) => Math.max(max, v.length),
      col.name.length
    );
    return Math.min(maxVal, maxWidth);
  });

  const padRight = (s: string, w: number) =>
    s.length > w ? s.substring(0, w - 1) + "~" : s.padEnd(w);

  const header = columns
    .map((col, i) => padRight(col.name, colWidths[i]))
    .join(" | ");
  const separator = colWidths.map((w) => "-".repeat(w)).join("-+-");

  const rows: string[] = [];
  for (let r = 0; r < rowCount; r++) {
    const row = columns
      .map((col, i) => padRight(col.values[r] ?? "", colWidths[i]))
      .join(" | ");
    rows.push(row);
  }

  const lines = [
    `${rowCount} row(s) returned (${totalRows} total, ${queryTime}s)`,
    "",
    header,
    separator,
    ...rows,
  ];

  return lines.join("\n");
}
