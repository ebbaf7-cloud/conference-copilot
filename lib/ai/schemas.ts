import { z } from "zod";

const confidenceSchema = z.enum(["high", "medium", "low"]);
const tierSchema = z.enum(["must_meet", "worth_meeting", "wildcard"]);
const scoreSchema = z.object({
  objectiveFit: z.number().min(0).max(5),
  companyFit: z.number().min(0).max(5),
  immediateUtility: z.number().min(0).max(5),
  realisticUsefulness: z.number().min(0).max(5),
  reciprocalValue: z.number().min(0).max(5),
  actionability: z.number().min(0).max(5),
});

export const rankingOutputSchema = z.object({
  recommendations: z.array(z.object({
    attendeeId: z.string(),
    tier: tierSchema,
    whyThem: z.string().min(1),
    whyYou: z.string().min(1),
    suggestedAngle: z.string().min(1),
    confidence: confidenceSchema,
    missingInformation: z.array(z.string()),
    scores: scoreSchema,
  })).max(15),
});

export const challengeOutputSchema = z.object({
  possiblyOverrated: z.array(z.object({ attendeeId: z.string(), reason: z.string().min(1) })).max(3),
  peopleMissed: z.array(z.object({
    attendeeId: z.string(),
    reason: z.string().min(1),
    suggestedTier: tierSchema,
  })).max(3),
  wildcard: z.object({
    attendeeId: z.string(),
    reason: z.string().min(1),
    potentialUnlock: z.string().min(1),
  }).nullable(),
});

export const outreachOutputSchema = z.object({
  attendeeId: z.string(),
  personalization: z.enum(["strong", "limited"]),
  message: z.string().min(1),
  missingInformation: z.array(z.string()),
});

const meetingPrepFieldsSchema = z.object({
  attendeeId: z.string(),
  whyThisMeeting: z.string().min(1).max(500),
  leadWith: z.string().min(1).max(500),
  askThis: z.string().min(1).max(500),
  listenFor: z.string().min(1).max(500),
  dontWasteTimeOn: z.string().min(1).max(500),
  desiredNextStep: z.string().min(1).max(500),
});

export const meetingPrepOutputSchema = meetingPrepFieldsSchema.superRefine((brief, context) => {
  const words = [
    brief.whyThisMeeting,
    brief.leadWith,
    brief.askThis,
    brief.listenFor,
    brief.dontWasteTimeOn,
    brief.desiredNextStep,
  ].join(" ").trim().split(/\s+/).filter(Boolean).length;
  if (words > 150) context.addIssue({ code: z.ZodIssueCode.custom, message: "Meeting prep must be no more than 150 words." });
});

const meetingFocusSchema = z.enum([
  "investors",
  "customers",
  "strategic_partners",
  "experts",
  "talent",
  "relationship_building",
]);

const eventAnalysisFieldsSchema = z.object({
  overview: z.string().min(1).max(1_500),
  roomProfile: z.object({
    dominantProfiles: z.string().min(1).max(600),
    investorLandscape: z.string().min(1).max(600),
    stageRelevance: z.string().min(1).max(600),
    sectorsAndThemes: z.string().min(1).max(600),
    customerLandscape: z.string().min(1).max(600),
    partnerLandscape: z.string().min(1).max(600),
    seniorityMix: z.string().min(1).max(600),
    geographies: z.string().min(1).max(600),
    meaningfulGaps: z.string().min(1).max(600),
  }),
  goodFor: z.array(z.string().min(1).max(600)).min(1).max(3),
  weakerFor: z.array(z.string().min(1).max(600)).min(1).max(3),
  strategy: z.object({
    summary: z.string().min(1).max(1_000),
    meetingMix: z.array(z.object({
      focus: meetingFocusSchema,
      percentage: z.number().int().min(1).max(100),
      rationale: z.string().min(1).max(600),
    })).min(1).max(6),
    prioritize: z.string().min(1).max(800),
    doNotOverPrioritize: z.string().min(1).max(800),
  }),
  dataQuality: z.object({
    level: z.enum(["strong", "mixed", "limited"]),
    note: z.string().min(1).max(600),
  }),
});

