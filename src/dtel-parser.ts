function extract(xml: string, tag: string): string {
  const match = xml.match(new RegExp(`<dtel:${tag}>(.*?)</dtel:${tag}>`));
  return match?.[1] ?? "";
}

function extractAttr(xml: string, attr: string): string {
  const match = xml.match(new RegExp(`adtcore:${attr}="([^"]+)"`));
  return match?.[1] ?? "";
}

export function parseDataElementXml(xml: string): string {
  const name = extractAttr(xml, "name");
  const description = extractAttr(xml, "description");
  const typeKind = extract(xml, "typeKind");
  const typeName = extract(xml, "typeName");
  const dataType = extract(xml, "dataType");
  const length = extract(xml, "dataTypeLength").replace(/^0+/, "") || "0";
  const decimals = extract(xml, "dataTypeDecimals").replace(/^0+/, "") || "0";
  const shortLabel = extract(xml, "shortFieldLabel");
  const mediumLabel = extract(xml, "mediumFieldLabel");
  const longLabel = extract(xml, "longFieldLabel");
  const headingLabel = extract(xml, "headingFieldLabel");
  const searchHelp = extract(xml, "searchHelp");
  const defaultComp = extract(xml, "defaultComponentName");

  const lines = [
    `Data Element: ${name}`,
    `Description:  ${description}`,
    ``,
    `Type:         ${typeKind} → ${typeName}`,
    `Data Type:    ${dataType}(${length}${parseInt(decimals) > 0 ? `, ${decimals}` : ""})`,
    ``,
    `Field Labels:`,
    `  Short:      ${shortLabel}`,
    `  Medium:     ${mediumLabel}`,
    `  Long:       ${longLabel}`,
    `  Heading:    ${headingLabel}`,
  ];

  if (searchHelp) lines.push(``, `Search Help:  ${searchHelp}`);
  if (defaultComp) lines.push(`Default Comp: ${defaultComp}`);

  return lines.join("\n");
}
