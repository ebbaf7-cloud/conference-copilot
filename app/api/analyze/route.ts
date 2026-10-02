import { z } from "zod";
import {
  challengeJsonSchema,
  challengeOutputSchema,
  meetingPrepJsonSchema,
  meetingPrepOutputSchema,
  outreachJsonSchema,
  outreachOutputSchema,
} from "@/lib/ai/schemas";
import {
  CHALLENGE_INSTRUCTIONS,
  MEETING_PREP_INSTRUCTIONS,
  OUTREACH_INSTRUCTIONS,
  promptForChallenge,
  promptForMeetingPrep,
  promptForOutreach,
} from "@/lib/ai/prompts";
import { hasModelKey, OpenAIRequestError, requestStructured } from "@/lib/ai/openai";
import { buildLocalChallenge, buildLocalMeetingPrep, buildLocalOutreach, buildLocalRanking } from "@/lib/ai/fallback";
import { buildHybridRanking } from "@/lib/ai/ranking";
import type { AnalysisContext, Recommendation } from "@/lib/conference/types";

export const runtime = "nodejs";

const text = (maximum = 8_000) => z.string().max(maximum);
const companyContextSchema = z.object({
  name: text(300),
  description: text(2_000),
  stage: text(500),
  geography: text(1_000),
  fundraising: text(2_000),
  commercial: text(3_000),
  additional: text(3_000),
});
const objectiveContextSchema = z.object({
  primary: text(100),
  details: text(4_000),
  secondary: text(2_000),
  valuable: text(2_000),
  deprioritize: text(2_000),
});
const attendeeContextSchema = z.object({
  id: text(200),
  sourceRef: text(300),
  name: text(300),
  company: text(500).nullable(),
  role: text(500).nullable(),
  description: text(8_000).nullable(),
  category: z.enum(["investor", "customer", "partner", "talent", "advisor_expert", "media", "service_provider", "other", "unknown"]),
  other: z.array(z.object({ label: text(500), value: text(8_000) })).max(100),
  warnings: z.array(text(1_000)).max(50),
});
const contextSchema = z.object({
  company: companyContextSchema,
  objective: objectiveContextSchema,
  attendees: z.array(attendeeContextSchema).min(1).max(5_000),
});
const meetingPrepContextSchema = z.object({
  company: companyContextSchema,
  objective: objectiveContextSchema,
  attendee: attendeeContextSchema,
});

const recommendationInputSchema = z.object({
  attendeeId: text(200),
  tier: z.enum(["must_meet", "worth_meeting", "wildcard"]),
  whyThem: text(4_000),
  whyYou: text(4_000),
  suggestedAngle: text(4_000),
  confidence: z.enum(["high", "medium", "low"]),
  missingInformation: z.array(text(1_000)).max(20),
  scores: z.object({
    objectiveFit: z.number().min(0).max(5),
    companyFit: z.number().min(0).max(5),
    immediateUtility: z.number().min(0).max(5),
    realisticUsefulness: z.number().min(0).max(5),
    reciprocalValue: z.number().min(0).max(5),
    actionability: z.number().min(0).max(5),
  }).optional(),
});

const warmPathInputSchema = z.object({
  attendeeId: z.string().min(1).max(200),
  viaName: z.string().min(1).max(300),
  targetName: z.string().min(1).max(300),
});

const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("rank"), context: contextSchema }),
  z.object({ action: z.literal("challenge"), context: contextSchema, recommendations: z.array(recommendationInputSchema).min(1).max(15) }),
  z.object({ action: z.literal("outreach"), context: contextSchema, recommendation: recommendationInputSchema, attendeeId: text(200) }),
  z.object({ action: z.literal("meeting_prep"), context: meetingPrepContextSchema, recommendation: recommendationInputSchema, attendeeId: text(200), warmPath: warmPathInputSchema.optional() }),
]);

function validationErrorMessage(error: z.ZodError) {
  const attendeeCountIssue = error.issues.find((issue) => (
    issue.code === "too_big"
    && issue.path.length === 2
    && issue.path[0] === "context"
    && issue.path[1] === "attendees"
  ));
  if (attendeeCountIssue) {
    return "This attendee list contains more than 5,000 people. Use a smaller event list and try again.";
  }

  const attendeeFieldIssue = error.issues.find((issue) => issue.path.includes("attendees"));
  if (attendeeFieldIssue) {
    return "One or more attendee records contain unusually large fields. Review the attendee import and try again.";
  }

  return "Some required company or conference context is missing or too long. Review the brief and try again.";
}

