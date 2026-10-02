import { buildLocalShortlist } from "@/lib/ai/fallback";
import { buildEventEvidence } from "@/lib/ai/event-analysis";
import { requestStructured, type StructuredRequester } from "@/lib/ai/openai";
import { conciseRecommendationCopy } from "@/lib/ai/recommendation-copy";
import {
  FINAL_CHALLENGE_INSTRUCTIONS,
  RANKING_INSTRUCTIONS,
  promptForFinalChallenge,
  promptForRanking,
} from "@/lib/ai/prompts";
import {
  hybridChallengeJsonSchema,
  hybridChallengeOutputSchema,
  hybridRankingJsonSchema,
  hybridRankingOutputSchema,
  type HybridChallengeOutput,
  type HybridRankingOutput,
} from "@/lib/ai/schemas";
import type {
  AnalysisContext,
  Attendee,
  RankingResult,
  Recommendation,
  RecommendationTier,
} from "@/lib/conference/types";

export const HYBRID_SHORTLIST_LIMIT = 30;

const TIER_THRESHOLDS = {
  must_meet: 75,
  worth_meeting: 55,
  wildcard: 45,
} as const;

const TIER_CAPS = {
  must_meet: 5,
  worth_meeting: 5,
  wildcard: 3,
} as const;

const RISK_PENALTIES = {
  explicitly_deprioritized: -35,
  wrong_stage: -25,
  wrong_geography: -20,
  role_mismatch: -15,
  weak_evidence: -25,
} as const;

type CandidateAssessment = HybridRankingOutput["candidateAssessments"][number];
type ModelRecommendation = HybridRankingOutput["draftRecommendations"][number];

export type HybridRankingTrace = {
  eventAnalysis: HybridRankingOutput["eventAnalysis"];
  ruleBasedShortlist: Array<{
    attendeeId: string;
    name: string;
    localRank: number;
    localScore: number;
    localPenalties: string[];
  }>;
  candidateAssessments: HybridRankingOutput["candidateAssessments"];
  aiRerankedRecommendations: Recommendation[];
  challenge: Omit<HybridChallengeOutput, "finalRecommendations">;
  finalRecommendations: Recommendation[];
};

export type HybridRankingResult = {
  result: RankingResult;
  trace: HybridRankingTrace;
};

function assertUniqueIds(ids: string[], label: string) {
  if (new Set(ids).size !== ids.length) throw new Error(`${label} contained duplicate attendee IDs.`);
}

function compactCandidate(attendee: Attendee) {
  return {
    id: attendee.id,
    name: attendee.name,
    company: attendee.company,
    role: attendee.role,
    description: attendee.description,
    category: attendee.category,
    other: attendee.other
      .filter((item) => !/\b(url|uri|link)\b/i.test(item.label))
      .slice(0, 12)
      .map((item) => ({ label: item.label, value: item.value.slice(0, 1_000) })),
    warnings: attendee.warnings.slice(0, 10),
  };
}

function hasUsefulProfileContext(attendee: Attendee) {
  return Boolean(attendee.description?.trim()) || attendee.other.some((item) => (
    !/\b(url|uri|link)\b/i.test(item.label)
    && !/^https?:\/\//i.test(item.value.trim())
    && Boolean(item.value.trim())
  ));
}

function sourceInformationQuality(attendee: Attendee) {
  const hasRole = Boolean(attendee.role?.trim());
  const hasCompany = Boolean(attendee.company?.trim());
  const hasContext = hasUsefulProfileContext(attendee);

  if (hasRole && hasCompany && hasContext) return 5;
  if (hasRole && hasCompany) return 3.5;
  if ((hasRole || hasCompany) && hasContext) return 3;
  if (hasRole || hasCompany) return 2;
  if (hasContext) return 1.5;
  return 0.5;
}

