import { conciseRecommendationSentence } from "@/lib/ai/recommendation-copy";
import { scoreLocalAttendees } from "@/lib/ai/fallback";
import type { AnalysisContext, Attendee, Recommendation } from "@/lib/conference/types";

export type RoomCategory =
  | "all"
  | "investor"
  | "customer"
  | "partner"
  | "founder"
  | "advisor_expert"
  | "talent"
  | "media"
  | "service_provider"
  | "other";

export type RoomDirectoryRow = {
  attendee: Attendee;
  categories: Exclude<RoomCategory, "all">[];
  categoryLabel: string;
  relevanceScore: number;
  shortReason: string;
  geographySearch: string;
};

export type RoomFilters = {
  category: RoomCategory;
  geography: string;
  role: string;
  company: string;
  minimumScore: number;
};

const categoryLabels: Record<Exclude<RoomCategory, "all">, string> = {
  investor: "Investor",
  customer: "Customer",
  partner: "Partner",
  founder: "Founder",
  advisor_expert: "Expert / Advisor",
  talent: "Talent",
  media: "Media",
  service_provider: "Service provider",
  other: "Other",
};

function browseCategory(attendee: Attendee): Exclude<RoomCategory, "all"> {
  return attendee.category === "unknown" ? "other" : attendee.category;
}

function isFounder(attendee: Attendee) {
  return /\b(?:co[-\s]?founder|founder)\b/i.test(attendee.role ?? "");
}

function geographySearch(attendee: Attendee) {
  const structured = attendee.other
    .filter((item) => /\b(location|geography|country|city|region|market|headquarters|hq|based)\b/i.test(item.label))
    .map((item) => item.value);
  return [attendee.description, ...structured].filter(Boolean).join(" ").toLocaleLowerCase();
}

export function buildRoomDirectory(context: AnalysisContext, recommendations: Recommendation[] = []): RoomDirectoryRow[] {
  const recommendedCopy = new Map(recommendations.map((item) => [item.attendeeId, item.whyThem]));
  return scoreLocalAttendees(context).map((item) => {
    const baseCategory = browseCategory(item.attendee);
    const categories = isFounder(item.attendee)
      ? baseCategory === "other"
        ? ["founder" as const]
        : Array.from(new Set(["founder" as const, baseCategory]))
      : [baseCategory];
    const labels = categories
      .filter((category) => category !== "other" || categories.length === 1)
      .map((category) => categoryLabels[category]);
    return {
      attendee: item.attendee,
      categories,
      categoryLabel: labels.join(" · ") || categoryLabels.other,
      relevanceScore: Math.round(item.score),
      shortReason: conciseRecommendationSentence(recommendedCopy.get(item.attendee.id) ?? item.recommendation.whyThem),
      geographySearch: geographySearch(item.attendee),
    };
  });
}

function includes(value: string | null, query: string) {
  return !query || (value ?? "").toLocaleLowerCase().includes(query.toLocaleLowerCase());
}

export function filterRoomDirectory(rows: RoomDirectoryRow[], filters: RoomFilters) {
  const geography = filters.geography.trim().toLocaleLowerCase();
  const role = filters.role.trim();
  const company = filters.company.trim();
  return rows.filter((row) => (
    (filters.category === "all" || row.categories.includes(filters.category))
    && (!geography || row.geographySearch.includes(geography))
    && includes(row.attendee.role, role)
    && includes(row.attendee.company, company)
    && row.relevanceScore >= filters.minimumScore
  ));
}

function csvCell(value: string) {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function buildRoomDirectoryCsv(rows: RoomDirectoryRow[]) {
  const headers = ["Name", "Company", "Role", "Category", "Relevance score", "Short reason"];
  const lines = rows.map((row) => [
    row.attendee.name,
    row.attendee.company ?? "",
    row.attendee.role ?? "",
    row.categoryLabel,
    String(row.relevanceScore),
    row.shortReason,
  ].map(csvCell).join(","));
  return [headers.join(","), ...lines].join("\r\n");
}

export const roomCategoryOptions: Array<{ value: RoomCategory; label: string }> = [
  { value: "all", label: "All" },
  { value: "investor", label: "Investors" },
  { value: "customer", label: "Customers" },
  { value: "partner", label: "Partners" },
  { value: "founder", label: "Founders" },
  { value: "advisor_expert", label: "Experts / Advisors" },
  { value: "talent", label: "Talent" },
  { value: "media", label: "Media" },
  { value: "service_provider", label: "Service providers" },
  { value: "other", label: "Other" },
];