function trimMessage(message: string, maximum = 90) {
  const words = message.trim().split(/\s+/);
  return words.length <= maximum ? message.trim() : `${words.slice(0, maximum - 1).join(" ")}…`;
}

function fallbackNotice(error: unknown) {
  const reason = error instanceof Error && error.name === "AbortError"
    ? "The model request timed out."
    : "The model request could not be completed.";
  return `${reason} A transparent rules-based draft is shown so you can keep working and retry.`;
}

function fallbackLogReason(error: unknown) {
  if (error instanceof Error && error.name === "AbortError") return "OpenAI request timed out.";
  if (error instanceof z.ZodError) return "OpenAI response failed validation.";
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    if (/credit|quota|insufficient_quota/.test(message)) return "OpenAI quota or credits are unavailable.";
    if (/authentication|unauthorized|api key|\b401\b/.test(message)) return "OpenAI authentication failed.";
    if (/rate limit|\b429\b/.test(message)) return "OpenAI rate limit reached.";
    if (/context length|maximum context|too many tokens|input.+too long/.test(message)) return "OpenAI context limit was exceeded.";
    if (/model.+(not found|unavailable|does not exist|not supported)/.test(message)) return "The configured OpenAI model is unavailable.";
    if (/malformed json/.test(message)) return "OpenAI returned malformed structured output.";
    if (/incomplete|no structured output/.test(message)) return "OpenAI returned incomplete structured output.";
    if (/candidate evidence|draft recommendations|final recommendations|audit|challenge pass/.test(message)) {
      return `OpenAI ranking output failed integrity checks: ${error.message}`;
    }
    if (error instanceof OpenAIRequestError) {
      if (error.status >= 500) return `OpenAI service failed with HTTP ${error.status}.`;
      return `OpenAI request failed with HTTP ${error.status}.`;
    }
    if (/fetch failed|network|econn|enotfound|socket|tls/.test(message)) return "OpenAI network request failed.";
  }
  return "OpenAI request failed.";
}

