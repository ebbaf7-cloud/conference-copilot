import type {
  AnalysisContext,
  Attendee,
  ChallengeResult,
  MeetingPrepResult,
  OutreachResult,
  RankingResult,
  Recommendation,
  RecommendationTier,
  WarmPath,
} from "@/lib/conference/types";
import { buildLocalEventAnalysis } from "@/lib/ai/event-analysis";
import { conciseRecommendationSentence } from "@/lib/ai/recommendation-copy";

const STOP_WORDS = new Set([
  "a", "about", "an", "and", "are", "as", "at", "be", "been", "being", "by", "can", "company",
  "conference", "could", "event", "for", "from", "has", "have", "in", "into", "is", "it", "its", "meet",
  "more", "of", "on", "only", "or", "our", "that", "the", "their", "them", "they", "this", "through", "to",
  "want", "we", "who", "with", "would", "your",
]);

const IMPORTANT_SHORT_TERMS = new Set(["ai", "b2b", "b2c", "eu", "hr", "ml", "uk", "us", "vc", "vp"]);

/**
 * Canonical word families used by the deterministic matcher. The first value is
 * also the concept stored in score evidence. Keep this explicit: it makes the
 * local ranking behavior inspectable and prevents accidental outside knowledge.
 */
export const LOCAL_WORD_FAMILIES = {
  investor: ["investor", "investors", "investment", "investments", "investing", "venture", "ventures", "vc", "vcs", "fund", "funds", "funding", "financier", "financiers", "angel", "angels", "fundraising", "fundraise", "raising", "raise", "raised"],
  customer: ["customer", "customers", "buyer", "buyers", "buying", "procurement", "purchase", "purchases", "purchasing", "purchaser", "purchasers", "client", "clients", "user", "users"],
  partnership: ["partnership", "partnerships", "partner", "partners", "alliance", "alliances", "collaboration", "collaborations", "bizdev"],
  hiring: ["hire", "hires", "hired", "hiring", "recruit", "recruits", "recruiter", "recruiters", "recruiting", "recruitment", "talent", "candidate", "candidates", "workforce", "hr"],
  advisor: ["advisor", "advisors", "adviser", "advisers", "expert", "experts", "mentor", "mentors", "professor", "professors", "researcher", "researchers", "scientist", "scientists", "academic", "academics"],
  ai: ["ai", "ml"],
  b2b: ["b2b"],
  b2c: ["b2c"],
  climate: ["climate", "climatetech", "cleantech"],
  decarbonization: ["decarbonization", "decarbonisation", "decarbonize", "decarbonise", "decarbonizing", "decarbonising"],
  industry: ["industry", "industries", "industrial"],
  manufacturing: ["manufacture", "manufacturer", "manufacturers", "manufacturing"],
  technology: ["technology", "technologies", "tech"],
  europe: ["europe", "european", "eu"],
  nordics: ["nordic", "nordics", "scandinavia", "scandinavian", "sweden", "swedish", "norway", "norwegian", "denmark", "danish", "finland", "finnish", "iceland", "icelandic"],
  dach: ["dach", "germany", "german", "austria", "austrian", "switzerland", "swiss"],
  uk: ["uk", "britain", "british", "england", "english", "scotland", "scottish", "wales", "welsh"],
  us: ["us", "usa", "american"],
  asia: ["asia", "asian", "apac"],
  africa: ["africa", "african"],
  latinamerica: ["latam", "latinamerica"],
  preseed: ["preseed"],
  seed: ["seed"],
  seriesa: ["seriesa"],
  seriesb: ["seriesb"],
  seriesc: ["seriesc"],
  growthstage: ["growthstage"],
  latestage: ["latestage"],
  pilot: ["pilot", "pilots", "piloting", "trial", "trials", "poc"],
  current: ["current", "currently", "now", "today", "active", "actively", "immediate", "immediately"],
  future: ["future", "later", "eventually", "longterm"],
  launch: ["launch", "launches", "launched", "launching"],
  expansion: ["expand", "expands", "expanded", "expanding", "expansion"],
} as const;