function applySourceEvidenceGuards(
  assessments: HybridRankingOutput["candidateAssessments"],
  shortlistedAttendees: Attendee[],
) {
  const attendeeById = new Map(shortlistedAttendees.map((attendee) => [attendee.id, attendee]));

  return assessments.map((assessment): CandidateAssessment => {
    const attendee = attendeeById.get(assessment.attendeeId);
    if (!attendee) throw new Error("Candidate evidence referenced an attendee outside the shortlist.");

    const sourceQuality = sourceInformationQuality(attendee);
    const missingInformation: string[] = [];
    const addMissing = (label: string, pattern: RegExp) => {
      if (!missingInformation.some((item) => pattern.test(item))) missingInformation.push(label);
    };
    if (!attendee.role?.trim()) addMissing("role", /\brole\b/i);
    if (!attendee.company?.trim()) addMissing("company", /\bcompany\b/i);
    if (sourceQuality <= 0.5) addMissing("useful profile context", /\b(context|description|profile)\b/i);
    assessment.evidence.missingInformation.forEach((item) => {
      if (!missingInformation.includes(item)) missingInformation.push(item);
    });

    const riskFlags = [...assessment.riskFlags];
    if (sourceQuality <= 2 && !riskFlags.some((flag) => flag.type === "weak_evidence")) {
      riskFlags.push({
        type: "weak_evidence",
        basis: "The supplied record lacks enough role, company, or profile context for a confident recommendation.",
      });
    }

    const noProfileEvidence = sourceQuality <= 0.5;
    const identityOnlyEvidence = !hasUsefulProfileContext(attendee) && sourceQuality <= 2;
    const relevanceScoreCap = noProfileEvidence ? 1 : identityOnlyEvidence ? 2.5 : 5;
    return {
      ...assessment,
      evidence: {
        ...assessment.evidence,
        missingInformation: missingInformation.slice(0, 10),
      },
      scores: {
        goalFit: Math.min(assessment.scores.goalFit, relevanceScoreCap),
        companySectorFit: Math.min(assessment.scores.companySectorFit, relevanceScoreCap),
        timingStageFit: Math.min(assessment.scores.timingStageFit, relevanceScoreCap),
        mutualRelevance: Math.min(assessment.scores.mutualRelevance, relevanceScoreCap),
        actionability: Math.min(assessment.scores.actionability, relevanceScoreCap),
        informationQuality: Math.min(assessment.scores.informationQuality, sourceQuality),
      },
      riskFlags,
    };
  });
}

function validateAssessments(
  assessments: HybridRankingOutput["candidateAssessments"],
  shortlistedAttendees: Attendee[],
) {
  const expectedIds = shortlistedAttendees.map((attendee) => attendee.id);
  const actualIds = assessments.map((assessment) => assessment.attendeeId);
  assertUniqueIds(actualIds, "Candidate evidence");
  if (actualIds.length !== expectedIds.length || expectedIds.some((id) => !actualIds.includes(id))) {
    throw new Error("Candidate evidence did not cover the complete rule-based shortlist.");
  }

  const attendeeById = new Map(shortlistedAttendees.map((attendee) => [attendee.id, attendee]));
  assessments.forEach((assessment) => {
    const attendee = attendeeById.get(assessment.attendeeId);
    if (!attendee) throw new Error("Candidate evidence referenced an attendee outside the shortlist.");
    if (assessment.evidence.role !== attendee.role || assessment.evidence.company !== attendee.company) {
      throw new Error("Candidate evidence changed a supplied role or company.");
    }
    assertUniqueIds(assessment.riskFlags.map((flag) => flag.type), "Candidate risk flags");
  });
}

function validateRecommendationIds(
  recommendations: Array<{ attendeeId: string }>,
  allowedIds: Set<string>,
  label: string,
) {
  const ids = recommendations.map((recommendation) => recommendation.attendeeId);
  assertUniqueIds(ids, label);
  if (ids.some((id) => !allowedIds.has(id))) throw new Error(`${label} referenced an attendee outside the shortlist.`);
}

export function weightedAssessmentScore(assessment: CandidateAssessment) {
  const { scores } = assessment;
  const baseScore = (
    scores.goalFit * 0.30
    + scores.companySectorFit * 0.25
    + scores.timingStageFit * 0.15
    + scores.mutualRelevance * 0.15
    + scores.actionability * 0.10
    + scores.informationQuality * 0.05
  ) * 20;
  const penalty = assessment.riskFlags.reduce((total, flag) => total + RISK_PENALTIES[flag.type], 0);
  return Math.max(0, Math.min(100, Math.round((baseScore + penalty) * 10) / 10));
}

function mappedScores(assessment: CandidateAssessment): NonNullable<Recommendation["scores"]> {
  return {
    objectiveFit: assessment.scores.goalFit,
    companyFit: assessment.scores.companySectorFit,
    immediateUtility: assessment.scores.timingStageFit,
    realisticUsefulness: assessment.scores.informationQuality,
    reciprocalValue: assessment.scores.mutualRelevance,
    actionability: assessment.scores.actionability,
  };
}

