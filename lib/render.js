// Property / value rendering helpers shared by props and compare.
//
// The IBP `/data` endpoint returns
//   part.scenarioPropertyGroups[0].propertyGroups[*].properties[*]
// with each property shaped like
//   { propertyId, propertyName: "SAE-L18 - Foot Entrance Clearance – Front [mm]",
//     values: [{ formatedValue: "456.1", unitLabel: "mm" }] }
// Property names carry the unit as a trailing "[mm]" or "(kg)" — we split it out
// so the unit lands in its own column and the name stays stable for filtering.

/** Split "Name [mm]" / "Name (kg)" into { property, unit }. */
export function splitUnit(rawName, fallbackUnit = '') {
  const name = String(rawName ?? '');
  let unit = String(fallbackUnit ?? '').trim();

  const bracket = name.match(/^(.*?)\s*\[([^\]]+)\]\s*$/);
  if (bracket) {
    return { property: bracket[1].trim(), unit: unit || bracket[2].trim() };
  }
  const paren = name.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  if (paren) {
    return { property: paren[1].trim(), unit: unit || paren[2].trim() };
  }
  return { property: name, unit };
}

/** First value of a property, or an empty object. */
export function firstValue(prop) {
  return Array.isArray(prop?.values) ? prop.values[0] || {} : {};
}

/** Pull the property groups out of a `/data` response. */
export function extractGroups(data) {
  const scenarios = data?.part?.scenarioPropertyGroups;
  if (Array.isArray(scenarios) && scenarios[0]?.propertyGroups) {
    return scenarios[0].propertyGroups;
  }
  return [];
}

/**
 * Flatten property groups into rows.
 *
 * @param groups   raw propertyGroups from the API
 * @param options.only      array of lowercase group names to keep (whitelist)
 * @param options.dropMeta  drop catalogue-metadata groups (bilingual match)
 * @param options.isMetaGroup predicate used when dropMeta is on
 */
export function parseGroups(groups, { only, dropMeta, isMetaGroup } = {}) {
  const onlySet = Array.isArray(only) && only.length
    ? new Set(only.map((g) => String(g).trim().toLowerCase()))
    : null;

  const rows = [];
  for (const grp of groups || []) {
    const groupName = String(grp?.propertyGroupName ?? '');
    const key = groupName.trim().toLowerCase();

    if (onlySet && !onlySet.has(key)) continue;
    if (!onlySet && dropMeta && isMetaGroup && isMetaGroup(groupName)) continue;

    for (const prop of Array.isArray(grp?.properties) ? grp.properties : []) {
      const valueObj = firstValue(prop);
      const { property, unit } = splitUnit(prop?.propertyName, valueObj.unitLabel);
      rows.push({
        group: groupName,
        property,
        value: valueObj.formatedValue ?? '',
        unit,
        propertyId: String(prop?.propertyId ?? ''),
      });
    }
  }
  return rows;
}

/**
 * Convert a formatted value into a real number.
 * "1,234.56" → 1234.56 · "736.0" → 736 · "" / "-" / "N/A" → null
 * Output-design rule: numeric fields stay numbers, missing stays null.
 */
export function toNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const cleaned = raw.replace(/,/g, '').replace(/[^\d.+-]/g, '');
  if (!cleaned || !/\d/.test(cleaned)) return null;
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}