const PHRASE_FAMILIES: Array<{ pattern: RegExp; concept: string; label: string }> = [
  { pattern: /\bartificial[\s-]+intelligence\b/gu, concept: "ai", label: "AI" },
  { pattern: /\bmachine[\s-]+learning\b/gu, concept: "ai", label: "AI" },
  { pattern: /\bventure[\s-]+capital(?:ist)?s?\b/gu, concept: "investor", label: "venture capital" },
  { pattern: /\bbusiness[\s-]+development\b/gu, concept: "partnership", label: "business development" },
  { pattern: /\bhuman[\s-]+resources\b/gu, concept: "hiring", label: "human resources" },
  { pattern: /\btalent[\s-]+acquisition\b/gu, concept: "hiring", label: "talent acquisition" },
  { pattern: /\bpre[\s-]*seed\b/gu, concept: "preseed", label: "pre-seed" },
  { pattern: /\bearly[\s-]+stage\b/gu, concept: "preseed", label: "early-stage" },
  { pattern: /\bseries[\s-]*a\b/gu, concept: "seriesa", label: "Series A" },
  { pattern: /\bseries[\s-]*b\b/gu, concept: "seriesb", label: "Series B" },
  { pattern: /\bseries[\s-]*c\b/gu, concept: "seriesc", label: "Series C" },
  { pattern: /\bgrowth[\s-]+stage\b/gu, concept: "growthstage", label: "growth-stage" },
  { pattern: /\blate[\s-]+stage\b/gu, concept: "latestage", label: "late-stage" },
  { pattern: /\blong[\s-]+term\b/gu, concept: "future", label: "long-term" },
  { pattern: /\bproof[\s-]+of[\s-]+concept\b/gu, concept: "pilot", label: "proof of concept" },
  { pattern: /\bunited[\s-]+kingdom\b/gu, concept: "uk", label: "UK" },
  { pattern: /\bunited[\s-]+states(?:[\s-]+of[\s-]+america)?\b/gu, concept: "us", label: "US" },
  { pattern: /\blatin[\s-]+america\b/gu, concept: "latinamerica", label: "Latin America" },
];

const DISPLAY_CONCEPTS: Record<string, string> = {
  investor: "investment",
  customer: "customer buying",
  partnership: "partnerships",
  hiring: "hiring",
  advisor: "domain expertise",
  ai: "AI",
  b2b: "B2B",
  b2c: "B2C",
  uk: "UK",
  us: "US",
  preseed: "pre-seed",
  seriesa: "Series A",
  seriesb: "Series B",
  seriesc: "Series C",
  growthstage: "growth-stage",
  latestage: "late-stage",
  latinamerica: "Latin America",
};

const wordAliases = new Map<string, string>();
Object.entries(LOCAL_WORD_FAMILIES).forEach(([concept, aliases]) => {
  aliases.forEach((alias) => wordAliases.set(alias, concept));
});

const objectiveCategories: Record<string, Attendee["category"][]> = {
  fundraising: ["investor"],
  customers: ["customer"],
  partnerships: ["partner"],
  hiring: ["talent"],
  advisors: ["advisor_expert"],
};

const relatedCategories: Record<string, Set<Attendee["category"]>> = {
  fundraising: new Set(["investor", "partner", "advisor_expert"]),
  customers: new Set(["customer", "partner", "advisor_expert"]),
  partnerships: new Set(["partner", "customer", "investor", "advisor_expert"]),
  hiring: new Set(["talent", "partner", "advisor_expert"]),
  advisors: new Set(["advisor_expert", "customer", "investor", "partner"]),
};

const CATEGORY_GOAL_CONCEPTS: Partial<Record<Attendee["category"], string>> = {
  investor: "investor",
  customer: "customer",
  partner: "partnership",
  talent: "hiring",
  advisor_expert: "advisor",
};

export const LOCAL_RANKING_WEIGHTS = {
  goalFit: 0.30,
  companyFit: 0.25,
  timingFit: 0.15,
  mutualRelevance: 0.15,
  actionability: 0.10,
  informationQuality: 0.05,
} as const;

export const LOCAL_RANKING_THRESHOLDS = {
  mustMeet: 75,
  worthMeeting: 55,
  wildcard: 45,
  mustMeetCap: 5,
  worthMeetingCap: 5,
  wildcardCap: 3,
} as const;

const STAGE_LEVELS: Record<string, number> = {
  preseed: 1,
  seed: 2,
  seriesa: 3,
  seriesb: 4,
  seriesc: 5,
  growthstage: 6,
  latestage: 7,
};

const TIMING_CONCEPTS = new Set([
  ...Object.keys(STAGE_LEVELS),
  "current", "customer", "expansion", "future", "hiring", "launch", "pilot",
]);

const REGION_CONTINENTS: Record<string, string> = {
  europe: "europe",
  nordics: "europe",
  dach: "europe",
  uk: "europe",
  us: "north-america",
  asia: "asia",
  africa: "africa",
  latinamerica: "south-america",
};

function normalizeText(value: string) {
  return value.toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "");
}

function simpleStem(word: string) {
  if (word.length <= 4 || IMPORTANT_SHORT_TERMS.has(word)) return word;
  if (word.endsWith("ies") && word.length > 4) return `${word.slice(0, -3)}y`;
  if (word.endsWith("sses")) return word.slice(0, -2);
  if (/(?:ches|shes|xes|zes)$/.test(word)) return word.slice(0, -2);
  if (word.endsWith("ing") && word.length > 6) {
    const base = word.slice(0, -3);
    return /(.)\1$/.test(base) ? base.slice(0, -1) : base;
  }
  if (word.endsWith("ed") && word.length > 5) {
    const base = word.slice(0, -2);
    return /(.)\1$/.test(base) ? base.slice(0, -1) : base;
  }
  if (word.endsWith("s") && !word.endsWith("ss") && !word.endsWith("us")) return word.slice(0, -1);
  return word;
}