function normalizedConfidence(
  recommendation: ModelRecommendation,
  assessment: CandidateAssessment,
): Recommendation["confidence"] {
  const weakEvidence = assessment.riskFlags.some((flag) => flag.type === "weak_evidence");
  if (assessment.scores.informationQuality <= 1.5) return "low";
  if (weakEvidence && recommendation.confidence === "high") return "medium";
  return recommendation.confidence;
}

function normalizeRecommendations(
  recommendations: ModelRecommendation[],
  assessmentById: Map<string, CandidateAssessment>,
  localRankById: Map<string, number>,
) {
  const normalized = recommendations.flatMap((recommendation) => {
    const assessment = assessmentById.get(recommendation.attendeeId);
    if (!assessment) throw new Error("A model recommendation had no candidate evidence.");
    const weightedScore = weightedAssessmentScore(assessment);
    const riskTypes = new Set(assessment.riskFlags.map((flag) => flag.type));
    const hardMismatch = riskTypes.has("wrong_stage")
      || riskTypes.has("wrong_geography")
      || riskTypes.has("role_mismatch")
      || riskTypes.has("explicitly_deprioritized");
    const confidence = normalizedConfidence(recommendation, assessment);
    let tier: RecommendationTier = recommendation.tier;

    if (tier === "must_meet" && (
      weightedScore < TIER_THRESHOLDS.must_meet
      || hardMismatch
      || riskTypes.has("weak_evidence")
      || confidence === "low"
      || assessment.scores.goalFit < 4
      || assessment.scores.timingStageFit < 3
      || assessment.scores.informationQuality < 3
    )) {
      tier = "worth_meeting";
    }

    if (weightedScore < TIER_THRESHOLDS[tier]) return [];

    return [{
      attendeeId: recommendation.attendeeId,
      tier,
      whyThem: recommendation.whyThem,
      whyYou: recommendation.whyYou,
      suggestedAngle: recommendation.suggestedAngle,
      confidence,
      missingInformation: assessment.evidence.missingInformation,
      scores: mappedScores(assessment),
      weightedScore,
      localRank: localRankById.get(recommendation.attendeeId) ?? Number.MAX_SAFE_INTEGER,
    }];
  });

  const byTier = (tier: RecommendationTier) => normalized
    .filter((recommendation) => recommendation.tier === tier)
    .sort((left, right) => right.weightedScore - left.weightedScore || left.localRank - right.localRank)
    .slice(0, TIER_CAPS[tier])
    .map((recommendation): Recommendation => conciseRecommendationCopy({
      attendeeId: recommendation.attendeeId,
      tier: recommendation.tier,
      whyThem: recommendation.whyThem,
      whyYou: recommendation.whyYou,
      suggestedAngle: recommendation.suggestedAngle,
      confidence: recommendation.confidence,
      missingInformation: recommendation.missingInformation,
      scores: recommendation.scores,
    }));

  return [
    ...byTier("must_meet"),
    ...byTier("worth_meeting"),
    ...byTier("wildcard"),
  ] satisfies Recommendation[];
}

function validateChallenge(
  challenge: HybridChallengeOutput,
  allowedIds: Set<string>,
  draftRecommendations: Recommendation[],
) {
  const draftIds = new Set(draftRecommendations.map((recommendation) => recommendation.attendeeId));
  const mustMeetIds = new Set(draftRecommendations
    .filter((recommendation) => recommendation.tier === "must_meet")
    .map((recommendation) => recommendation.attendeeId));

  validateRecommendationIds(challenge.finalRecommendations, allowedIds, "Final recommendations");
  validateRecommendationIds(challenge.possiblyOverrated, draftIds, "Possibly overrated audit");
  validateRecommendationIds(challenge.weakMustMeets, mustMeetIds, "Weak Must Meet audit");

  const missedIds = challenge.strongerFitsMissed.map((item) => item.attendeeId);
  assertUniqueIds(missedIds, "Stronger-fit audit");
  if (missedIds.some((id) => !allowedIds.has(id) || draftIds.has(id))) {
    throw new Error("Stronger-fit audit did not reference an omitted shortlisted candidate.");
  }

  if (challenge.wildcard && !allowedIds.has(challenge.wildcard.attendeeId)) {
    throw new Error("Wildcard audit referenced an attendee outside the shortlist.");
  }

  const finalTierById = new Map(challenge.finalRecommendations
    .map((recommendation) => [recommendation.attendeeId, recommendation.tier]));
  if (challenge.weakMustMeets.some((item) => finalTierById.get(item.attendeeId) === "must_meet")) {
    throw new Error("The challenge pass left a weak-assumption candidate in Must Meet.");
  }

  const justifiedAdditions = new Set([
    ...missedIds,
    ...(challenge.wildcard ? [challenge.wildcard.attendeeId] : []),
  ]);
  const unexplainedAddition = challenge.finalRecommendations
    .some((recommendation) => !draftIds.has(recommendation.attendeeId) && !justifiedAdditions.has(recommendation.attendeeId));
  if (unexplainedAddition) throw new Error("The challenge pass added a candidate without identifying the change.");
}

