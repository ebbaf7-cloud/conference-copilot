import type {
  AnalysisContext,
  Attendee,
  AttendeeCategory,
  EventAnalysis,
  MeetingFocus,
} from "@/lib/conference/types";

type CountedSignal = { label: string; count: number };

type SignalDefinition = {
  label: string;
  pattern: RegExp;
};

const CATEGORIES: AttendeeCategory[] = [
  "investor",
  "customer",
  "partner",
  "talent",
  "advisor_expert",
  "media",
  "service_provider",
  "other",
  "unknown",
];

const CATEGORY_LABELS: Record<AttendeeCategory, string> = {
  investor: "investors",
  customer: "potential customers",
  partner: "potential strategic partners",
  talent: "talent and hiring profiles",
  advisor_expert: "advisors and experts",
  media: "media profiles",
  service_provider: "service providers",
  other: "other profiles",
  unknown: "unclassified profiles",
};

const FOCUS_LABELS: Record<MeetingFocus, string> = {
  investors: "investors",
  customers: "customers",
  strategic_partners: "strategic partners",
  experts: "experts",
  talent: "talent",
  relationship_building: "relationship-building",
};

const OBJECTIVE_FOCUS: Record<string, MeetingFocus> = {
  fundraising: "investors",
  customers: "customers",
  partnerships: "strategic_partners",
  hiring: "talent",
  advisors: "experts",
  network: "relationship_building",
};

const FOCUS_CATEGORY: Partial<Record<MeetingFocus, AttendeeCategory>> = {
  investors: "investor",
  customers: "customer",
  strategic_partners: "partner",
  experts: "advisor_expert",
  talent: "talent",
};

const STAGE_SIGNALS: SignalDefinition[] = [
  { label: "pre-seed", pattern: /\bpre[\s-]*seed\b/i },
  { label: "seed", pattern: /(?<!pre[\s-])\bseed\b/i },
  { label: "Series A", pattern: /\bseries[\s-]*a\b/i },
  { label: "Series B", pattern: /\bseries[\s-]*b\b/i },
  { label: "Series C", pattern: /\bseries[\s-]*c\b/i },
  { label: "growth-stage", pattern: /\bgrowth[\s-]*(?:stage|equity)?\b/i },
  { label: "late-stage", pattern: /\blate[\s-]*stage\b/i },
];

const GEOGRAPHY_SIGNALS: SignalDefinition[] = [
  { label: "Nordics", pattern: /\b(?:nordics?|scandinavia|sweden|norway|denmark|finland|iceland)\b/i },
  { label: "Europe", pattern: /\b(?:europe|european|eu)\b/i },
  { label: "DACH", pattern: /\b(?:dach|germany|austria|switzerland)\b/i },
  { label: "UK", pattern: /\b(?:uk|united kingdom|britain|england|scotland|wales)\b/i },
  { label: "US", pattern: /\b(?:us|usa|united states|american)\b/i },
  { label: "Asia / APAC", pattern: /\b(?:asia|asian|apac)\b/i },
  { label: "Africa", pattern: /\b(?:africa|african)\b/i },
  { label: "Latin America", pattern: /\b(?:latam|latin america)\b/i },
];

const THEME_SIGNALS: SignalDefinition[] = [
  { label: "climate", pattern: /\b(?:climate|climatetech|clean[\s-]*tech)\b/i },
  { label: "decarbonisation", pattern: /\bdecarboni[sz](?:ation|e|ing)\b/i },
  { label: "carbon capture", pattern: /\bcarbon[\s-]*(?:capture|removal)\b|\bccus\b/i },
  { label: "industrial / manufacturing", pattern: /\b(?:industrial|industry|manufactur(?:e|er|ing))\b/i },
  { label: "energy", pattern: /\b(?:energy|power|electricity|battery|batteries)\b/i },
  { label: "food / agriculture", pattern: /\b(?:food|agri[\s-]*tech|agriculture|farming)\b/i },
  { label: "health / care", pattern: /\b(?:health|healthcare|medical|care delivery)\b/i },
  { label: "finance / fintech", pattern: /\b(?:fintech|financial services|banking|payments)\b/i },
  { label: "AI / machine learning", pattern: /\b(?:ai|artificial intelligence|machine learning|ml)\b/i },
  { label: "software / SaaS", pattern: /\b(?:software|saas)\b/i },
  { label: "hardware", pattern: /\bhardware\b/i },
  { label: "mobility / transport", pattern: /\b(?:mobility|transport|logistics|automotive)\b/i },
  { label: "circular economy", pattern: /\b(?:circular economy|recycling|waste)\b/i },
  { label: "biotech / life sciences", pattern: /\b(?:biotech|life sciences?|pharma)\b/i },
  { label: "construction / built environment", pattern: /\b(?:construction|built environment|real estate|cement|concrete|lime)\b/i },
];

