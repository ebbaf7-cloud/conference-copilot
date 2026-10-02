import { normalizeCsv, normalizePaste, parseDelimited, type NormalizeResult } from "./normalize";
import type { Attendee, NetworkContact, WarmPath } from "./types";

export type NetworkNormalizeResult = {
  contacts: NetworkContact[];
  rejected: Array<{ sourceRef: string; reason: string }>;
};

type NetworkHeader = "firstName" | "lastName" | "name" | "company" | "role" | "connectedToNames" | "connectedToCompanies";

const MAX_NETWORK_CONTACTS = 5_000;
const MAX_NETWORK_INPUT_CHARS = 500_000;
const MAX_NETWORK_FIELD_LENGTH = 500;
const MAX_NETWORK_NAME_LENGTH = 300;

const NETWORK_HEADER_ALIASES: Record<NetworkHeader, string[]> = {
  firstName: ["firstname", "first", "givenname", "forename"],
  lastName: ["lastname", "last", "surname", "familyname"],
  name: ["name", "fullname", "contactname", "contactperson", "person", "contact", "connector", "yourcontact", "introducer", "mutualconnection"],
  company: ["company", "organisation", "organization", "employer", "firm", "workplace"],
  role: ["role", "title", "jobtitle", "position", "occupation"],
  connectedToNames: [
    "connectedto", "connection", "connections", "knows", "canintroduceto", "introductiontarget",
    "introductiontargets", "targetperson", "targetpeople", "targetname", "peopleknown", "target", "attendee", "targetattendee",
  ],
  connectedToCompanies: [
    "connectedcompany", "connectedcompanies", "targetcompany", "targetcompanies", "canintroduceat",
    "companyconnections", "companiesknown",
  ],
};

const headerLookup = new Map<string, NetworkHeader>();
Object.entries(NETWORK_HEADER_ALIASES).forEach(([key, aliases]) => {
  aliases.forEach((alias) => headerLookup.set(alias, key as NetworkHeader));
});