export function buildRuleBasedShortlist(context: AnalysisContext) {
  assertUniqueIds(context.attendees.map((attendee) => attendee.id), "Attendee input");
  return buildLocalShortlist(context, HYBRID_SHORTLIST_LIMIT);
}

export async function buildHybridRanking(
  context: AnalysisContext,
  requester: StructuredRequester = requestStructured,
): Promise<HybridRankingResult> {
  const eventEvidence = buildEventEvidence(context);
  const shortlisted = buildRuleBasedShortlist(context);
  const shortlistedAttendees = shortlisted.map((item) => item.attendee);
  const allowedIds = new Set(shortlistedAttendees.map((attendee) => attendee.id));
  const localRankById = new Map(shortlisted.map((item, index) => [item.attendee.id, index + 1]));
  const candidatesForModel = shortlisted
    .slice()
    .sort((left, right) => left.order - right.order)
    .map((item) => compactCandidate(item.attendee));

  const firstPass = await requester({
    instructions: RANKING_INSTRUCTIONS,
    input: promptForRanking({
      company: context.company,
      objective: context.objective,
      eventEvidence,
      candidates: candidatesForModel,
    }),
    name: "conference_hybrid_ranking",
    jsonSchema: hybridRankingJsonSchema,
    validator: hybridRankingOutputSchema,
    maxOutputTokens: 12_000,
  });

  validateAssessments(firstPass.candidateAssessments, shortlistedAttendees);
  validateRecommendationIds(firstPass.draftRecommendations, allowedIds, "Draft recommendations");
  const candidateAssessments = applySourceEvidenceGuards(firstPass.candidateAssessments, shortlistedAttendees);
  const assessmentById = new Map(candidateAssessments.map((assessment) => [assessment.attendeeId, assessment]));
  const aiRerankedRecommendations = normalizeRecommendations(firstPass.draftRecommendations, assessmentById, localRankById);

  const challengeOutput = await requester({
    instructions: FINAL_CHALLENGE_INSTRUCTIONS,
    input: promptForFinalChallenge({
      company: context.company,
      objective: context.objective,
      eventAnalysis: firstPass.eventAnalysis,
      candidates: candidatesForModel,
      candidateAssessments,
      draftRecommendations: aiRerankedRecommendations,
    }),
    name: "conference_hybrid_ranking_challenge",
    jsonSchema: hybridChallengeJsonSchema,
    validator: hybridChallengeOutputSchema,
    maxOutputTokens: 8_000,
  });

  validateChallenge(challengeOutput, allowedIds, aiRerankedRecommendations);
  const finalRecommendations = normalizeRecommendations(
    challengeOutput.finalRecommendations,
    assessmentById,
    localRankById,
  );

  const challenge = {
    possiblyOverrated: challengeOutput.possiblyOverrated,
    strongerFitsMissed: challengeOutput.strongerFitsMissed,
    weakMustMeets: challengeOutput.weakMustMeets,
    wildcard: challengeOutput.wildcard,
  };
  const result: RankingResult = {
    eventAnalysis: firstPass.eventAnalysis,
    recommendations: finalRecommendations,
    mode: "model",
  };

  return {
    result,
    trace: {
      eventAnalysis: firstPass.eventAnalysis,
      ruleBasedShortlist: shortlisted.map((item, index) => ({
        attendeeId: item.attendee.id,
        name: item.attendee.name,
        localRank: index + 1,
        localScore: item.score,
        localPenalties: item.audit.penalties.map((penalty) => penalty.code),
      })),
      candidateAssessments,
      aiRerankedRecommendations,
      challenge,
      finalRecommendations,
    },
  };
}