const INVESTOR_TYPE_SIGNALS: SignalDefinition[] = [
  { label: "angel investors", pattern: /\bangel(?: investor| network| syndicate)?s?\b/i },
  { label: "venture capital", pattern: /\b(?:venture capital|vc)\b/i },
  { label: "corporate venture", pattern: /\b(?:corporate venture|cvc)\b/i },
  { label: "family offices", pattern: /\bfamily office\b/i },
  { label: "impact investors", pattern: /\bimpact invest(?:or|ing|ment)s?\b/i },
  { label: "growth investors", pattern: /\bgrowth invest(?:or|ing|ment)s?\b/i },
  { label: "private equity", pattern: /\bprivate equity\b/i },
  { label: "public / grant funding", pattern: /\b(?:grant|public fund|government fund|foundation)\b/i },
];

const FOCUS_PATTERNS: Record<MeetingFocus, RegExp> = {
  investors: /\b(?:fundrais|invest|venture|angel|capital|fund)\w*\b/i,
  customers: /\b(?:customer|buyer|procurement|client|sales|commercial)\w*\b/i,
  strategic_partners: /\b(?:partner|alliance|collaborat|business development)\w*\b/i,
  experts: /\b(?:advisor|expert|research|mentor|scientist)\w*\b/i,
  talent: /\b(?:hire|hiring|talent|recruit)\w*\b/i,
  relationship_building: /\b(?:network|relationship|community|media)\w*\b/i,
};

function usefulOther(attendee: Attendee) {
  return attendee.other.filter((item) => (
    !/\b(url|uri|link|website|linkedin)\b/i.test(item.label)
    && !/^https?:\/\//i.test(item.value.trim())
    && Boolean(item.value.trim())
  ));
}

function profileText(attendee: Attendee) {
  return [
    attendee.role,
    attendee.company,
    attendee.description,
    ...usefulOther(attendee).flatMap((item) => [item.label, item.value]),
  ].filter(Boolean).join(" ");
}

function hasProfileContext(attendee: Attendee) {
  return Boolean(attendee.description?.trim()) || usefulOther(attendee).length > 0;
}

function countSignals(attendees: Attendee[], definitions: SignalDefinition[]): CountedSignal[] {
  return definitions
    .map(({ label, pattern }) => ({
      label,
      count: attendees.reduce((total, attendee) => total + (pattern.test(profileText(attendee)) ? 1 : 0), 0),
    }))
    .filter((item) => item.count > 0)
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
}

function topRoleSignals(attendees: Attendee[], maximum = 6): CountedSignal[] {
  const counts = new Map<string, { label: string; count: number }>();
  attendees.forEach((attendee) => {
    const role = attendee.role?.trim();
    if (!role) return;
    const key = role.toLocaleLowerCase();
    const current = counts.get(key);
    counts.set(key, { label: current?.label ?? role, count: (current?.count ?? 0) + 1 });
  });
  return [...counts.values()]
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label))
    .slice(0, maximum);
}

function seniorityCounts(attendees: Attendee[]) {
  return attendees.reduce((counts, attendee) => {
    const role = attendee.role?.trim() ?? "";
    if (/\b(?:founder|co-founder|ceo|chief|president|partner|managing director|vice president|vp|head|director)\b/i.test(role)) {
      counts.seniorTitle += 1;
    } else if (/\b(?:principal|manager|lead|associate)\b/i.test(role)) {
      counts.managerOrSpecialist += 1;
    } else {
      counts.otherOrUnknown += 1;
    }
    return counts;
  }, { seniorTitle: 0, managerOrSpecialist: 0, otherOrUnknown: 0 });
}

