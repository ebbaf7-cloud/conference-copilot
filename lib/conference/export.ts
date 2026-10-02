import type {
  Attendee,
  EventAnalysis,
  MeetingFocus,
  Recommendation,
  RecommendationTier,
} from "@/lib/conference/types";

const tierOrder: RecommendationTier[] = ["must_meet", "worth_meeting", "wildcard"];

const tierLabels: Record<RecommendationTier, string> = {
  must_meet: "Must Meet",
  worth_meeting: "Worth Meeting",
  wildcard: "Wildcards",
};

const focusLabels: Record<MeetingFocus, string> = {
  investors: "Investors",
  customers: "Customers",
  strategic_partners: "Strategic partners",
  experts: "Experts",
  talent: "Talent",
  relationship_building: "Relationship-building",
};

type HitListRow = {
  attendee: Attendee;
  recommendation: Recommendation;
};

function orderedRows(attendees: Attendee[], recommendations: Recommendation[]): HitListRow[] {
  const attendeeMap = new Map(attendees.map((attendee) => [attendee.id, attendee]));
  return tierOrder.flatMap((tier) => recommendations
    .filter((recommendation) => recommendation.tier === tier)
    .flatMap((recommendation) => {
      const attendee = attendeeMap.get(recommendation.attendeeId);
      return attendee ? [{ attendee, recommendation }] : [];
    }));
}

function csvCell(value: string) {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function titleCase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function buildHitListCsv(attendees: Attendee[], recommendations: Recommendation[]) {
  const headers = [
    "Name",
    "Company",
    "Role",
    "Category",
    "Why them",
    "Why you",
    "Best angle",
    "Confidence",
  ];
  const lines = orderedRows(attendees, recommendations).map(({ attendee, recommendation }) => [
    attendee.name,
    attendee.company ?? "",
    attendee.role ?? "",
    tierLabels[recommendation.tier],
    recommendation.whyThem,
    recommendation.whyYou,
    recommendation.suggestedAngle,
    titleCase(recommendation.confidence),
  ].map(csvCell).join(","));

  return [headers.join(","), ...lines].join("\r\n");
}

function buildEventAnalysisText(analysis: EventAnalysis) {
  const goodFor = analysis.goodFor.map((item) => `- ${item}`).join("\n");
  const weakerFor = analysis.weakerFor.map((item) => `- ${item}`).join("\n");
  const meetingMix = analysis.strategy.meetingMix
    .map((item) => `- ${focusLabels[item.focus]}: ${item.percentage}% — ${item.rationale}`)
    .join("\n");

  return [
    `Event overview\n\n${analysis.overview}`,
    `What this event is good for\n\n${goodFor}`,
    `What this event is weaker for\n\n${weakerFor}`,
    [
      "Recommended strategy",
      "",
      analysis.strategy.summary,
      "",
      "Meeting mix",
      meetingMix,
      "",
      `Prioritize: ${analysis.strategy.prioritize}`,
      `Do not over-prioritize: ${analysis.strategy.doNotOverPrioritize}`,
    ].join("\n"),
  ].join("\n\n");
}

export function buildHitListText(
  attendees: Attendee[],
  recommendations: Recommendation[],
  eventAnalysis?: EventAnalysis,
) {
  const rows = orderedRows(attendees, recommendations);
  const sections = tierOrder.flatMap((tier) => {
    const tierRows = rows.filter(({ recommendation }) => recommendation.tier === tier);
    if (!tierRows.length) return [];
    const entries = tierRows.map(({ attendee, recommendation }, index) => {
      const companyAndRole = [attendee.company, attendee.role].filter(Boolean).join(" · ");
      return [
        `${index + 1}. ${attendee.name}${companyAndRole ? ` — ${companyAndRole}` : ""}`,
        `Why them: ${recommendation.whyThem}`,
        `Why you: ${recommendation.whyYou}`,
        `Best angle: ${recommendation.suggestedAngle}`,
        `Confidence: ${titleCase(recommendation.confidence)}`,
      ].join("\n");
    });
    return [`${tierLabels[tier]}\n\n${entries.join("\n\n")}`];
  });

  return [
    "Your hit list",
    eventAnalysis ? buildEventAnalysisText(eventAnalysis) : "",
    sections.join("\n\n"),
  ].filter(Boolean).join("\n\n");
}
