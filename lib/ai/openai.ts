import type { z } from "zod";

type OpenAIResponse = {
  output?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string; refusal?: string }>;
  }>;
  error?: { message?: string };
  incomplete_details?: { reason?: string } | null;
};

function outputText(response: OpenAIResponse) {
  return (response.output ?? [])
    .flatMap((item) => item.content ?? [])
    .filter((content) => content.type === "output_text" && typeof content.text === "string")
    .map((content) => content.text)
    .join("");
}

export function hasModelKey() {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

export type StructuredRequestArgs<T> = {
  instructions: string;
  input: string;
  name: string;
  jsonSchema: object;
  validator: z.ZodType<T>;
  maxOutputTokens?: number;
};

export type StructuredRequester = <T>(args: StructuredRequestArgs<T>) => Promise<T>;

export class OpenAIRequestError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "OpenAIRequestError";
    this.status = status;
  }
}

export async function requestStructured<T>({
  instructions,
  input,
  name,
  jsonSchema,
  validator,
  maxOutputTokens = 6500,
}: StructuredRequestArgs<T>): Promise<T> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured.");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL?.trim() || "gpt-5",
        instructions,
        input,
        store: false,
        max_output_tokens: maxOutputTokens,
        text: {
          format: {
            type: "json_schema",
            name,
            strict: true,
            schema: jsonSchema,
          },
        },
      }),
      signal: controller.signal,
    });

    const data = await response.json() as OpenAIResponse;
    if (!response.ok) {
      throw new OpenAIRequestError(response.status, data.error?.message || `Model request failed (${response.status}).`);
    }
    const text = outputText(data);
    if (!text) {
      const reason = data.incomplete_details?.reason;
      throw new Error(reason ? `Model response was incomplete: ${reason}.` : "Model returned no structured output.");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error("Model returned malformed JSON.");
    }
    return validator.parse(parsed);
  } finally {
    clearTimeout(timer);
  }
}