function categoryCounts(attendees: Attendee[]) {
  const counts = Object.fromEntries(CATEGORIES.map((category) => [category, 0])) as Record<AttendeeCategory, number>;
  attendees.forEach((attendee) => { counts[attendee.category] += 1; });
  return counts;
}

function categorySummary(attendees: Attendee[]) {
  return {
    count: attendees.length,
    topRoles: topRoleSignals(attendees, 5),
    stages: countSignals(attendees, STAGE_SIGNALS).slice(0, 7),
    geographies: countSignals(attendees, GEOGRAPHY_SIGNALS).slice(0, 8),
    themes: countSignals(attendees, THEME_SIGNALS).slice(0, 8),
  };
}

export type EventEvidence = ReturnType<typeof buildEventEvidence>;

export function buildEventEvidence(context: AnalysisContext) {
  const attendees = context.attendees;
  const counts = categoryCounts(attendees);
  const investors = attendees.filter((attendee) => attendee.category === "investor");
  const customers = attendees.filter((attendee) => attendee.category === "customer");
  const partners = attendees.filter((attendee) => attendee.category === "partner");
  const withRole = attendees.filter((attendee) => Boolean(attendee.role?.trim())).length;
  const withCompany = attendees.filter((attendee) => Boolean(attendee.company?.trim())).length;
  const withContext = attendees.filter(hasProfileContext).length;
  const completeProfiles = attendees.filter((attendee) => (
    Boolean(attendee.role?.trim()) && Boolean(attendee.company?.trim()) && hasProfileContext(attendee)
  )).length;

  return {
    attendeeCount: attendees.length,
    categoryCounts: counts,
    topRoles: topRoleSignals(attendees),
    seniority: seniorityCounts(attendees),
    explicitSignals: {
      stages: countSignals(attendees, STAGE_SIGNALS).slice(0, 7),
      geographies: countSignals(attendees, GEOGRAPHY_SIGNALS).slice(0, 8),
      themes: countSignals(attendees, THEME_SIGNALS).slice(0, 10),
    },
    investorLandscape: {
      ...categorySummary(investors),
      explicitTypes: countSignals(investors, INVESTOR_TYPE_SIGNALS).slice(0, 8),
    },
    customerLandscape: categorySummary(customers),
    partnerLandscape: categorySummary(partners),
    completeness: {
      withRole,
      withCompany,
      withProfileContext: withContext,
      completeProfiles,
      unknownOrOtherCategory: counts.unknown + counts.other,
    },
  };
}

function formatSignalList(signals: CountedSignal[], emptyText: string, maximum = 4) {
  if (!signals.length) return emptyText;
  return signals.slice(0, maximum).map((item) => `${item.label} (${item.count})`).join(", ");
}

function dominantProfileText(evidence: EventEvidence) {
  const total = evidence.attendeeCount;
  const dominant = CATEGORIES
    .map((category) => ({ category, count: evidence.categoryCounts[category] }))
    .filter((item) => item.count > 0)
    .sort((left, right) => right.count - left.count)
    .slice(0, 3);
  if (!dominant.length) return "The roster does not contain enough classified profile information to describe the room.";
  return dominant.map((item) => {
    const share = Math.round((item.count / Math.max(1, total)) * 100);
    return `${CATEGORY_LABELS[item.category]} (${item.count}, ${share}%)`;
  }).join(", ");
}

function categoryOpportunityLabel(primary: string) {
  return ({
    fundraising: "fundraising",
    customers: "customer development",
    partnerships: "strategic partnerships",
    hiring: "hiring",
    advisors: "expert conversations",
    network: "relationship-building",
  } as Record<string, string>)[primary] ?? "the stated conference objective";
}

function focusCount(focus: MeetingFocus, evidence: EventEvidence) {
  const category = FOCUS_CATEGORY[focus];
  if (category) return evidence.categoryCounts[category];
  return evidence.categoryCounts.media
    + evidence.categoryCounts.service_provider
    + evidence.categoryCounts.other
    + evidence.categoryCounts.unknown;
}

