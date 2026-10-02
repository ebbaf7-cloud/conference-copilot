import type { Attendee, AttendeeCategory } from "./types";

export type NormalizeResult = {
  attendees: Attendee[];
  rejected: Array<{ sourceRef: string; reason: string }>;
};

const HEADER_ALIASES: Record<string, string[]> = {
  firstName: ["firstname", "first", "givenname", "forename"],
  lastName: ["lastname", "last", "surname", "familyname"],
  name: ["name", "fullname", "attendeename", "participantname", "contactname", "contactperson", "person", "contact"],
  role: ["role", "title", "jobtitle", "position", "occupation"],
  company: ["company", "organisation", "organization", "employer", "firm", "workplace"],
  description: ["description", "bio", "about", "summary", "profile", "context"],
  category: ["category", "attendeetype", "type"],
  interests: ["interests", "interest", "topics", "lookingfor"],
  industry: ["industry", "sector", "vertical"],
  profileUrl: ["profileurl", "linkedin", "linkedinurl", "url", "profilelink"],
};

const roleSignals = [
  "partner", "principal", "associate", "director", "manager", "head", "chief", "ceo", "cto", "cfo",
  "coo", "founder", "president", "vp", "vice president", "lead", "officer", "buyer", "procurement",
  "investor", "analyst", "engineer", "researcher", "professor", "advisor", "talent", "recruiter",
  "editor", "journalist", "consultant", "sales", "operations", "innovation", "strategy",
];

const headerKeys = Object.entries(HEADER_ALIASES).flatMap(([key, values]) => values.map((value) => [value, key] as const));

const ATTENDEE_FIELD_LIMITS = {
  sourceRef: 300,
  name: 300,
  company: 500,
  role: 500,
  description: 8_000,
  otherFields: 100,
  otherLabel: 500,
  otherValue: 8_000,
  warnings: 50,
  warning: 1_000,
} as const;

function compact(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function compactTo(value: string, maximum: number) {
  return compact(value).slice(0, maximum);
}

function normalizeHeader(value: string) {
  return value.toLowerCase().replace(/^\ufeff/, "").replace(/[^a-z0-9]+/g, "");
}

function mappedHeader(value: string) {
  const normalized = normalizeHeader(value);
  return headerKeys.find(([alias]) => alias === normalized)?.[1] ?? null;
}

function stableId(sourceRef: string, name: string, company: string | null) {
  const input = `${sourceRef}|${name}|${company ?? ""}`.toLowerCase();
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `att_${(hash >>> 0).toString(36)}`;
}

function inferCategory(role: string | null, company: string | null, description: string | null): AttendeeCategory {
  const haystack = `${role ?? ""} ${company ?? ""} ${description ?? ""}`.toLowerCase();
  if (/\b(investor|investment|venture|ventures|vc|capital|fund|angel|principal|general partner|managing partner)\b/.test(haystack)) return "investor";
  if (/\b(procurement|buyer|purchasing|customer|operations|supply chain|commercial director)\b/.test(haystack)) return "customer";
  if (/\b(partnership|alliances|business development|ecosystem)\b/.test(haystack)) return "partner";
  if (/\b(recruit|talent|people|human resources|hr)\b/.test(haystack)) return "talent";
  if (/\b(advisor|expert|professor|researcher|scientist|academic)\b/.test(haystack)) return "advisor_expert";
  if (/\b(journalist|editor|reporter|media|press|podcast)\b/.test(haystack)) return "media";
  if (/\b(consultant|lawyer|attorney|accountant|agency|service provider)\b/.test(haystack)) return "service_provider";
  if (haystack.trim()) return "other";
  return "unknown";
}

function looksLikeRole(value: string) {
  const lower = value.toLowerCase();
  return roleSignals.some((signal) => lower.includes(signal));
}

function looksLikeName(value: string) {
  const cleaned = compact(value.replace(/^[\d.)\-•]+\s*/, ""));
  if (!cleaned || cleaned.length > 90 || /https?:|@/.test(cleaned)) return false;
  if (/^(name|full name|attendee|company|organisation|organization|role|title)$/i.test(cleaned)) return false;
  const tokens = cleaned.split(/\s+/);
  const hasLetters = /\p{L}/u.test(cleaned);
  return hasLetters && (tokens.length >= 2 || /[^\u0000-\u00ff]/.test(cleaned));
}