export const eventAnalysisOutputSchema = eventAnalysisFieldsSchema.superRefine((analysis, context) => {
  const total = analysis.strategy.meetingMix.reduce((sum, item) => sum + item.percentage, 0);
  if (total !== 100) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["strategy", "meetingMix"],
      message: "Meeting mix percentages must total 100.",
    });
  }
  const focuses = analysis.strategy.meetingMix.map((item) => item.focus);
  if (new Set(focuses).size !== focuses.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["strategy", "meetingMix"],
      message: "Meeting mix focuses must be unique.",
    });
  }
});

const stringArray = { type: "array", items: { type: "string" } } as const;
const scoresJson = {
  type: "object",
  additionalProperties: false,
  properties: {
    objectiveFit: { type: "number", minimum: 0, maximum: 5 },
    companyFit: { type: "number", minimum: 0, maximum: 5 },
    immediateUtility: { type: "number", minimum: 0, maximum: 5 },
    realisticUsefulness: { type: "number", minimum: 0, maximum: 5 },
    reciprocalValue: { type: "number", minimum: 0, maximum: 5 },
    actionability: { type: "number", minimum: 0, maximum: 5 },
  },
  required: ["objectiveFit", "companyFit", "immediateUtility", "realisticUsefulness", "reciprocalValue", "actionability"],
} as const;

export const rankingJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    recommendations: {
      type: "array",
      maxItems: 15,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          attendeeId: { type: "string" },
          tier: { type: "string", enum: ["must_meet", "worth_meeting", "wildcard"] },
          whyThem: { type: "string" },
          whyYou: { type: "string" },
          suggestedAngle: { type: "string" },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
          missingInformation: stringArray,
          scores: scoresJson,
        },
        required: ["attendeeId", "tier", "whyThem", "whyYou", "suggestedAngle", "confidence", "missingInformation", "scores"],
      },
    },
  },
  required: ["recommendations"],
} as const;

export const challengeJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    possiblyOverrated: {
      type: "array", maxItems: 3,
      items: { type: "object", additionalProperties: false, properties: { attendeeId: { type: "string" }, reason: { type: "string" } }, required: ["attendeeId", "reason"] },
    },
    peopleMissed: {
      type: "array", maxItems: 3,
      items: { type: "object", additionalProperties: false, properties: { attendeeId: { type: "string" }, reason: { type: "string" }, suggestedTier: { type: "string", enum: ["must_meet", "worth_meeting", "wildcard"] } }, required: ["attendeeId", "reason", "suggestedTier"] },
    },
    wildcard: {
      anyOf: [
        { type: "null" },
        { type: "object", additionalProperties: false, properties: { attendeeId: { type: "string" }, reason: { type: "string" }, potentialUnlock: { type: "string" } }, required: ["attendeeId", "reason", "potentialUnlock"] },
      ],
    },
  },
  required: ["possiblyOverrated", "peopleMissed", "wildcard"],
} as const;

export const outreachJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    attendeeId: { type: "string" },
    personalization: { type: "string", enum: ["strong", "limited"] },
    message: { type: "string" },
    missingInformation: stringArray,
  },
  required: ["attendeeId", "personalization", "message", "missingInformation"],
} as const;

export const meetingPrepJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    attendeeId: { type: "string" },
    whyThisMeeting: { type: "string" },
    leadWith: { type: "string" },
    askThis: { type: "string" },
    listenFor: { type: "string" },
    dontWasteTimeOn: { type: "string" },
    desiredNextStep: { type: "string" },
  },
  required: ["attendeeId", "whyThisMeeting", "leadWith", "askThis", "listenFor", "dontWasteTimeOn", "desiredNextStep"],
} as const;