function focusRationale(focus: MeetingFocus, count: number, isPrimary: boolean) {
  const primary = isPrimary ? " and this is the stated primary objective" : "";
  if (focus === "relationship_building") {
    return `${count} mixed or less-specific profiles support selective relationship-building${primary}.`;
  }
  return `${count} ${FOCUS_LABELS[focus]} ${count === 1 ? "profile is" : "profiles are"} present${primary}.`;
}

function allocateMeetingMix(context: AnalysisContext, evidence: EventEvidence): EventAnalysis["strategy"]["meetingMix"] {
  const primaryFocus = OBJECTIVE_FOCUS[context.objective.primary];
  const positiveObjective = `${context.objective.secondary} ${context.objective.valuable}`;
  const deprioritize = context.objective.deprioritize;
  const focuses: MeetingFocus[] = ["investors", "customers", "strategic_partners", "experts", "talent", "relationship_building"];
  const weighted = focuses.flatMap((focus) => {
    const count = focusCount(focus, evidence);
    if (!count) return [];
    let weight = count;
    if (focus === primaryFocus) weight *= 2.6;
    if (FOCUS_PATTERNS[focus].test(positiveObjective)) weight *= 1.45;
    if (FOCUS_PATTERNS[focus].test(deprioritize)) weight *= 0.25;
    return [{ focus, count, weight }];
  }).sort((left, right) => right.weight - left.weight).slice(0, 4);

  if (!weighted.length) {
    return [{
      focus: "relationship_building",
      percentage: 100,
      rationale: "The attendee records are too sparse to support a more specific allocation.",
    }];
  }

  const totalWeight = weighted.reduce((sum, item) => sum + item.weight, 0);
  const exact = weighted.map((item) => ({ ...item, exact: (item.weight / totalWeight) * 100 }));
  const allocated = exact.map((item) => ({ ...item, percentage: Math.floor(item.exact) }));
  let remaining = 100 - allocated.reduce((sum, item) => sum + item.percentage, 0);
  const remainderOrder = allocated
    .map((item, index) => ({ index, remainder: item.exact - item.percentage }))
    .sort((left, right) => right.remainder - left.remainder);
  for (let index = 0; remaining > 0; index += 1, remaining -= 1) {
    allocated[remainderOrder[index % remainderOrder.length].index].percentage += 1;
  }

  return allocated.map((item) => ({
    focus: item.focus,
    percentage: item.percentage,
    rationale: focusRationale(item.focus, item.count, item.focus === primaryFocus),
  }));
}

function strongestSupportedFocus(context: AnalysisContext, mix: EventAnalysis["strategy"]["meetingMix"]) {
  const primary = OBJECTIVE_FOCUS[context.objective.primary];
  const supportedPrimary = primary && mix.find((item) => item.focus === primary);
  return supportedPrimary ?? mix[0];
}

function buildGoodFor(context: AnalysisContext, evidence: EventEvidence) {
  const goodFor: string[] = [];
  const primaryFocus = OBJECTIVE_FOCUS[context.objective.primary];
  const primaryCount = primaryFocus ? focusCount(primaryFocus, evidence) : 0;
  if (primaryFocus && primaryCount > 0) {
    const support = primaryFocus === "investors"
      ? formatSignalList(evidence.investorLandscape.stages, "no explicit stage focus", 2)
      : primaryFocus === "customers"
        ? formatSignalList(evidence.customerLandscape.themes, "limited sector detail", 2)
        : primaryFocus === "strategic_partners"
          ? formatSignalList(evidence.partnerLandscape.themes, "limited sector detail", 2)
          : `${primaryCount} relevant category profiles`;
    goodFor.push(`${categoryOpportunityLabel(context.objective.primary)} is supported by ${primaryCount} ${FOCUS_LABELS[primaryFocus]} profiles; the clearest supplied signals are ${support}.`);
  }

  const secondaryOptions: Array<{ focus: MeetingFocus; count: number; sentence: string }> = [
    {
      focus: "customers",
      count: evidence.categoryCounts.customer,
      sentence: `${evidence.categoryCounts.customer} potential customer profiles create room for targeted commercial discovery${evidence.customerLandscape.themes.length ? ` around ${formatSignalList(evidence.customerLandscape.themes, "", 2)}` : ""}.`,
    },
    {
      focus: "strategic_partners",
      count: evidence.categoryCounts.partner,
      sentence: `${evidence.categoryCounts.partner} potential strategic partner profiles could support introductions, distribution, or implementation conversations where their supplied roles fit.`,
    },
    {
      focus: "experts",
      count: evidence.categoryCounts.advisor_expert,
      sentence: `${evidence.categoryCounts.advisor_expert} advisor or expert profiles can be used for focused market, technical, or ecosystem learning.`,
    },
  ];
  secondaryOptions
    .filter((item) => item.count > 0 && item.focus !== primaryFocus)
    .sort((left, right) => right.count - left.count)
    .slice(0, 3 - goodFor.length)
    .forEach((item) => goodFor.push(item.sentence));

  if (!goodFor.length) {
    goodFor.push("The roster mainly supports selective relationship-building because too few profiles have a clear role and category fit for the stated objective.");
  }
  return goodFor.slice(0, 3);
}