export async function POST(request: Request) {
  try {
    const raw = await request.text();
    if (raw.length > 5_000_000) {
      return Response.json({ error: "This attendee list is too large for the prototype. Reduce the file and try again." }, { status: 413 });
    }

    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return Response.json({ error: "The analysis request was malformed. Please try again." }, { status: 400 });
    }
    const parsed = requestSchema.safeParse(json);
    if (!parsed.success) {
      console.warn("Analysis request validation failed:", parsed.error.issues.map((issue) => ({
        code: issue.code,
        path: issue.path.join("."),
      })));
      return Response.json({ error: validationErrorMessage(parsed.error) }, { status: 400 });
    }

    const payload = parsed.data;
    const context: AnalysisContext = payload.action === "meeting_prep"
      ? { company: payload.context.company, objective: payload.context.objective, attendees: [payload.context.attendee] }
      : payload.context as AnalysisContext;

    if (payload.action === "rank") {
      if (!hasModelKey()) {
        console.info("Ranking mode: rules-based fallback");
        console.info("Ranking fallback reason: OPENAI_API_KEY is not configured.");
        return Response.json(buildLocalRanking(context));
      }
      try {
        const { result } = await buildHybridRanking(context);
        console.info("Ranking mode: OpenAI");
        return Response.json(result);
      } catch (error) {
        console.info("Ranking mode: rules-based fallback");
        console.warn(`Ranking fallback reason: ${fallbackLogReason(error)}`);
        return Response.json(buildLocalRanking(context));
      }
    }

    if (payload.action === "challenge") {
      const recommendations = payload.recommendations as Recommendation[];
      if (!hasModelKey()) return Response.json(buildLocalChallenge(context, recommendations));
      try {
        const result = await requestStructured({
          instructions: CHALLENGE_INSTRUCTIONS,
          input: promptForChallenge({ ...context, recommendations }),
          name: "conference_ranking_challenge",
          jsonSchema: challengeJsonSchema,
          validator: challengeOutputSchema,
          maxOutputTokens: 3500,
        });
        const attendeeIds = new Set(context.attendees.map((attendee) => attendee.id));
        const rankedIds = new Set(recommendations.map((item) => item.attendeeId));
        const possiblyOverrated = result.possiblyOverrated.filter((item) => rankedIds.has(item.attendeeId)).slice(0, 3);
        const peopleMissed = result.peopleMissed.filter((item) => attendeeIds.has(item.attendeeId) && !rankedIds.has(item.attendeeId)).slice(0, 3);
        const excluded = new Set(peopleMissed.map((item) => item.attendeeId));
        const wildcard = result.wildcard && attendeeIds.has(result.wildcard.attendeeId) && !excluded.has(result.wildcard.attendeeId)
          ? result.wildcard
          : null;
        return Response.json({ possiblyOverrated, peopleMissed, wildcard, mode: "model" });
      } catch (error) {
        console.warn(`OpenAI challenge fallback reason: ${fallbackLogReason(error)}`);
        return Response.json({ ...buildLocalChallenge(context, recommendations), notice: fallbackNotice(error) });
      }
    }

    if (payload.action === "meeting_prep") {
      const attendee = context.attendees.find((item) => item.id === payload.attendeeId);
      if (!attendee || attendee.id !== payload.recommendation.attendeeId) {
        return Response.json({ error: "That attendee is no longer in the current list." }, { status: 400 });
      }
      const warmPath = payload.warmPath;
      if (warmPath && (
        warmPath.attendeeId !== attendee.id
        || warmPath.targetName !== attendee.name
        || warmPath.viaName.trim().toLocaleLowerCase() === attendee.name.trim().toLocaleLowerCase()
      )) {
        return Response.json({ error: "That warm path does not match the selected attendee." }, { status: 400 });
      }
      if (!hasModelKey()) {
        console.info("Meeting prep mode: rules-based fallback");
        console.info("Meeting prep fallback reason: OPENAI_API_KEY is not configured.");
        return Response.json(buildLocalMeetingPrep(context, attendee, payload.recommendation, warmPath));
      }
      try {
        const result = await requestStructured({
          instructions: MEETING_PREP_INSTRUCTIONS,
          input: promptForMeetingPrep({
            company: context.company,
            objective: context.objective,
            attendee,
            recommendation: payload.recommendation,
            warmPath: warmPath ? { viaName: warmPath.viaName, targetName: warmPath.targetName } : null,
          }),
          name: "conference_meeting_prep",
          jsonSchema: meetingPrepJsonSchema,
          validator: meetingPrepOutputSchema,
          maxOutputTokens: 4_000,
        });
        if (result.attendeeId !== attendee.id) throw new Error("Model returned the wrong attendee ID for meeting prep.");
        console.info("Meeting prep mode: OpenAI");
        return Response.json({
          attendeeId: result.attendeeId,
          whyThisMeeting: result.whyThisMeeting.trim(),
          leadWith: result.leadWith.trim(),
          askThis: result.askThis.trim(),
          listenFor: result.listenFor.trim(),
          dontWasteTimeOn: result.dontWasteTimeOn.trim(),
          desiredNextStep: result.desiredNextStep.trim(),
          mode: "model",
        });
      } catch (prepError) {
        console.info("Meeting prep mode: rules-based fallback");
        console.warn(`Meeting prep fallback reason: ${fallbackLogReason(prepError)}`);
        return Response.json(buildLocalMeetingPrep(context, attendee, payload.recommendation, warmPath));
      }
    }

    const attendee = context.attendees.find((item) => item.id === payload.attendeeId);
    if (!attendee || attendee.id !== payload.recommendation.attendeeId) {
      return Response.json({ error: "That attendee is no longer in the current list." }, { status: 400 });
    }
    if (!hasModelKey()) return Response.json(buildLocalOutreach(context, attendee));
    try {
      const result = await requestStructured({
        instructions: OUTREACH_INSTRUCTIONS,
        input: promptForOutreach({ company: context.company, objective: context.objective, attendee, recommendation: payload.recommendation }),
        name: "conference_outreach",
        jsonSchema: outreachJsonSchema,
        validator: outreachOutputSchema,
        maxOutputTokens: 1200,
      });
      if (result.attendeeId !== attendee.id) throw new Error("Model returned the wrong attendee ID.");
      return Response.json({ ...result, message: trimMessage(result.message), mode: "model" });
    } catch (error) {
      console.warn(`OpenAI outreach fallback reason: ${fallbackLogReason(error)}`);
      return Response.json({ ...buildLocalOutreach(context, attendee), notice: fallbackNotice(error) });
    }
  } catch {
    return Response.json({ error: "The analysis could not be completed. Your inputs are still here—please retry." }, { status: 500 });
  }
}
