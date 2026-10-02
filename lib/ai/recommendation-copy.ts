import type { Recommendation } from "@/lib/conference/types";

const provenancePhrases: Array<[RegExp, string]> = [
  [/\bbased on the information provided\b[,:]?\s*/gi, ""],
  [/\bthe supplied attendee profile\b/gi, "their role"],
  [/\bthe supplied profile\b/gi, "their role"],
  [/\bthe attendee data\b/gi, "their profile"],
  [/\bis listed as\b/gi, "is"],
  [/\bis listed with\b/gi, "is with"],
  [/\bmatches? the founder[’']s objective\b/gi, "is relevant now"],
  [/\bsupporting evidence\b/gi, "relevance"],
  [/\bcan lead with (?:its|their) stated work in\b/gi, "is relevant through"],
];

function firstSentence(value: string) {
  const dotMarker = "\uE000";
  const protectedValue = value
    .replace(/\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|Inc|Ltd|Co|Corp)\./gi, (match) => match.replace(".", dotMarker))
    .replace(/\b(?:[A-Za-z]\.){2,}/g, (match) => match.replaceAll(".", dotMarker));
  const end = protectedValue.search(/[.!?](?:\s|$)/);
  const sentence = end >= 0 ? protectedValue.slice(0, end + 1) : protectedValue;
  return sentence.replaceAll(dotMarker, ".");
}

export function conciseRecommendationSentence(value: string, maximumWords = 20) {
  const original = value.replace(/\s+/g, " ").trim();
  let sentence = provenancePhrases.reduce(
    (current, [pattern, replacement]) => current.replace(pattern, replacement),
    original,
  ).replace(/\s+/g, " ").trim();
  if (!sentence) sentence = original;
  sentence = firstSentence(sentence);

  const words = sentence.split(/\s+/).filter(Boolean);
  if (words.length > maximumWords) {
    sentence = `${words.slice(0, maximumWords).join(" ").replace(/[,:;–—-]+$/, "")}…`;
  } else if (sentence && !/[.!?…]$/.test(sentence)) {
    sentence = `${sentence}.`;
  }

  return sentence ? `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}` : sentence;
}

export function conciseRecommendationCopy(recommendation: Recommendation): Recommendation {
  return {
    ...recommendation,
    whyThem: conciseRecommendationSentence(recommendation.whyThem),
    whyYou: conciseRecommendationSentence(recommendation.whyYou),
    suggestedAngle: conciseRecommendationSentence(recommendation.suggestedAngle),
  };
}