export const eventAnalysisJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    overview: { type: "string" },
    roomProfile: {
      type: "object",
      additionalProperties: false,
      properties: {
        dominantProfiles: { type: "string" },
        investorLandscape: { type: "string" },
        stageRelevance: { type: "string" },
        sectorsAndThemes: { type: "string" },
        customerLandscape: { type: "string" },
        partnerLandscape: { type: "string" },
        seniorityMix: { type: "string" },
        geographies: { type: "string" },
        meaningfulGaps: { type: "string" },
      },
      required: [
        "dominantProfiles",
        "investorLandscape",
        "stageRelevance",
        "sectorsAndThemes",
        "customerLandscape",
        "partnerLandscape",
        "seniorityMix",
        "geographies",
        "meaningfulGaps",
      ],
    },
    goodFor: { type: "array", minItems: 1, maxItems: 3, items: { type: "string" } },
    weakerFor: { type: "array", minItems: 1, maxItems: 3, items: { type: "string" } },
    strategy: {
      type: "object",
      additionalProperties: false,
      properties: {
        summary: { type: "string" },
        meetingMix: {
          type: "array",
          minItems: 1,
          maxItems: 6,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              focus: {
                type: "string",
                enum: ["investors", "customers", "strategic_partners", "experts", "talent", "relationship_building"],
              },
              percentage: { type: "integer", minimum: 1, maximum: 100 },
              rationale: { type: "string" },
            },
            required: ["focus", "percentage", "rationale"],
          },
        },
        prioritize: { type: "string" },
        doNotOverPrioritize: { type: "string" },
      },
      required: ["summary", "meetingMix", "prioritize", "doNotOverPrioritize"],
    },
    dataQuality: {
      type: "object",
      additionalProperties: false,
      properties: {
        level: { type: "string", enum: ["strong", "mixed", "limited"] },
        note: { type: "string" },
      },
      required: ["level", "note"],
    },
  },
  required: ["overview", "roomProfile", "goodFor", "weakerFor", "strategy", "dataQuality"],
} as const;

const hybridEvidenceSchema = z.object({
  role: z.string().max(500).nullable(),
  company: z.string().max(500).nullable(),
  sectorDomainRelevance: z.array(z.string().min(1).max(500)).max(3),
  stageRelevance: z.array(z.string().min(1).max(500)).max(3),
  geographyRelevance: z.array(z.string().min(1).max(500)).max(3),
  objectiveFit: z.array(z.string().min(1).max(500)).max(3),
  possibleMutualRelevance: z.array(z.string().min(1).max(500)).max(3),
  missingInformation: z.array(z.string().min(1).max(500)).max(10),
});

const hybridScoreSchema = z.object({
  goalFit: z.number().min(0).max(5),
  companySectorFit: z.number().min(0).max(5),
  timingStageFit: z.number().min(0).max(5),
  mutualRelevance: z.number().min(0).max(5),
  actionability: z.number().min(0).max(5),
  informationQuality: z.number().min(0).max(5),
});

const hybridRiskFlagSchema = z.object({
  type: z.enum(["wrong_stage", "wrong_geography", "role_mismatch", "explicitly_deprioritized", "weak_evidence"]),
  basis: z.string().min(1).max(500),
});

const hybridRecommendationSchema = z.object({
  attendeeId: z.string(),
  tier: tierSchema,
  whyThem: z.string().min(1).max(4_000),
  whyYou: z.string().min(1).max(4_000),
  suggestedAngle: z.string().min(1).max(4_000),
  confidence: confidenceSchema,
});

export const hybridRankingOutputSchema = z.object({
  eventAnalysis: eventAnalysisOutputSchema,
  candidateAssessments: z.array(z.object({
    attendeeId: z.string(),
    evidence: hybridEvidenceSchema,
    scores: hybridScoreSchema,
    riskFlags: z.array(hybridRiskFlagSchema).max(5),
  })).min(1).max(30),
  draftRecommendations: z.array(hybridRecommendationSchema).max(15),
});

export const hybridChallengeOutputSchema = z.object({
  possiblyOverrated: z.array(z.object({ attendeeId: z.string(), reason: z.string().min(1).max(1_000) })).max(3),
  strongerFitsMissed: z.array(z.object({
    attendeeId: z.string(),
    reason: z.string().min(1).max(1_000),
    suggestedTier: tierSchema,
  })).max(3),
  weakMustMeets: z.array(z.object({ attendeeId: z.string(), reason: z.string().min(1).max(1_000) })).max(3),
  wildcard: z.object({
    attendeeId: z.string(),
    reason: z.string().min(1).max(1_000),
    potentialUnlock: z.string().min(1).max(1_000),
  }).nullable(),
  finalRecommendations: z.array(hybridRecommendationSchema).max(15),
});

export type HybridRankingOutput = z.infer<typeof hybridRankingOutputSchema>;
export type HybridChallengeOutput = z.infer<typeof hybridChallengeOutputSchema>;