function buildWeakerFor(context: AnalysisContext, evidence: EventEvidence) {
  const weakerFor: string[] = [];
  const primaryFocus = OBJECTIVE_FOCUS[context.objective.primary];
  if (primaryFocus && focusCount(primaryFocus, evidence) === 0) {
    weakerFor.push(`${categoryOpportunityLabel(context.objective.primary)} is weakly supported: no attendees are classified as ${FOCUS_LABELS[primaryFocus]} in the supplied roster.`);
  }
  if (!evidence.explicitSignals.stages.length && context.company.stage.trim()) {
    weakerFor.push(`Stage fit is hard to judge because attendee profiles do not state stage focus, while ${context.company.name || "the company"} is at ${context.company.stage}.`);
  }
  if (!evidence.explicitSignals.geographies.length && context.company.geography.trim()) {
    weakerFor.push(`Geographic fit is unclear because the attendee records rarely state location or market coverage relevant to ${context.company.geography}.`);
  }
  if (evidence.categoryCounts.customer === 0 && context.objective.primary !== "customers") {
    weakerFor.push("Direct customer acquisition looks weak because no profiles are classified as potential customers.");
  }
  if (evidence.categoryCounts.partner === 0 && context.objective.primary !== "partnerships") {
    weakerFor.push("Strategic partnership building looks weak because no profiles are classified as potential partners.");
  }
  if (!weakerFor.length) {
    weakerFor.push("The main weakness is evidence quality: category presence does not prove stage, geography, authority, or willingness to engage, so the individual profiles still need careful qualification.");
  }
  return weakerFor.slice(0, 3);
}