function canonicalWord(word: string) {
  const direct = wordAliases.get(word);
  if (direct) return direct;
  const stem = simpleStem(word);
  return wordAliases.get(stem) ?? stem;
}

function conceptMap(value: string) {
  const concepts = new Map<string, string>();
  let remaining = normalizeText(value);
  PHRASE_FAMILIES.forEach(({ pattern, concept, label }) => {
    remaining = remaining.replace(pattern, () => {
      if (!concepts.has(concept)) concepts.set(concept, label);
      return " ";
    });
  });

  remaining
    .replace(/[^a-z0-9\p{L}]+/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .forEach((word) => {
      if (STOP_WORDS.has(word) || (word.length <= 2 && !IMPORTANT_SHORT_TERMS.has(word))) return;
      const concept = canonicalWord(word);
      if (!concept || STOP_WORDS.has(concept)) return;
      if (!concepts.has(concept)) concepts.set(concept, DISPLAY_CONCEPTS[concept] ?? word);
    });
  return concepts;
}

type EvidenceMatch = { concept: string; label: string };

function overlap(left: string, right: string): EvidenceMatch[] {
  const leftConcepts = conceptMap(left);
  const rightConcepts = conceptMap(right);
  return Array.from(leftConcepts, ([concept, label]) => ({ concept, label }))
    .filter((item) => rightConcepts.has(item.concept));
}

function uniqueEvidence(...groups: EvidenceMatch[][]) {
  const seen = new Set<string>();
  return groups.flat().filter((item) => {
    if (seen.has(item.concept)) return false;
    seen.add(item.concept);
    return true;
  });
}

function clampScore(value: number) {
  return Math.max(0, Math.min(5, Math.round(value * 10) / 10));
}

function clampTotal(value: number) {
  return Math.max(0, Math.min(100, Math.round(value * 10) / 10));
}

function usefulOtherFields(attendee: Attendee) {
  return attendee.other.filter((item) => {
    if (/\b(url|linkedin|website|profile link)\b/i.test(item.label)) return false;
    if (/^https?:\/\//i.test(item.value.trim())) return false;
    return conceptMap(item.value).size > 0;
  });
}

function attendeeText(attendee: Attendee) {
  return [
    attendee.company,
    attendee.role,
    attendee.description,
    ...usefulOtherFields(attendee).flatMap((item) => [item.label, item.value]),
  ].filter(Boolean).join(" ");
}

function attendeeContextText(attendee: Attendee) {
  return [
    attendee.description,
    ...usefulOtherFields(attendee).flatMap((item) => [item.label, item.value]),
  ].filter(Boolean).join(" ");
}

function stageLevels(value: string) {
  return Array.from(conceptMap(value).keys())
    .flatMap((concept) => STAGE_LEVELS[concept] === undefined ? [] : [STAGE_LEVELS[concept]]);
}

function regionConcepts(value: string) {
  return Array.from(conceptMap(value).keys()).filter((concept) => REGION_CONTINENTS[concept]);
}

function regionsCompatible(left: string[], right: string[]) {
  if (!left.length || !right.length) return true;
  return left.some((leftRegion) => right.some((rightRegion) => (
    leftRegion === rightRegion || REGION_CONTINENTS[leftRegion] === REGION_CONTINENTS[rightRegion]
  )));
}

function findDeprioritizeMatches(value: string, profile: string) {
  const matches: EvidenceMatch[] = [];
  value.split(/\b(?:and|or)\b|[,;\n]+/i).map((part) => part.trim()).filter(Boolean).forEach((clause) => {
    const clauseConcepts = conceptMap(clause);
    const clauseMatches = overlap(clause, profile);
    if (!clauseMatches.length) return;
    const requiredMatches = clauseConcepts.size <= 1 ? 1 : 2;
    if (clauseMatches.length >= requiredMatches) matches.push(...clauseMatches);
  });
  return uniqueEvidence(matches);
}

function informationQualityScore(hasRole: boolean, hasCompany: boolean, hasContext: boolean) {
  if (hasRole && hasCompany && hasContext) return 5;
  if (hasRole && hasCompany) return 3.5;
  if ((hasRole || hasCompany) && hasContext) return 3;
  if (hasRole || hasCompany) return 2;
  if (hasContext) return 1.5;
  return 0.5;
}

function companyFitScore(matchCount: number) {
  if (!matchCount) return 0.5;
  return 1 + Math.min(4, matchCount * 0.9);
}

function mutualRelevanceScore(matchCount: number, exactCategory: boolean) {
  const matchScores = [0.8, 2.3, 3.3, 4.1, 4.7, 5];
  const base = matchScores[Math.min(matchCount, matchScores.length - 1)];
  return base + (exactCategory && matchCount ? 0.2 : exactCategory ? 0.6 : 0);
}

function actionabilityScore({
  hasRole,
  hasCompany,
  hasContext,
  evidenceCount,
}: {
  hasRole: boolean;
  hasCompany: boolean;
  hasContext: boolean;
  evidenceCount: number;
}) {
  if (hasRole && hasCompany && evidenceCount >= 2) return 5;
  if (hasRole && hasCompany && evidenceCount === 1) return 4.3;
  if (hasRole && hasCompany) return 2.5;
  if ((hasRole || hasCompany) && evidenceCount >= 2) return 3.4;
  if ((hasRole || hasCompany) && evidenceCount === 1) return 2.8;
  if (hasRole || hasCompany) return 1.5;
  if (hasContext && evidenceCount) return 2;
  return 0.5;
}

function displayObjective(primary: string) {
  return ({
    fundraising: "fundraising",
    customers: "customer development",
    partnerships: "partnerships",
    hiring: "hiring",
    advisors: "expert advice",
    network: "network building",
    other: "the stated objective",
  } as Record<string, string>)[primary] ?? primary;
}

function attendeeIdentity(attendee: Attendee) {
  if (attendee.role && attendee.company) return `${attendee.role} at ${attendee.company}`;
  if (attendee.role) return attendee.role;
  if (attendee.company) return `Attendee from ${attendee.company}`;
  return attendee.name;
}

export type LocalRankingDimensions = {
  goalFit: number;
  companyFit: number;
  timingFit: number;
  mutualRelevance: number;
  actionability: number;
  informationQuality: number;
};

export type LocalScoreAudit = {
  finalScore: number;
  prePenaltyScore: number;
  dimensions: LocalRankingDimensions;
  penalties: Array<{ code: "deprioritized" | "wrong_stage" | "wrong_geography" | "unrelated_role" | "insufficient_information"; points: number }>;
  confidence: Recommendation["confidence"];
  exactCategory: boolean;
  mappedObjective: boolean;
  flags: {
    deprioritized: boolean;
    wrongStage: boolean;
    wrongGeography: boolean;
    unrelatedRole: boolean;
    insufficientInformation: boolean;
  };
  evidence: {
    goal: string[];
    company: string[];
    timing: string[];
    deprioritized: string[];
  };
};

export type LocalScoredAttendee = {
  attendee: Attendee;
  score: number;
  recommendation: Recommendation;
  overlapWords: string[];
  order: number;
  audit: LocalScoreAudit;
};

function evidenceList(items: EvidenceMatch[], maximum = 3) {
  return items.slice(0, maximum).map((item) => item.label);
}

function formatEvidence(items: string[]) {
  const readableItems = items.map((item) => ({
    european: "Europe",
    nordic: "the Nordics",
    nordics: "the Nordics",
  } as Record<string, string>)[item.toLowerCase()] ?? item);
  if (readableItems.length <= 1) return readableItems[0] ?? "the stated goal";
  if (readableItems.length === 2) return `${readableItems[0]} and ${readableItems[1]}`;
  return `${readableItems.slice(0, -1).join(", ")}, and ${readableItems.at(-1)}`;
}

function compareScored(left: LocalScoredAttendee, right: LocalScoredAttendee) {
  return right.score - left.score
    || right.audit.dimensions.goalFit - left.audit.dimensions.goalFit
    || right.audit.dimensions.companyFit - left.audit.dimensions.companyFit
    || right.audit.dimensions.timingFit - left.audit.dimensions.timingFit
    || right.audit.dimensions.informationQuality - left.audit.dimensions.informationQuality
    || left.order - right.order;
}

export function scoreLocalAttendees(context: AnalysisContext) {
  return context.attendees
    .map((attendee, order) => scoreLocalAttendee(context, attendee, order))
    .sort(compareScored);
}

export function buildLocalShortlist(context: AnalysisContext, limit = 30) {
  const safeLimit = Math.max(0, Math.min(30, Math.floor(limit)));
  return scoreLocalAttendees(context).slice(0, safeLimit);
}

export function scoreLocalAttendee(context: AnalysisContext, attendee: Attendee, order = 0): LocalScoredAttendee {
  const profile = attendeeText(attendee);
  const profileContext = attendeeContextText(attendee);
  const companyText = [
    context.company.name,
    context.company.description,
    context.company.stage,
    context.company.geography,
    context.company.fundraising,
    context.company.commercial,
    context.company.additional,
  ].join(" ");
  // Deliberately excludes deprioritize: negative instructions never create positive fit.
  const positiveObjectiveText = [
    context.objective.primary,
    context.objective.details,
    context.objective.secondary,
    context.objective.valuable,
  ].join(" ");
  const timingContextText = [
    context.company.stage,
    context.company.fundraising,
    context.company.commercial,
    context.objective.details,
    context.objective.secondary,
    context.objective.valuable,
  ].join(" ");

  const goalMatches = overlap(positiveObjectiveText, profile);
  const companyMatches = overlap(companyText, profile);
  const timingMatches = overlap(timingContextText, profile).filter((match) => TIMING_CONCEPTS.has(match.concept));
  const deprioritizeMatches = findDeprioritizeMatches(context.objective.deprioritize, profile);
  const expected = objectiveCategories[context.objective.primary] ?? [];
  const exactCategory = expected.includes(attendee.category);
  const hasRole = Boolean(attendee.role);
  const hasCompany = Boolean(attendee.company);
  const hasContext = Boolean(profileContext);

  const goalFit = exactCategory
    ? 4.2 + Math.min(0.8, goalMatches.length * 0.25)
    : context.objective.primary === "network"
      ? 2.4 + Math.min(2.6, goalMatches.length * 0.65)
      : context.objective.primary === "other"
        ? 1 + Math.min(4, goalMatches.length * 0.8)
        : 0.5 + Math.min(3.5, goalMatches.length * 0.7);

  const companyFit = companyFitScore(companyMatches.length);
  const founderStages = stageLevels(`${context.company.stage} ${context.company.fundraising} ${context.objective.details}`);
  const attendeeStages = stageLevels(profile);
  let wrongStage = false;
  let timingFit: number;
  if (context.objective.primary === "fundraising" && exactCategory && founderStages.length && attendeeStages.length) {
    const distance = Math.min(...founderStages.flatMap((founderStage) => attendeeStages.map((attendeeStage) => Math.abs(founderStage - attendeeStage))));
    wrongStage = distance >= 2.5;
    timingFit = distance === 0 ? 5 : distance <= 1 ? 4.2 : distance < 2.5 ? 2.6 : 0.6;
  } else if (exactCategory) {
    timingFit = 3.2 + Math.min(1.8, timingMatches.length * 0.6);
  } else if (timingMatches.length) {
    timingFit = 2 + Math.min(2.5, timingMatches.length * 0.65);
  } else {
    timingFit = 1.4;
  }
  const profileConcepts = conceptMap(profile);
  if (profileConcepts.has("future") && !profileConcepts.has("current")) timingFit -= 1.2;

  const mutualRelevance = mutualRelevanceScore(companyMatches.length, exactCategory);
  const allPositiveEvidence = uniqueEvidence(goalMatches, companyMatches, timingMatches);
  const actionability = actionabilityScore({
    hasRole,
    hasCompany,
    hasContext,
    evidenceCount: allPositiveEvidence.length,
  });
  const informationQuality = informationQualityScore(hasRole, hasCompany, hasContext);

  const targetRegions = regionConcepts(`${context.company.geography} ${context.objective.details} ${context.objective.valuable}`);
  const attendeeRegions = regionConcepts(profileContext);
  const wrongGeography = Boolean(targetRegions.length && attendeeRegions.length && !regionsCompatible(targetRegions, attendeeRegions));
  const related = relatedCategories[context.objective.primary];
  const hasKnownCategory = attendee.category !== "other" && attendee.category !== "unknown";
  const categoryGoalConcept = CATEGORY_GOAL_CONCEPTS[attendee.category];
  const objectiveConcepts = conceptMap(positiveObjectiveText);
  const categoryExplicitlyRequested = Boolean(categoryGoalConcept && objectiveConcepts.has(categoryGoalConcept));
  const unrelatedRole = Boolean(
    related
    && hasRole
    && hasKnownCategory
    && !related.has(attendee.category)
    && !categoryExplicitlyRequested,
  );
  const insufficientInformation = informationQuality <= 1;

  const dimensions: LocalRankingDimensions = {
    goalFit: clampScore(goalFit),
    companyFit: clampScore(companyFit),
    timingFit: clampScore(timingFit),
    mutualRelevance: clampScore(mutualRelevance),
    actionability: clampScore(actionability),
    informationQuality: clampScore(informationQuality),
  };
  const prePenaltyScore = clampTotal((
    dimensions.goalFit * LOCAL_RANKING_WEIGHTS.goalFit
    + dimensions.companyFit * LOCAL_RANKING_WEIGHTS.companyFit
    + dimensions.timingFit * LOCAL_RANKING_WEIGHTS.timingFit
    + dimensions.mutualRelevance * LOCAL_RANKING_WEIGHTS.mutualRelevance
    + dimensions.actionability * LOCAL_RANKING_WEIGHTS.actionability
    + dimensions.informationQuality * LOCAL_RANKING_WEIGHTS.informationQuality
  ) * 20);
  const penalties: LocalScoreAudit["penalties"] = [];
  if (deprioritizeMatches.length) penalties.push({ code: "deprioritized", points: -35 });
  if (wrongStage) penalties.push({ code: "wrong_stage", points: -25 });
  if (wrongGeography) penalties.push({ code: "wrong_geography", points: -20 });
  if (unrelatedRole) penalties.push({ code: "unrelated_role", points: -15 });
  if (insufficientInformation) penalties.push({ code: "insufficient_information", points: -25 });
  const finalScore = clampTotal(prePenaltyScore + penalties.reduce((total, penalty) => total + penalty.points, 0));

  const hardMismatch = wrongStage || wrongGeography || unrelatedRole || Boolean(deprioritizeMatches.length);
  const evidenceCount = allPositiveEvidence.length;
  const confidence: Recommendation["confidence"] = hasRole && hasCompany && hasContext && evidenceCount >= 2 && !hardMismatch
    ? "high"
    : informationQuality >= 3 && (exactCategory || evidenceCount >= 1) && !wrongStage && !wrongGeography
      ? "medium"
      : "low";
  const missingInformation = [
    !hasRole && "role",
    !hasCompany && "company",
    !hasContext && "useful profile context",
    !exactCategory && goalMatches.length === 0 && "evidence of direct goal fit",
    companyMatches.length === 0 && "evidence of specific company fit",
    context.objective.primary === "fundraising" && exactCategory && founderStages.length > 0 && attendeeStages.length === 0 && "attendee stage focus",
    targetRegions.length > 0 && attendeeRegions.length === 0 && "attendee geography",
  ].filter(Boolean) as string[];

  const companyEvidence = evidenceList(companyMatches);
  const bestEvidence = evidenceList(uniqueEvidence(goalMatches, companyMatches, timingMatches));
  const objectiveLabel = displayObjective(context.objective.primary);
  const identity = attendeeIdentity(attendee);
  const relevanceEvidence = uniqueEvidence(goalMatches, companyMatches, timingMatches);
  const whyThem = conciseRecommendationSentence(
    relevanceEvidence.length
      ? `${identity} brings relevant context on ${formatEvidence(evidenceList(relevanceEvidence, 2))}.`
      : exactCategory
        ? `${identity} in the right category, though direct fit is still unclear.`
        : `${identity}; direct relevance to ${objectiveLabel} is unclear.`,
  );
  const whyYou = conciseRecommendationSentence(
    companyEvidence.length
      ? `${context.company.name || "The company"} shares ${formatEvidence(companyEvidence.slice(0, 2))} priorities with ${attendee.name}, giving both sides a concrete reason to talk.`
      : exactCategory
        ? `${context.company.name || "The company"}’s ${objectiveLabel} goal gives ${attendee.name} a clear reason to explore mutual fit.`
        : `${context.company.name || "The company"} can quickly test whether its ${objectiveLabel} goal is relevant to ${attendee.name}.`,
  );
  const suggestedAngle = conciseRecommendationSentence(
    bestEvidence.length
      ? `Lead with ${context.company.name || "the company"}’s ${objectiveLabel} goal; ask about ${formatEvidence(bestEvidence.slice(0, 2))}.`
      : `Lead with ${context.objective.details || objectiveLabel}, then ask what is useful to explore now.`,
  );

  // Keep the existing API result shape while mapping the new dimensions into
  // its established six numeric score slots.
  const scores = {
    objectiveFit: dimensions.goalFit,
    companyFit: dimensions.companyFit,
    immediateUtility: dimensions.timingFit,
    realisticUsefulness: dimensions.informationQuality,
    reciprocalValue: dimensions.mutualRelevance,
    actionability: dimensions.actionability,
  };

  const audit: LocalScoreAudit = {
    finalScore,
    prePenaltyScore,
    dimensions,
    penalties,
    confidence,
    exactCategory,
    mappedObjective: expected.length > 0,
    flags: {
      deprioritized: deprioritizeMatches.length > 0,
      wrongStage,
      wrongGeography,
      unrelatedRole,
      insufficientInformation,
    },
    evidence: {
      goal: goalMatches.map((item) => item.label),
      company: companyMatches.map((item) => item.label),
      timing: timingMatches.map((item) => item.label),
      deprioritized: deprioritizeMatches.map((item) => item.label),
    },
  };

  return {
    attendee,
    score: finalScore,
    overlapWords: bestEvidence,
    order,
    audit,
    recommendation: {
      attendeeId: attendee.id,
      tier: "worth_meeting",
      whyThem,
      whyYou,
      suggestedAngle,
      confidence,
      missingInformation,
      scores,
    },
  };
}

function isCoreBlocked(item: LocalScoredAttendee) {
  const flags = item.audit.flags;
  return flags.deprioritized || flags.wrongStage || flags.wrongGeography || flags.unrelatedRole || flags.insufficientInformation;
}

function qualifiesForMustMeet(item: LocalScoredAttendee) {
  const { dimensions, confidence } = item.audit;
  const exceptionalLowConfidenceCase = confidence === "low"
    && item.score >= 90
    && dimensions.goalFit >= 4.8
    && dimensions.companyFit >= 4.5
    && item.overlapWords.length >= 3;
  return (!item.audit.mappedObjective || item.audit.exactCategory)
    && !isCoreBlocked(item)
    && item.score >= LOCAL_RANKING_THRESHOLDS.mustMeet
    && dimensions.goalFit >= 4
    && dimensions.timingFit >= 3.2
    && dimensions.informationQuality >= 3
    && (confidence !== "low" || exceptionalLowConfidenceCase);
}

function qualifiesForWorthMeeting(item: LocalScoredAttendee) {
  const { dimensions } = item.audit;
  return !isCoreBlocked(item)
    && item.score >= LOCAL_RANKING_THRESHOLDS.worthMeeting
    && (item.audit.exactCategory || dimensions.goalFit >= 3.5)
    && dimensions.informationQuality >= 2;
}

function qualifiesForWildcard(item: LocalScoredAttendee) {
  const evidence = item.audit.evidence;
  const hasSpecificCase = evidence.company.length >= 2
    || (evidence.goal.length >= 1 && evidence.company.length >= 1)
    || (evidence.timing.length >= 1 && evidence.goal.length + evidence.company.length >= 1);
  return !isCoreBlocked(item)
    && !item.audit.exactCategory
    && item.score >= LOCAL_RANKING_THRESHOLDS.wildcard
    && item.audit.dimensions.informationQuality >= 2
    && hasSpecificCase;
}

function withTier(item: LocalScoredAttendee, tier: RecommendationTier): Recommendation {
  const recommendation = { ...item.recommendation, tier };
  if (tier === "wildcard") {
    recommendation.whyThem = item.overlapWords.length
      ? conciseRecommendationSentence(`${attendeeIdentity(item.attendee)} offers an adjacent perspective on ${formatEvidence(item.overlapWords.slice(0, 2))}.`)
      : recommendation.whyThem;
  }
  return recommendation;
}

export function buildLocalRanking(context: AnalysisContext): RankingResult {
  const scored = scoreLocalAttendees(context);
  const mustMeet = scored
    .filter(qualifiesForMustMeet)
    .slice(0, LOCAL_RANKING_THRESHOLDS.mustMeetCap);
  const selectedIds = new Set(mustMeet.map((item) => item.attendee.id));
  const worthMeeting = scored
    .filter((item) => !selectedIds.has(item.attendee.id) && qualifiesForWorthMeeting(item))
    .slice(0, LOCAL_RANKING_THRESHOLDS.worthMeetingCap);
  worthMeeting.forEach((item) => selectedIds.add(item.attendee.id));
  const wildcards = scored
    .filter((item) => !selectedIds.has(item.attendee.id) && qualifiesForWildcard(item))
    .slice(0, LOCAL_RANKING_THRESHOLDS.wildcardCap);

  const recommendations = [
    ...mustMeet.map((item) => withTier(item, "must_meet")),
    ...worthMeeting.map((item) => withTier(item, "worth_meeting")),
    ...wildcards.map((item) => withTier(item, "wildcard")),
  ];

  return {
    eventAnalysis: buildLocalEventAnalysis(context),
    recommendations,
    mode: "local",
  };
}

export function buildLocalChallenge(
  context: AnalysisContext,
  recommendations: Recommendation[],
): ChallengeResult {
  const rankedIds = new Set(recommendations.map((item) => item.attendeeId));
  const attendeesById = new Map(context.attendees.map((item) => [item.id, item]));
  const possiblyOverrated = recommendations
    .filter((item) => {
      const attendee = attendeesById.get(item.attendeeId);
      return item.confidence === "low" || /\b(chief|ceo|president|partner)\b/i.test(attendee?.role ?? "");
    })
    .slice(0, 3)
    .map((item) => ({
      attendeeId: item.attendeeId,
      reason: item.confidence === "low"
        ? "The rank rests on sparse attendee evidence, so apparent fit may not survive a quick real-world check."
        : "The senior title is conspicuous, but title alone does not show access, timing, or a reason to engage.",
    }));

  const missed = context.attendees
    .filter((attendee) => !rankedIds.has(attendee.id))
    .map((attendee, order) => scoreLocalAttendee(context, attendee, order))
    .sort(compareScored);
  const credibleCoreMisses = missed.filter((item) => qualifiesForMustMeet(item) || qualifiesForWorthMeeting(item));
  const peopleMissed = credibleCoreMisses.slice(0, 3).map((item) => ({
    attendeeId: item.attendee.id,
    reason: item.overlapWords.length
      ? `The original cut may have underweighted the supplied overlap around ${item.overlapWords.slice(0, 2).join(" and ")}.`
      : "This profile is less obvious, but its role may offer a practical route that the first pass underweighted.",
    suggestedTier: qualifiesForMustMeet(item) ? "must_meet" as const : "worth_meeting" as const,
  }));
  const wildcardCandidate = missed.find((item) => qualifiesForWildcard(item) && !peopleMissed.some((missedItem) => missedItem.attendeeId === item.attendee.id))
    ?? recommendations.filter((item) => item.tier === "wildcard").map((item) => scoreLocalAttendee(context, attendeesById.get(item.attendeeId)!))[0];

  return {
    possiblyOverrated,
    peopleMissed,
    wildcard: wildcardCandidate ? {
      attendeeId: wildcardCandidate.attendee.id,
      reason: "The profile is not an obvious top-ranked match, which is exactly why it is useful as a deliberate second-order bet.",
      potentialUnlock: wildcardCandidate.overlapWords.length
        ? `A conversation could test the shared signals around ${wildcardCandidate.overlapWords.slice(0, 2).join(" and ")}.`
        : "A different vantage point, referral, or constraint check that the obvious profiles may not provide.",
    } : null,
    mode: "local",
  };
}

function trimWords(message: string, maximum = 70) {
  const words = message.trim().split(/\s+/);
  return words.length <= maximum ? message.trim() : `${words.slice(0, maximum - 1).join(" ")}…`;
}

export function buildLocalOutreach(
  context: AnalysisContext,
  attendee: Attendee,
): OutreachResult {
  const firstName = attendee.name.split(/\s+/)[0];
  const enoughDetail = Boolean(attendee.role && attendee.company && (attendee.description || context.company.description));
  const objective = context.objective.details || `advance our ${displayObjective(context.objective.primary)} goal`;
  const message = enoughDetail
    ? `Hi ${firstName} — I’m with ${context.company.name} — ${context.company.description}. I saw you’re attending from ${attendee.company} as ${attendee.role}. Our conference focus is: ${objective}. There seems to be a relevant conversation. Would you have 15 minutes there?`
    : `Hi ${firstName} — I’m with ${context.company.name || "an early-stage company"}. Our goal for the conference is: ${objective}. Your attendee profile looked potentially relevant, though the list shared limited detail. Would you be open to a 15-minute conversation there?`;

  return {
    attendeeId: attendee.id,
    personalization: enoughDetail ? "strong" : "limited",
    message: trimWords(message),
    missingInformation: enoughDetail ? [] : [
      !attendee.role && "attendee role",
      !attendee.company && "attendee company",
      !attendee.description && "attendee interests or profile context",
    ].filter(Boolean) as string[],
    mode: "local",
  };
}

function cleanSentence(value: string, maximum = 28) {
  const trimmed = trimWords(value.replace(/\s+/g, " ").trim(), maximum);
  if (!trimmed || /[.!?…]$/.test(trimmed)) return trimmed;
  return `${trimmed}.`;
}

function meetingNextStep(attendee: Attendee, companyName: string) {
  const attendeeCompany = attendee.company ? ` with ${attendee.company}` : "";
  if (attendee.category === "investor") {
    return `Leave with a clear view on investment fit and, if positive, an agreed follow-up and the materials ${attendee.name} wants to review.`;
  }
  if (attendee.category === "customer") {
    return `Leave with a named next step${attendeeCompany} to assess a pilot or commercial conversation with ${companyName}.`;
  }
  if (attendee.category === "partner") {
    return `Leave with the right owner${attendeeCompany} and one concrete follow-up to test a partnership with ${companyName}.`;
  }
  return `Leave with one concrete follow-up tied to ${companyName}'s conference objective and a clear owner for it.`;
}

export function buildLocalMeetingPrep(
  context: AnalysisContext,
  attendee: Attendee,
  recommendation: Recommendation,
  warmPath?: Pick<WarmPath, "viaName" | "targetName"> | null,
): MeetingPrepResult {
  const objective = context.objective.details || displayObjective(context.objective.primary);
  const missing = recommendation.missingInformation[0];
  const lead = recommendation.whyYou || context.company.description;
  const warmLead = warmPath
    ? `Use ${warmPath.viaName}'s introduction as context, then ${lead.charAt(0).toLowerCase()}${lead.slice(1)}`
    : lead;
  const listenFor = missing
    ? `Listen for clarity on ${missing}, practical fit, and whether a concrete next step is realistic.`
    : `Listen for practical fit, timing, decision criteria, and whether a concrete next step is realistic.`;

  return {
    attendeeId: attendee.id,
    whyThisMeeting: cleanSentence(recommendation.whyThem, 26),
    leadWith: cleanSentence(warmLead, 26),
    askThis: cleanSentence(recommendation.suggestedAngle, 24),
    listenFor: cleanSentence(listenFor, 22),
    dontWasteTimeOn: cleanSentence(`Do not spend the meeting on a broad overview; keep it focused on ${objective}`, 24),
    desiredNextStep: cleanSentence(meetingNextStep(attendee, context.company.name || "the company"), 26),
    mode: "local",
  };
}
