# Conference Copilot

Conference Copilot is an open-source prototype that turns a founder brief and an attendee list into a relevance-first meeting shortlist, a challenge pass, grounded outreach drafts, warm-introduction paths, and concise meeting briefs. The app does not persist session data.

## Use your own model

Each person who runs or deploys the project supplies their own server-side OpenAI key and model ID. The app does not ask visitors to paste API keys into the browser.

```bash
cp .env.example .env.local
```

Then set:

```bash
OPENAI_API_KEY=
OPENAI_MODEL=gpt-5
```

Add your own key after the first equals sign in the local `.env.local` file. Never commit that file.

`OPENAI_MODEL` can be changed to another OpenAI model that supports the Responses API and Structured Outputs. This version does not provide adapters for Ollama, Anthropic, Azure OpenAI, or arbitrary OpenAI-compatible endpoints. Without a valid model configuration, attendee ranking, outreach, and Meeting Prep use the local fallback paths.

## Run locally

Requirements: Node.js 22.13 or newer.

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open the local URL printed in the terminal. With `OPENAI_API_KEY`, attendee ranking uses a deterministic top-30 filter followed by an event-level analysis, evidence-led model rerank, and model challenge pass. Without a key, or if either model pass fails validation, the deterministic event analysis and ranking are returned. `OPENAI_MODEL` is optional and defaults to `gpt-5`.

## Attendee inputs

The attendee section shows three clear paths:

1. **CSV — default.** Upload an attendee export. Parsing, column inference, normalization, and conservative deduplication happen locally.
2. **Text-only copy/paste.** Paste attendee rows or profile text that you are authorized to use. The parser accepts uneven delimiters and incomplete records without enriching them.
3. **Closed platform — coming soon.** This is visible in the UI as a future organizer-authorized route for services such as Brella. It is intentionally inactive in this prototype and does not request credentials, log in, or scrape a platform.

### Brella role paths

- **Organizer or event admin:** use Brella’s official attendee CSV export when possible. For a future automated connection, use only Brella’s officially enabled API or Zapier integration with organizer authorization.
- **Sponsor:** use the scoped lead/scan CSV available to the sponsor or linked representative. This does not provide the full attendee directory.
- **Ordinary attendee:** Brella does not document a bulk attendee export for attendee accounts. Paste visible profile text or ask the organizer for the official CSV.

Useful official Brella references: [participant exports](https://help-organizers.brella.io/en/articles/182796-export-participants-list), [API and event IDs](https://help-organizers.brella.io/en/articles/181542-set-up-api-and-event-ids), [Zapier integration basics](https://help-organizers.brella.io/en/articles/181546-basics-to-integrate-apps-with-brella-through-zapier), [attendee People tab](https://help-attendees.brella.io/en/articles/180550-networking-in-the-people-tab), and [sponsor lead exports](https://help-sponsors.brella.io/en/articles/460949-lead-scanning-guide-for-sponsor-representatives).

## Warm Paths

The optional **Add your network** input accepts pasted `Connector -> Target attendee` lines or a CSV with explicit Connector and Target attendee columns. Warm Paths V1 only displays a path when a supplied connector record names the recommended attendee exactly (after conservative case/diacritic normalization). It does not infer a relationship from a shared employer, role, company, fuzzy name, or attendee proximity. Network records stay in browser memory, are not sent to ranking or challenge, and are only reduced to the selected supported path when Meeting Prep is requested. The parser is intentionally shaped so a future CRM/network adapter can provide the same explicit relationship records without changing the recommendation UI.

## Meeting Prep

Every recommendation has a **Prepare for meeting** action. It sends only the company context, conference objective, selected attendee, recommendation context, and optional supplied warm path to the server. When model access is configured, the server makes a structured, non-persisted OpenAI request and returns six short fields: why this meeting, lead with, ask this, listen for, don’t waste time on, and desired next step. Without model access, Meeting Prep returns a conservative local brief. It does not change the ranking.

## Privacy and model use

The browser keeps the current brief, normalized attendees, results, drafts, and optional network records in React memory only. The app does not use a database, local storage, analytics, external enrichment, uploads from closed platforms, or source-platform credentials. CSV and pasted text are normalized in the browser. Model ranking receives bounded aggregate evidence about the full roster plus only the deterministic top-30 raw candidate profiles. Warm-path records are excluded from rank/challenge requests; a single selected supported path may be included in Meeting Prep. Ranking, challenge, outreach, and Meeting Prep model requests use `store: false`, and the API key stays server-side.

## Architecture

- `app/page.tsx` — the single-session interface and workflow state.
- `lib/conference/normalize.ts` — CSV and pasted-text normalization with conservative deduplication.
- `lib/conference/network.ts` — bounded network parsing and explicit person-to-person warm-path matching.
- `app/api/analyze/route.ts` — validates ranking, challenge, outreach, and Meeting Prep input/output and rejects unknown attendee IDs.
- `lib/ai/prompts.ts` — editable ranking, challenge, outreach, and Meeting Prep instructions.
- `lib/ai/schemas.ts` — structured-output and runtime validation schemas.
- `lib/ai/fallback.ts` — inspectable deterministic rubric for ranking plus local challenge and outreach drafts.
- `lib/ai/ranking.ts` — server-side shortlist, evidence-led reranking, integrity checks, and automatic final challenge pass.

## Ranking behavior

The deterministic scorer weights goal fit at 30%, company fit at 25%, timing fit and mutual relevance at 15% each, actionability at 10%, and information quality at 5%. It scores every attendee and selects at most 30 candidates. When model access is available, the first model pass interprets bounded evidence from the whole room, builds a grounded evidence ledger for each candidate, and reranks the shortlist with the same weights. A second model pass challenges overrated choices, missing stronger fits, weak Must Meets, and one possible wildcard before returning the complete final list. Unknown IDs, incomplete evidence, changed role/company facts, invalid event strategy, or any model failure discard the partial result and trigger the local fallback.

## Self-hosting

The app needs a Node-compatible or equivalent server runtime for `/api/analyze`. The hybrid ranking, challenge, outreach, and Meeting Prep paths use `OPENAI_API_KEY` and `OPENAI_MODEL` as server-side environment variables. There is no database or migration step.

Do not publish a shared API key in client-side code. A public hosted instance that pays for visitors' model calls should add authentication, rate limits, spend limits, abuse monitoring, a documented retention/deletion policy, and synthetic attendee-list evals first. Cloning and self-hosting with each operator's own server-side key is the intended public-repository workflow.

The maintained demo uses `.openai/hosting.json` for its own deployment. The public source does not require that file when running or deploying elsewhere.

## License

Conference Copilot is available under the [MIT License](LICENSE).

A future closed-platform feature should use an official organizer-authorized export or API and receive its own privacy/security review.