function compact(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function normalizedHeader(value: string) {
  return value.toLowerCase().replace(/^\ufeff/, "").replace(/[^a-z0-9]+/g, "");
}

function mappedHeader(value: string) {
  return headerLookup.get(normalizedHeader(value)) ?? null;
}

function normalizedIdentity(value: string) {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9\p{L}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function stableNetworkId(sourceRef: string, name: string, company: string | null) {
  const input = `${sourceRef}|${name}|${company ?? ""}`.toLowerCase();
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `net_${(hash >>> 0).toString(36)}`;
}

function splitConnections(value: string) {
  const seen = new Set<string>();
  return value
    .split(/\s*(?:;|\||,|→|->)\s*/)
    .map(compact)
    .filter((item) => {
      const key = normalizedIdentity(item);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function dedupeContacts(result: NetworkNormalizeResult): NetworkNormalizeResult {
  const contacts: NetworkContact[] = [];
  const rejected = [...result.rejected];
  const seen = new Map<string, NetworkContact>();
  result.contacts.forEach((contact) => {
    const key = `${normalizedIdentity(contact.name)}|${normalizedIdentity(contact.company ?? "")}`;
    const existing = seen.get(key);
    if (existing) {
      existing.connectedToNames = Array.from(new Set([...existing.connectedToNames, ...contact.connectedToNames]));
      existing.connectedToCompanies = Array.from(new Set([...existing.connectedToCompanies, ...contact.connectedToCompanies]));
      return;
    }
    seen.set(key, contact);
    contacts.push(contact);
  });
  return { contacts, rejected };
}

function limitContacts(result: NetworkNormalizeResult): NetworkNormalizeResult {
  if (result.contacts.length <= MAX_NETWORK_CONTACTS) return result;
  return {
    contacts: result.contacts.slice(0, MAX_NETWORK_CONTACTS),
    rejected: [
      ...result.rejected,
      { sourceRef: "Network input", reason: `Only the first ${MAX_NETWORK_CONTACTS} network records were used.` },
    ],
  };
}

function fromAttendeeResult(result: NormalizeResult): NetworkNormalizeResult {
  const contacts: NetworkContact[] = [];
  const rejected = [...result.rejected];
  result.attendees.forEach((attendee) => {
    if (attendee.name.length > MAX_NETWORK_NAME_LENGTH) {
      rejected.push({ sourceRef: attendee.sourceRef, reason: `Name is limited to ${MAX_NETWORK_NAME_LENGTH} characters.` });
      return;
    }
    contacts.push({
      id: stableNetworkId(attendee.sourceRef, attendee.name, attendee.company),
      sourceRef: attendee.sourceRef,
      name: attendee.name,
      company: attendee.company,
      role: attendee.role,
      connectedToNames: [],
      connectedToCompanies: [],
    });
  });
  return limitContacts(dedupeContacts({ contacts, rejected }));
}

export function normalizeNetworkCsv(text: string): NetworkNormalizeResult {
  const rows = parseDelimited(text.replace(/^\ufeff/, ""));
  if (!rows.length) return { contacts: [], rejected: [] };
  const mappings = rows[0].map(mappedHeader);
  const hasHeader = mappings.some(Boolean);
  if (!hasHeader) return fromAttendeeResult(normalizeCsv(text));

  const contacts: NetworkContact[] = [];
  const dataRows = rows.slice(1, MAX_NETWORK_CONTACTS + 1);
  const skippedRows = Math.max(0, rows.length - 1 - dataRows.length);
  const rejected: NetworkNormalizeResult["rejected"] = skippedRows
    ? [{ sourceRef: "Network CSV", reason: `Only the first ${MAX_NETWORK_CONTACTS} rows were used.` }]
    : [];
  dataRows.forEach((row, rowIndex) => {
    const values = new Map<NetworkHeader, string[]>();
    if (row.some((cell) => cell.length > MAX_NETWORK_FIELD_LENGTH)) {
      rejected.push({ sourceRef: `Network CSV row ${rowIndex + 2}`, reason: `Each field is limited to ${MAX_NETWORK_FIELD_LENGTH} characters.` });
      return;
    }
    row.forEach((cell, columnIndex) => {
      const mapping = mappings[columnIndex];
      if (!mapping || !cell) return;
      values.set(mapping, [...(values.get(mapping) ?? []), cell]);
    });
    const sourceRef = `Network CSV row ${rowIndex + 2}`;
    const name = compact([
      ...(values.get("name") ?? []),
      `${values.get("firstName")?.join(" ") ?? ""} ${values.get("lastName")?.join(" ") ?? ""}`,
    ].find((item) => compact(item)) ?? "");
    if (!name) {
      rejected.push({ sourceRef, reason: "Missing name" });
      return;
    }
    if (name.length > MAX_NETWORK_NAME_LENGTH) {
      rejected.push({ sourceRef, reason: `Connector name is limited to ${MAX_NETWORK_NAME_LENGTH} characters.` });
      return;
    }
    const company = compact(values.get("company")?.join(" · ") ?? "") || null;
    const role = compact(values.get("role")?.join(" · ") ?? "") || null;
    const connectedToNames = splitConnections(values.get("connectedToNames")?.join(";") ?? "");
    if (connectedToNames.some((target) => target.length > MAX_NETWORK_NAME_LENGTH)) {
      rejected.push({ sourceRef, reason: `Target names are limited to ${MAX_NETWORK_NAME_LENGTH} characters.` });
      return;
    }
    contacts.push({
      id: stableNetworkId(sourceRef, name, company),
      sourceRef,
      name,
      company,
      role,
      connectedToNames,
      connectedToCompanies: splitConnections(values.get("connectedToCompanies")?.join(";") ?? ""),
    });
  });
  return limitContacts(dedupeContacts({ contacts, rejected }));
}

export function normalizeNetworkPaste(text: string): NetworkNormalizeResult {
  const cleaned = text.trim();
  if (!cleaned) return { contacts: [], rejected: [] };
  if (cleaned.length > MAX_NETWORK_INPUT_CHARS) {
    return { contacts: [], rejected: [{ sourceRef: "Network paste", reason: `Paste is limited to ${MAX_NETWORK_INPUT_CHARS.toLocaleString()} characters.` }] };
  }
  const firstLine = cleaned.split(/\r?\n/, 1)[0];
  const looksTabular = /\t|\||;|,/.test(firstLine)
    && firstLine.split(/\t|\||;|,/).some((value) => mappedHeader(value));
  if (looksTabular) {
    try {
      return normalizeNetworkCsv(cleaned);
    } catch {
      // Fall through to the conservative contact parser for irregular copied data.
    }
  }
  if (/(?:->|=>|→)/.test(cleaned)) {
    const contacts: NetworkContact[] = [];
    const rejected: NetworkNormalizeResult["rejected"] = [];
    const lines = cleaned.split(/\r?\n/).map(compact).filter(Boolean);
    if (lines.length > MAX_NETWORK_CONTACTS) {
      rejected.push({ sourceRef: "Network paste", reason: `Only the first ${MAX_NETWORK_CONTACTS} relationships were used.` });
    }
    lines.slice(0, MAX_NETWORK_CONTACTS).forEach((line, index) => {
      const sourceRef = `Network paste line ${index + 1}`;
      const match = line.replace(/^[\d.)\-•]+\s*/, "").match(/^(.+?)\s*(?:->|=>|→)\s*(.+)$/);
      if (!match) {
        rejected.push({ sourceRef, reason: "Use Connector name -> Target attendee name" });
        return;
      }
      const name = compact(match[1]);
      const target = compact(match[2]);
      if (!name || !target || name.length > MAX_NETWORK_NAME_LENGTH || target.length > MAX_NETWORK_NAME_LENGTH || normalizedIdentity(name) === normalizedIdentity(target)) {
        rejected.push({ sourceRef, reason: "A connector and a different target attendee are required" });
        return;
      }
      contacts.push({
        id: stableNetworkId(sourceRef, name, null),
        sourceRef,
        name,
        company: null,
        role: null,
        connectedToNames: [target],
        connectedToCompanies: [],
      });
    });
    return limitContacts(dedupeContacts({ contacts, rejected }));
  }
  return fromAttendeeResult(normalizePaste(cleaned));
}

export function findWarmPaths(attendees: Attendee[], contacts: NetworkContact[]) {
  const paths: WarmPath[] = [];
  const attendeeNameCounts = new Map<string, number>();
  attendees.forEach((attendee) => {
    const key = normalizedIdentity(attendee.name);
    attendeeNameCounts.set(key, (attendeeNameCounts.get(key) ?? 0) + 1);
  });
  const contactByTargetName = new Map<string, NetworkContact>();
  contacts.forEach((contact) => {
    const connectorName = normalizedIdentity(contact.name);
    contact.connectedToNames.forEach((name) => {
      const target = normalizedIdentity(name);
      if (!target || target === connectorName || contactByTargetName.has(target)) return;
      contactByTargetName.set(target, contact);
    });
  });
  attendees.forEach((attendee) => {
    const targetName = normalizedIdentity(attendee.name);
    const contact = attendeeNameCounts.get(targetName) === 1 ? contactByTargetName.get(targetName) : undefined;
    if (!contact) return;

    paths.push({
      attendeeId: attendee.id,
      contactId: contact.id,
      viaName: contact.name,
      targetName: attendee.name,
      basis: "explicit_person",
      evidence: `${contact.name}'s network record explicitly names ${attendee.name}.`,
    });
  });
  return paths;
}

export function warmPathMessage(path: WarmPath) {
  return `You know ${path.viaName}, who may be able to introduce you to ${path.targetName}.`;
}

export function warmSuggestedAngle(path: WarmPath, _originalAngle?: string) {
  return `Ask ${path.viaName} for a warm introduction to ${path.targetName}.`;
}