function createAttendee(
  sourceRef: string,
  values: {
    name: string;
    company?: string | null;
    role?: string | null;
    description?: string | null;
    category?: string | null;
    other?: Array<{ label: string; value: string }>;
    warnings?: string[];
  },
): Attendee | null {
  const name = compactTo(values.name.replace(/^[\d.)\-•]+\s*/, ""), ATTENDEE_FIELD_LIMITS.name);
  if (!looksLikeName(name)) return null;
  const company = values.company ? compactTo(values.company, ATTENDEE_FIELD_LIMITS.company) : null;
  const role = values.role ? compactTo(values.role, ATTENDEE_FIELD_LIMITS.role) : null;
  const description = values.description ? compactTo(values.description, ATTENDEE_FIELD_LIMITS.description) : null;
  const inferred = inferCategory(role, company, description);
  const suppliedCategory = values.category ? compact(values.category).toLowerCase() : "";
  const allowed: AttendeeCategory[] = ["investor", "customer", "partner", "talent", "advisor_expert", "media", "service_provider", "other", "unknown"];
  const category = allowed.includes(suppliedCategory as AttendeeCategory)
    ? (suppliedCategory as AttendeeCategory)
    : inferred;

  return {
    id: stableId(sourceRef, name, company),
    sourceRef: sourceRef.slice(0, ATTENDEE_FIELD_LIMITS.sourceRef),
    name,
    company,
    role,
    description,
    category,
    other: (values.other ?? [])
      .slice(0, ATTENDEE_FIELD_LIMITS.otherFields)
      .map((item) => ({
        label: compactTo(item.label, ATTENDEE_FIELD_LIMITS.otherLabel),
        value: compactTo(item.value, ATTENDEE_FIELD_LIMITS.otherValue),
      }))
      .filter((item) => item.label && item.value),
    warnings: (values.warnings ?? [])
      .slice(0, ATTENDEE_FIELD_LIMITS.warnings)
      .map((warning) => compactTo(warning, ATTENDEE_FIELD_LIMITS.warning))
      .filter(Boolean),
  };
}

function detectDelimiter(text: string) {
  const candidates = ["\t", ";", ",", "|"];
  const sample = text.split(/\r?\n/).filter(Boolean).slice(0, 8).join("\n");
  let best = { delimiter: ",", score: -1 };
  for (const delimiter of candidates) {
    let score = 0;
    let quoted = false;
    for (const char of sample) {
      if (char === '"') quoted = !quoted;
      else if (!quoted && char === delimiter) score += 1;
    }
    if (score > best.score) best = { delimiter, score };
  }
  return best.score > 0 ? best.delimiter : null;
}

export function parseDelimited(text: string, forcedDelimiter?: string): string[][] {
  const delimiter = forcedDelimiter ?? detectDelimiter(text);
  if (!delimiter) throw new Error("No consistent columns were found in this file.");

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (!quoted && char === delimiter) {
      row.push(compact(cell));
      cell = "";
      continue;
    }
    if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(compact(cell));
      cell = "";
      if (row.some(Boolean)) rows.push(row);
      row = [];
      continue;
    }
    cell += char;
  }

  if (quoted) throw new Error("The CSV contains an unclosed quoted field.");
  row.push(compact(cell));
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function dedupe(result: NormalizeResult): NormalizeResult {
  const seen = new Set<string>();
  const attendees: Attendee[] = [];
  const rejected = [...result.rejected];
  for (const attendee of result.attendees) {
    const key = `${attendee.name}|${attendee.company ?? ""}`.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
    if (seen.has(key)) {
      rejected.push({ sourceRef: attendee.sourceRef, reason: "Duplicate name and company" });
      continue;
    }
    seen.add(key);
    attendees.push(attendee);
  }
  return { attendees, rejected };
}

export function normalizeCsv(text: string): NormalizeResult {
  const rows = parseDelimited(text.replace(/^\ufeff/, ""));
  if (!rows.length) return { attendees: [], rejected: [] };

  const mapped = rows[0].map(mappedHeader);
  const hasHeader = mapped.some(Boolean);
  const headers = hasHeader ? rows[0] : rows[0].map((_, index) => `Column ${index + 1}`);
  const mappings = hasHeader ? mapped : rows[0].map((_, index) => (index === 0 ? "name" : null));
  const dataRows = hasHeader ? rows.slice(1) : rows;
  const attendees: Attendee[] = [];
  const rejected: NormalizeResult["rejected"] = [];

  dataRows.forEach((row, rowIndex) => {
    const values: Record<string, string> = {};
    const other: Array<{ label: string; value: string }> = [];
    row.forEach((cell, columnIndex) => {
      if (!cell) return;
      const mapping = mappings[columnIndex];
      if (mapping) values[mapping] = values[mapping] ? `${values[mapping]} · ${cell}` : cell;
      else other.push({ label: headers[columnIndex] || `Column ${columnIndex + 1}`, value: cell });
    });

    const name = compact(values.name || `${values.firstName ?? ""} ${values.lastName ?? ""}`);
    const description = [values.description, values.industry && `Industry: ${values.industry}`, values.interests && `Interests: ${values.interests}`]
      .filter(Boolean)
      .join(" · ");
    if (values.profileUrl) other.push({ label: "Profile URL", value: values.profileUrl });
    const sourceRef = `CSV row ${rowIndex + (hasHeader ? 2 : 1)}`;
    const attendee = createAttendee(sourceRef, {
      name,
      company: values.company,
      role: values.role,
      description,
      category: values.category,
      other,
      warnings: hasHeader ? [] : ["No header row detected; only the first column was treated as a name."],
    });
    if (attendee) attendees.push(attendee);
    else rejected.push({ sourceRef, reason: name ? "Could not identify a person" : "Missing name" });
  });

  return dedupe({ attendees, rejected });
}