export function buildLocalEventAnalysis(context: AnalysisContext): EventAnalysis {
  const evidence = buildEventEvidence(context);
  const dominantProfiles = dominantProfileText(evidence);
  const goodFor = buildGoodFor(context, evidence);
  const weakerFor = buildWeakerFor(context, evidence);
  const meetingMix = allocateMeetingMix(context, evidence);
  const strongest = strongestSupportedFocus(context, meetingMix);
  const completenessShare = evidence.attendeeCount
    ? evidence.completeness.completeProfiles / evidence.attendeeCount
    : 0;
  const qualityLevel: EventAnalysis["dataQuality"]["level"] = completenessShare >= 0.7
    ? "strong"
    : completenessShare >= 0.4
      ? "mixed"
      : "limited";
  const primaryFocus = OBJECTIVE_FOCUS[context.objective.primary];
  const primarySupported = Boolean(primaryFocus && focusCount(primaryFocus, evidence) > 0);
  const overview = `This is a room led by ${dominantProfiles}. For ${context.company.name || "this founder"}, the strongest supported use is ${FOCUS_LABELS[strongest.focus]}; ${primarySupported ? "the stated primary objective has some roster support" : "the stated primary objective is not strongly represented"}.`;
  const investorStageGap = evidence.investorLandscape.count
    - evidence.investorLandscape.stages.reduce((highest, item) => Math.max(highest, item.count), 0);
  const investorLandscape = evidence.investorLandscape.count
    ? `${evidence.investorLandscape.count} investor profiles are present. Explicit investor types: ${formatSignalList(evidence.investorLandscape.explicitTypes, "not stated")}; supplied titles include ${formatSignalList(evidence.investorLandscape.topRoles, "no consistent role titles")}. ${investorStageGap > 0 ? "Stage focus is missing from part of the investor set." : "Stage signals are available across the investor set."}`
    : "No attendees are classified as investors, so the roster does not support a fundraising strategy.";
  const stageRelevance = evidence.explicitSignals.stages.length
    ? `Explicit stage signals across the room are ${formatSignalList(evidence.explicitSignals.stages, "none")}. Compare these carefully with ${context.company.stage || "the founder's stated stage"}; missing stage data is unknown, not a mismatch.`
    : `The roster does not provide reliable stage signals, so fit with ${context.company.stage || "the founder's stage"} cannot be assessed confidently.`;
  const customerLandscape = evidence.customerLandscape.count
    ? `${evidence.customerLandscape.count} potential customer profiles are present; supplied roles include ${formatSignalList(evidence.customerLandscape.topRoles, "no clear titles")}, with themes around ${formatSignalList(evidence.customerLandscape.themes, "no repeated sector signals")}.`
    : "No profiles are classified as potential customers, so direct acquisition is not well supported by this list.";
  const partnerLandscape = evidence.partnerLandscape.count
    ? `${evidence.partnerLandscape.count} potential strategic partner profiles are present; supplied roles include ${formatSignalList(evidence.partnerLandscape.topRoles, "no clear titles")}, with themes around ${formatSignalList(evidence.partnerLandscape.themes, "no repeated sector signals")}.`
    : "No profiles are classified as potential strategic partners, so partnership potential is not established by the roster.";
  const gaps = [
    !primarySupported && `few or no profiles directly support ${categoryOpportunityLabel(context.objective.primary)}`,
    !evidence.explicitSignals.stages.length && "stage focus is largely missing",
    !evidence.explicitSignals.geographies.length && "geography is largely missing",
    completenessShare < 0.5 && "many profiles lack role, company, or useful context",
  ].filter(Boolean) as string[];

  return {
    overview,
    roomProfile: {
      dominantProfiles,
      investorLandscape,
      stageRelevance,
      sectorsAndThemes: evidence.explicitSignals.themes.length
        ? `The most repeated explicit themes are ${formatSignalList(evidence.explicitSignals.themes, "none", 6)}.`
        : "No repeated sector or domain themes can be established from the supplied attendee fields.",
      customerLandscape,
      partnerLandscape,
      seniorityMix: `${evidence.seniority.seniorTitle} profiles have senior-title signals; ${evidence.seniority.managerOrSpecialist} have manager, principal, lead, or associate titles; ${evidence.seniority.otherOrUnknown} have other or missing titles. Titles do not prove decision authority.`,
      geographies: evidence.explicitSignals.geographies.length
        ? `Explicit geography signals are ${formatSignalList(evidence.explicitSignals.geographies, "none", 6)}; profiles without a geography remain unknown.`
        : "The attendee records do not contain enough explicit geography to describe the room reliably.",
      meaningfulGaps: gaps.length
        ? `Meaningful gaps: ${gaps.join("; ")}.`
        : "No single structural gap dominates, but individual stage, geography, authority, and timing still require validation.",
    },
    goodFor,
    weakerFor,
    strategy: {
      summary: `Allocate the largest share of meeting time to ${FOCUS_LABELS[strongest.focus]} because that is the strongest supported overlap between the roster and the founder brief. Keep the remaining time concentrated in the other evidenced categories rather than spreading it evenly.`,
      meetingMix,
      prioritize: `Prioritize ${FOCUS_LABELS[strongest.focus]} with explicit role, sector, timing, and geography evidence tied to ${categoryOpportunityLabel(context.objective.primary)}.`,
      doNotOverPrioritize: evidence.seniority.seniorTitle > 0
        ? "Do not over-prioritize senior titles when stage, geography, sector fit, or a plausible reason to engage is missing."
        : "Do not over-prioritize sparse profiles whose category is plausible but whose stage, geography, sector fit, or current usefulness is unknown.",
    },
    dataQuality: {
      level: qualityLevel,
      note: `${evidence.completeness.completeProfiles} of ${evidence.attendeeCount} profiles include a role, company, and useful context. Conclusions are limited to explicit fields and normalized categories.`,
    },
  };
}