const nullableHybridStringJson = {
  anyOf: [{ type: "string" }, { type: "null" }],
} as const;

const shortEvidenceArrayJson = {
  type: "array",
  maxItems: 3,
  items: { type: "string" },
} as const;

const missingInformationJson = {
  type: "array",
  maxItems: 10,
  items: { type: "string" },
} as const;

const hybridScoreJson = {
  type: "object",
  additionalProperties: false,
  properties: {
    goalFit: { type: "number", minimum: 0, maximum: 5 },
    companySectorFit: { type: "number", minimum: 0, maximum: 5 },
    timingStageFit: { type: "number", minimum: 0, maximum: 5 },
    mutualRelevance: { type: "number", minimum: 0, maximum: 5 },
    actionability: { type: "number", minimum: 0, maximum: 5 },
    informationQuality: { type: "number", minimum: 0, maximum: 5 },
  },
  required: ["goalFit", "companySectorFit", "timingStageFit", "mutualRelevance", "actionability", "informationQuality"],
} as const;

const hybridRecommendationJson = {
  type: "object",
  additionalProperties: false,
  properties: {
    attendeeId: { type: "string" },
    tier: { type: "string", enum: ["must_meet", "worth_meeting", "wildcard"] },
    whyThem: { type: "string" },
    whyYou: { type: "string" },
    suggestedAngle: { type: "string" },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
  },
  required: ["attendeeId", "tier", "whyThem", "whyYou", "suggestedAngle", "confidence"],
} as const;

export const hybridRankingJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    eventAnalysis: eventAnalysisJsonSchema,
    candidateAssessments: {
      type: "array",
      minItems: 1,
      maxItems: 30,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          attendeeId: { type: "string" },
          evidence: {
            type: "object",
            additionalProperties: false,
            properties: {
              role: nullableHybridStringJson,
              company: nullableHybridStringJson,
              sectorDomainRelevance: shortEvidenceArrayJson,
              stageRelevance: shortEvidenceArrayJson,
              geographyRelevance: shortEvidenceArrayJson,
              objectiveFit: shortEvidenceArrayJson,
              possibleMutualRelevance: shortEvidenceArrayJson,
              missingInformation: missingInformationJson,
            },
            required: ["role", "company", "sectorDomainRelevance", "stageRelevance", "geographyRelevance", "objectiveFit", "possibleMutualRelevance", "missingInformation"],
          },
          scores: hybridScoreJson,
          riskFlags: {
            type: "array",
            maxItems: 5,
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                type: { type: "string", enum: ["wrong_stage", "wrong_geography", "role_mismatch", "explicitly_deprioritized", "weak_evidence"] },
                basis: { type: "string" },
              },
              required: ["type", "basis"],
            },
          },
        },
        required: ["attendeeId", "evidence", "scores", "riskFlags"],
      },
    },
    draftRecommendations: { type: "array", maxItems: 15, items: hybridRecommendationJson },
  },
  required: ["eventAnalysis", "candidateAssessments", "draftRecommendations"],
} as const;

export const hybridChallengeJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    possiblyOverrated: {
      type: "array",
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        properties: { attendeeId: { type: "string" }, reason: { type: "string" } },
        required: ["attendeeId", "reason"],
      },
    },
    strongerFitsMissed: {
      type: "array",
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          attendeeId: { type: "string" },
          reason: { type: "string" },
          suggestedTier: { type: "string", enum: ["must_meet", "worth_meeting", "wildcard"] },
        },
        required: ["attendeeId", "reason", "suggestedTier"],
      },
    },
    weakMustMeets: {
      type: "array",
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        properties: { attendeeId: { type: "string" }, reason: { type: "string" } },
        required: ["attendeeId", "reason"],
      },
    },
    wildcard: {
      anyOf: [
        { type: "null" },
        {
          type: "object",
          additionalProperties: false,
          properties: {
            attendeeId: { type: "string" },
            reason: { type: "string" },
            potentialUnlock: { type: "string" },
          },
          required: ["attendeeId", "reason", "potentialUnlock"],
        },
      ],
    },
    finalRecommendations: { type: "array", maxItems: 15, items: hybridRecommendationJson },
  },
  required: ["possiblyOverrated", "strongerFitsMissed", "weakMustMeets", "wildcard", "finalRecommendations"],
} as const;
