export type CompanyContext = {
  name: string;
  description: string;
  stage: string;
  geography: string;
  fundraising: string;
  commercial: string;
  additional: string;
};

export type ConferenceObjective = {
  primary: string;
  details: string;
  secondary: string;
  valuable: string;
  deprioritize: string;
};

export type AttendeeCategory =
  | "investor"
  | "customer"
  | "partner"
  | "talent"
  | "advisor_expert"
  | "media"
  | "service_provider"
  | "other"
  | "unknown";

export type Attendee = {
  id: string;
  sourceRef: string;
  name: string;
  company: string | null;
  role: string | null;
  description: string | null;
  category: AttendeeCategory;
  other: Array<{ label: string; value: string }>;
  warnings: string[];
};

export type Confidence = "high" | "medium" | "low";
export type RecommendationTier = "must_meet" | "worth_meeting" | "wildcard";

export type Recommendation = {
  attendeeId: string;
  tier: RecommendationTier;
  whyThem: string;
  whyYou: string;
  suggestedAngle: string;
  confidence: Confidence;
  missingInformation: string[];
  scores?: {
    objectiveFit: number;
    companyFit: number;
    immediateUtility: number;
    realisticUsefulness: number;
    reciprocalValue: number;
    actionability: number;
  };
};

export type RankingResult = {
  eventAnalysis: EventAnalysis;
  recommendations: Recommendation[];
  mode: "model" | "local";
  notice?: string;
};

export type ChallengeResult = {
  possiblyOverrated: Array<{ attendeeId: string; reason: string }>;
  peopleMissed: Array<{
    attendeeId: string;
    reason: string;
    suggestedTier: RecommendationTier;
  }>;
  wildcard: null | {
    attendeeId: string;
    reason: string;
    potentialUnlock: string;
  };
  mode: "model" | "local";
  notice?: string;
};

export type OutreachResult = {
  attendeeId: string;
  personalization: "strong" | "limited";
  message: string;
  missingInformation: string[];
  mode: "model" | "local";
  notice?: string;
};

export type NetworkContact = {
  id: string;
  sourceRef: string;
  name: string;
  company: string | null;
  role: string | null;
  connectedToNames: string[];
  connectedToCompanies: string[];
};

export type WarmPath = {
  attendeeId: string;
  contactId: string;
  viaName: string;
  targetName: string;
  basis: "explicit_person";
  evidence: string;
};

export type MeetingPrepResult = {
  attendeeId: string;
  whyThisMeeting: string;
  leadWith: string;
  askThis: string;
  listenFor: string;
  dontWasteTimeOn: string;
  desiredNextStep: string;
  mode: "model" | "local";
};

export type MeetingFocus =
  | "investors"
  | "customers"
  | "strategic_partners"
  | "experts"
  | "talent"
  | "relationship_building";

export type EventAnalysis = {
  overview: string;
  roomProfile: {
    dominantProfiles: string;
    investorLandscape: string;
    stageRelevance: string;
    sectorsAndThemes: string;
    customerLandscape: string;
    partnerLandscape: string;
    seniorityMix: string;
    geographies: string;
    meaningfulGaps: string;
  };
  goodFor: string[];
  weakerFor: string[];
  strategy: {
    summary: string;
    meetingMix: Array<{
      focus: MeetingFocus;
      percentage: number;
      rationale: string;
    }>;
    prioritize: string;
    doNotOverPrioritize: string;
  };
  dataQuality: {
    level: "strong" | "mixed" | "limited";
    note: string;
  };
};

export type AnalysisContext = {
  company: CompanyContext;
  objective: ConferenceObjective;
  attendees: Attendee[];
};