function attendeeFromSegments(sourceRef: string, rawSegments: string[], descriptionTail = "") {
  const segments = rawSegments.map(compact).filter(Boolean);
  if (!segments.length) return null;
  const name = segments.shift() ?? "";
  let company: string | null = null;
  let role: string | null = null;
  const descriptions: string[] = [];

  const atMatch = segments[0]?.match(/^(.+?)\s+at\s+(.+)$/i);
  if (atMatch) {
    role = compact(atMatch[1]);
    company = compact(atMatch[2]);
    segments.shift();
  } else if (segments.length) {
    const commaParts = segments[0].split(/,\s*/).map(compact).filter(Boolean);
    if (commaParts.length >= 2 && looksLikeRole(commaParts[0])) {
      role = commaParts[0];
      company = commaParts.slice(1).join(", ");
      segments.shift();
    } else if (segments.length >= 2 && looksLikeRole(segments[0])) {
      role = segments.shift() ?? null;
      company = segments.shift() ?? null;
    } else if (segments.length >= 2 && looksLikeRole(segments[1])) {
      company = segments.shift() ?? null;
      role = segments.shift() ?? null;
    } else {
      company = segments.shift() ?? null;
    }
  }
  descriptions.push(...segments, descriptionTail);
  return createAttendee(sourceRef, { name, company, role, description: descriptions.filter(Boolean).join(" · ") });
}

function parseBlock(block: string, index: number) {
  const sourceRef = `Paste block ${index + 1}`;
  const lines = block.split(/\r?\n/).map(compact).filter(Boolean);
  if (!lines.length) return null;
  if (lines.length > 1) {
    const first = lines[0];
    const second = lines[1];
    const atMatch = second.match(/^(.+?)\s+at\s+(.+)$/i);
    if (atMatch) {
      return createAttendee(sourceRef, {
        name: first,
        role: atMatch[1],
        company: atMatch[2],
        description: lines.slice(2).join(" · "),
      });
    }
    if (looksLikeName(first)) return attendeeFromSegments(sourceRef, [first, second], lines.slice(2).join(" · "));
  }

  const line = lines.join(" ").replace(/^[\d.)\-•]+\s*/, "");
  const separator = line.includes("\t") ? /\t+/ : line.includes("|") ? /\s*\|\s*/ : /\s+[—–]\s+|\s+-\s+/;
  const segments = line.split(separator).map(compact).filter(Boolean);
  if (segments.length >= 2) return attendeeFromSegments(sourceRef, segments);

  const commaParts = line.split(/,\s*/).map(compact).filter(Boolean);
  if (commaParts.length >= 3) return attendeeFromSegments(sourceRef, commaParts);
  return createAttendee(sourceRef, { name: line });
}

export function normalizePaste(text: string): NormalizeResult {
  const cleaned = text.trim();
  if (!cleaned) return { attendees: [], rejected: [] };

  const firstLine = cleaned.split(/\r?\n/, 1)[0];
  const likelyTable = /\t|\|/.test(firstLine) && firstLine.split(/\t|\|/).some((value) => mappedHeader(value));
  if (likelyTable) {
    try {
      return normalizeCsv(cleaned);
    } catch {
      // Fall through to block parsing for irregular copied tables.
    }
  }

  const lines = cleaned.split(/\r?\n/).map(compact);
  const blocks: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line) continue;
    const hasRecordSeparator = /\t|\||\s+[—–]\s+|\s+-\s+/.test(line);
    if (hasRecordSeparator) {
      blocks.push(line);
      continue;
    }
    const nextLine = lines[index + 1] ?? "";
    if (looksLikeName(line) && /^.+?\s+at\s+.+$/i.test(nextLine)) {
      const blockLines = [line, nextLine];
      index += 1;
      const possibleDescription = lines[index + 1] ?? "";
      const descriptionStartsAnotherRecord = /\t|\||\s+[—–]\s+|\s+-\s+/.test(possibleDescription);
      if (possibleDescription && !descriptionStartsAnotherRecord) {
        blockLines.push(possibleDescription);
        index += 1;
      }
      blocks.push(blockLines.join("\n"));
      continue;
    }
    blocks.push(line);
  }

  const attendees: Attendee[] = [];
  const rejected: NormalizeResult["rejected"] = [];
  blocks.forEach((block, index) => {
    const attendee = parseBlock(block, index);
    if (attendee) attendees.push(attendee);
    else rejected.push({ sourceRef: `Paste block ${index + 1}`, reason: "Could not identify a person" });
  });
  return dedupe({ attendees, rejected });
}
