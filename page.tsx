"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Clipboard,
  Download,
  FileText,
  Loader2,
  Lock,
  RotateCcw,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Toaster } from "@/components/ui/sonner";
import { buildHitListCsv, buildHitListText } from "@/lib/conference/export";
import {
  buildRoomDirectory,
  buildRoomDirectoryCsv,
  filterRoomDirectory,
  roomCategoryOptions,
  type RoomCategory,
} from "@/lib/conference/explore";
import {
  findWarmPaths,
  normalizeNetworkCsv,
  normalizeNetworkPaste,
  warmPathMessage,
  warmSuggestedAngle,
  type NetworkNormalizeResult,
} from "@/lib/conference/network";
import { normalizeCsv, normalizePaste, type NormalizeResult } from "@/lib/conference/normalize";
import type {
  AnalysisContext,
  Attendee,
  ChallengeResult,
  CompanyContext,
  ConferenceObjective,
  EventAnalysis,
  MeetingFocus,
  MeetingPrepResult,
  NetworkContact,
  OutreachResult,
  RankingResult,
  Recommendation,
  RecommendationTier,
  WarmPath,
} from "@/lib/conference/types";

const emptyCompany: CompanyContext = {
  name: "",
  description: "",
  stage: "",
  geography: "",
  fundraising: "",
  commercial: "",
  additional: "",
};

const emptyObjective: ConferenceObjective = {
  primary: "fundraising",
  details: "",
  secondary: "",
  valuable: "",
  deprioritize: "",
};

type AttendeeMode = "csv" | "paste" | "closed";
type NetworkMode = "paste" | "csv";

const emptyNormalizeResult: NormalizeResult = { attendees: [], rejected: [] };
const emptyNetworkNormalizeResult: NetworkNormalizeResult = { contacts: [], rejected: [] };

function ClosedPlatformComingSoon({ onChooseMode }: { onChooseMode: (mode: AttendeeMode) => void }) {
  return (
    <div className="closed-platform-coming-soon" role="status">
      <div className="coming-soon-icon" aria-hidden="true"><Lock /></div>
      <div className="coming-soon-copy">
        <span className="coming-soon-label">Coming soon</span>
        <h4>Import from closed conference platforms</h4>
        <p>
          We’re exploring organizer-authorized ways to bring attendee data in from platforms such as Brella. This version does not connect to, log in to, or scrape closed platforms.
        </p>
        <p className="coming-soon-help">
          For now, ask the organizer for a CSV export or copy the attendee text you are allowed to use.
        </p>
        <div className="coming-soon-actions">
          <Button type="button" variant="outline" size="sm" onClick={() => onChooseMode("csv")}><Upload /> Use CSV</Button>
          <Button type="button" variant="outline" size="sm" onClick={() => onChooseMode("paste")}><FileText /> Use text copy/paste</Button>
        </div>
      </div>
    </div>
  );
}

const objectiveLabels: Record<string, string> = {
  fundraising: "Fundraising",
  customers: "Customers",
  partnerships: "Partnerships",
  hiring: "Hiring",
  advisors: "Advisors / experts",
  network: "General network",
  other: "Other",
};

const tierDetails: Record<RecommendationTier, { label: string; number: string; description: string }> = {
  must_meet: {
    label: "Must Meet",
    number: "I",
    description: "The strongest combination of relevance, timing, and plausible mutual value.",
  },
  worth_meeting: {
    label: "Worth Meeting",
    number: "II",
    description: "Good-fit conversations to pursue once the core meetings are covered.",
  },
  wildcard: {
    label: "Wildcards",
    number: "III",
    description: "Less obvious bets with a credible path to disproportionate value.",
  },
};

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="field-stack">
      <span className="field-label">{label}</span>
      {children}
      {hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

function WorkflowRail({ view }: { view: "brief" | "results" }) {
  const inputSteps = [
    { number: "01", label: "Company" },
    { number: "02", label: "Goal" },
    { number: "03", label: "Attendees" },
    { number: "04", label: "Hit list" },
  ];
  return (
    <aside className="step-rail" aria-label="Workflow progress">
      <ol className="step-list">
        {inputSteps.map((step, index) => {
          const complete = view === "results" || index === 0;
          const current = view === "brief" ? index === 0 : index === 3;
          return (
            <li className={`step-item ${complete ? "step-complete" : ""} ${current ? "step-current" : ""}`} key={step.number}>
              <span className="step-number">{step.number}</span>
              <span>{step.label}</span>
            </li>
          );
        })}
      </ol>
    </aside>
  );
}

function AttendeeLine({ attendee }: { attendee: Attendee }) {
  return (
    <span>
      {attendee.company ?? "Company not supplied"}
      {attendee.role ? ` · ${attendee.role}` : ""}
    </span>
  );
}

function ConfidenceBadge({ value }: { value: Recommendation["confidence"] }) {
  return <span className={`confidence confidence-${value}`}>{value}</span>;
}

const meetingFocusLabels: Record<MeetingFocus, string> = {
  investors: "Investors",
  customers: "Customers",
  strategic_partners: "Strategic partners",
  experts: "Experts",
  talent: "Talent",
  relationship_building: "Relationship-building",
};

function EventAnalysisSection({ analysis }: { analysis: EventAnalysis }) {
  const roomProfile = [
    ["Who dominates", analysis.roomProfile.dominantProfiles],
    ["Investor mix", analysis.roomProfile.investorLandscape],
    ["Stage relevance", analysis.roomProfile.stageRelevance],
    ["Sectors & themes", analysis.roomProfile.sectorsAndThemes],
    ["Potential customers", analysis.roomProfile.customerLandscape],
    ["Strategic partners", analysis.roomProfile.partnerLandscape],
    ["Seniority mix", analysis.roomProfile.seniorityMix],
    ["Geographies", analysis.roomProfile.geographies],
    ["Meaningful gaps", analysis.roomProfile.meaningfulGaps],
  ] as const;

  return (
    <section className="event-analysis" aria-labelledby="event-analysis-title">
      <header className="event-analysis-header">
        <div>
          <p className="eyebrow">Event overview</p>
          <h2 id="event-analysis-title">What to expect from this event</h2>
        </div>
        <span className={`event-data-badge event-data-${analysis.dataQuality.level}`}>
          {analysis.dataQuality.level} data
        </span>
      </header>
      <p className="event-overview-copy">{analysis.overview}</p>
      <p className="event-data-note">{analysis.dataQuality.note}</p>

      <dl className="event-profile-grid">
        {roomProfile.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>

      <div className="event-opportunity-grid">
        <section aria-labelledby="event-good-for">
          <p className="eyebrow">Strongest opportunities</p>
          <h3 id="event-good-for">What this event is good for</h3>
          <ul>{analysis.goodFor.map((item) => <li key={item}>{item}</li>)}</ul>
        </section>
        <section aria-labelledby="event-weaker-for">
          <p className="eyebrow">Limits</p>
          <h3 id="event-weaker-for">What this event is weaker for</h3>
          <ul>{analysis.weakerFor.map((item) => <li key={item}>{item}</li>)}</ul>
        </section>
      </div>

      <section className="event-strategy" aria-labelledby="event-strategy-title">
        <div className="event-strategy-intro">
          <div>
            <p className="eyebrow">Use the room</p>
            <h3 id="event-strategy-title">Recommended strategy</h3>
          </div>
          <p>{analysis.strategy.summary}</p>
        </div>
        <div className="meeting-mix" aria-label="Recommended meeting mix">
          {analysis.strategy.meetingMix.map((item) => (
            <div className="meeting-mix-row" key={item.focus}>
              <div className="meeting-mix-label">
                <strong>{meetingFocusLabels[item.focus]}</strong>
                <span>{item.percentage}%</span>
              </div>
              <div className="meeting-mix-track" aria-hidden="true">
                <span style={{ width: `${item.percentage}%` }} />
              </div>
              <p>{item.rationale}</p>
            </div>
          ))}
        </div>
        <div className="event-strategy-notes">
          <p><strong>Prioritize</strong>{analysis.strategy.prioritize}</p>
          <p><strong>Do not over-prioritize</strong>{analysis.strategy.doNotOverPrioritize}</p>
        </div>
      </section>
    </section>
  );
}

function RecommendationCard({
  attendee,
  recommendation,
  index,
  onOutreach,
  onPrepare,
  warmPath,
}: {
  attendee: Attendee;
  recommendation: Recommendation;
  index: number;
  onOutreach: (recommendation: Recommendation) => void;
  onPrepare: (recommendation: Recommendation, warmPath?: WarmPath) => void;
  warmPath?: WarmPath;
}) {
  const suggestedAngle = warmPath
    ? warmSuggestedAngle(warmPath)
    : recommendation.suggestedAngle;
  return (
    <article className="recommendation-card">
      <div className="card-index">{String(index + 1).padStart(2, "0")}</div>
      <div className="card-content">
        <header className="person-header">
          <div>
            <h3>{attendee.name}</h3>
            <p><AttendeeLine attendee={attendee} /></p>
          </div>
          <ConfidenceBadge value={recommendation.confidence} />
        </header>

        {warmPath ? (
          <div className="warm-path-callout">
            <strong>Warm path</strong>
            <p>{warmPathMessage(warmPath)}</p>
          </div>
        ) : null}

        <dl className="recommendation-reasons">
          <div>
            <dt>Why them</dt>
            <dd>{recommendation.whyThem}</dd>
          </div>
          <div>
            <dt>Why you</dt>
            <dd>{recommendation.whyYou}</dd>
          </div>
          <div className="angle-row">
            <dt>Best angle</dt>
            <dd>{suggestedAngle}</dd>
          </div>
        </dl>

        {recommendation.missingInformation.length ? (
          <p className="missing-note">
            <strong>Confidence note:</strong> Missing {recommendation.missingInformation.join(", ")}.
          </p>
        ) : null}

        <footer className="card-footer">
          <Button variant="ghost" size="sm" onClick={() => onPrepare(recommendation, warmPath)}>
            <FileText /> Prepare for meeting
          </Button>
          <Button variant="ghost" size="sm" onClick={() => onOutreach(recommendation)}>
            Draft outreach <ArrowRight />
          </Button>
        </footer>
      </div>
    </article>
  );
}

function downloadCsvFile(contents: string, filename: string) {
  const url = URL.createObjectURL(new Blob([`\uFEFF${contents}`], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function ExploreRoom({ context, recommendations }: { context: AnalysisContext; recommendations: Recommendation[] }) {
  const [category, setCategory] = useState<RoomCategory>("all");
  const [geography, setGeography] = useState("");
  const [role, setRole] = useState("");
  const [company, setCompany] = useState("");
  const [minimumScore, setMinimumScore] = useState(0);
  const [visibleCount, setVisibleCount] = useState(50);
  const rows = useMemo(() => buildRoomDirectory(context, recommendations), [context, recommendations]);
  const filteredRows = useMemo(() => filterRoomDirectory(rows, {
    category,
    geography,
    role,
    company,
    minimumScore,
  }), [rows, category, geography, role, company, minimumScore]);
  const visibleRows = filteredRows.slice(0, visibleCount);
  const hasFilters = category !== "all" || geography || role || company || minimumScore > 0;
  const categoryCounts = useMemo(() => new Map(roomCategoryOptions.map((option) => {
    if (option.value === "all") return [option.value, rows.length] as const;
    const roomCategory = option.value;
    return [roomCategory, rows.filter((row) => row.categories.includes(roomCategory)).length] as const;
  })), [rows]);

  const resetVisible = () => setVisibleCount(50);
  const resetFilters = () => {
    setCategory("all");
    setGeography("");
    setRole("");
    setCompany("");
    setMinimumScore(0);
    resetVisible();
  };
  const downloadFilteredCsv = () => {
    if (!filteredRows.length) return;
    downloadCsvFile(buildRoomDirectoryCsv(filteredRows), "conference-copilot-filtered-attendees.csv");
    toast.success("Filtered CSV downloaded");
  };

  return (
    <section className="room-explorer" aria-labelledby="room-explorer-title">
      <header className="room-explorer-header">
        <div>
          <p className="eyebrow">Explore the room</p>
          <h2 id="room-explorer-title">Who else is in the room?</h2>
        </div>
        <p>Browse the full attendee list separately from the people prioritized above.</p>
      </header>

      <div className="room-category-filters" role="group" aria-label="Filter attendees by category">
        {roomCategoryOptions.map((option) => (
          <button
            type="button"
            key={option.value}
            className={category === option.value ? "room-category-active" : ""}
            aria-pressed={category === option.value}
            onClick={() => { setCategory(option.value); resetVisible(); }}
          >
            <span>{option.label}</span>
            <small>{categoryCounts.get(option.value) ?? 0}</small>
          </button>
        ))}
      </div>

      <div className="room-secondary-filters">
        <label>
          <span>Geography</span>
          <Input value={geography} onChange={(event) => { setGeography(event.target.value); resetVisible(); }} placeholder="Search supplied geography" />
        </label>
        <label>
          <span>Role / seniority</span>
          <Input value={role} onChange={(event) => { setRole(event.target.value); resetVisible(); }} placeholder="e.g. Partner or Director" />
        </label>
        <label>
          <span>Company</span>
          <Input value={company} onChange={(event) => { setCompany(event.target.value); resetVisible(); }} placeholder="Search company" />
        </label>
        <label>
          <span>Relevance score</span>
          <Select value={String(minimumScore)} onValueChange={(value) => { setMinimumScore(Number(value)); resetVisible(); }}>
            <SelectTrigger aria-label="Minimum relevance score"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="0">Any score</SelectItem>
              <SelectItem value="75">75 and above</SelectItem>
              <SelectItem value="55">55 and above</SelectItem>
              <SelectItem value="40">40 and above</SelectItem>
            </SelectContent>
          </Select>
        </label>
      </div>

      <div className="room-directory-toolbar">
        <p><strong>{filteredRows.length}</strong> of {rows.length} attendees</p>
        <div>
          {hasFilters ? <Button type="button" variant="ghost" size="sm" onClick={resetFilters}>Reset filters</Button> : null}
          <Button type="button" variant="outline" size="sm" onClick={downloadFilteredCsv} disabled={!filteredRows.length}>
            <Download /> Download filtered CSV
          </Button>
        </div>
      </div>

      {visibleRows.length ? (
        <div className="room-directory">
          <div className="room-directory-head" aria-hidden="true">
            <span>Person</span><span>Role</span><span>Category</span><span>Score</span><span>Reason</span>
          </div>
          <div className="room-directory-list">
            {visibleRows.map((row) => (
              <article className="room-directory-row" key={row.attendee.id}>
                <div className="room-person"><strong>{row.attendee.name}</strong><span>{row.attendee.company ?? "Company not supplied"}</span></div>
                <p className="room-role" data-label="Role">{row.attendee.role ?? "Role not supplied"}</p>
                <p className="room-category" data-label="Category">{row.categoryLabel}</p>
                <p className="room-score" data-label="Score"><strong>{row.relevanceScore}</strong><span>/100</span></p>
                <p className="room-reason" data-label="Reason">{row.shortReason}</p>
              </article>
            ))}
          </div>
          {visibleCount < filteredRows.length ? (
            <Button type="button" variant="outline" className="room-show-more" onClick={() => setVisibleCount((current) => current + 50)}>
              Show 50 more
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="room-empty" role="status"><strong>No attendees match these filters.</strong><span>Change or reset the filters to see more of the room.</span></div>
      )}
    </section>
  );
}

async function postAnalysis<T>(payload: unknown): Promise<T> {
  const response = await fetch("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(data.error || "The request could not be completed.");
  return data;
}

export default function Home() {
  const [company, setCompany] = useState<CompanyContext>(emptyCompany);
  const [objective, setObjective] = useState<ConferenceObjective>(emptyObjective);
  const [attendeeMode, setAttendeeMode] = useState<AttendeeMode>("csv");
  const [attendeeText, setAttendeeText] = useState("");
  const [csvResult, setCsvResult] = useState<NormalizeResult>({ attendees: [], rejected: [] });
  const [csvFileName, setCsvFileName] = useState("");
  const [csvError, setCsvError] = useState("");
  const [networkMode, setNetworkMode] = useState<NetworkMode>("paste");
  const [networkText, setNetworkText] = useState("");
  const [networkCsvResult, setNetworkCsvResult] = useState<NetworkNormalizeResult>(emptyNetworkNormalizeResult);
  const [networkCsvFileName, setNetworkCsvFileName] = useState("");
  const [networkError, setNetworkError] = useState("");
  const [analysisNetworkContacts, setAnalysisNetworkContacts] = useState<NetworkContact[]>([]);
  const [error, setError] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [view, setView] = useState<"brief" | "results">("brief");
  const [ranking, setRanking] = useState<RankingResult | null>(null);
  const [analysisContext, setAnalysisContext] = useState<AnalysisContext | null>(null);
  const [challenge, setChallenge] = useState<ChallengeResult | null>(null);
  const [isChallenging, setIsChallenging] = useState(false);
  const [outreachOpen, setOutreachOpen] = useState(false);
  const [outreach, setOutreach] = useState<OutreachResult | null>(null);
  const [selectedRecommendation, setSelectedRecommendation] = useState<Recommendation | null>(null);
  const [isDrafting, setIsDrafting] = useState(false);
  const [meetingPrepOpen, setMeetingPrepOpen] = useState(false);
  const [meetingPrep, setMeetingPrep] = useState<MeetingPrepResult | null>(null);
  const [meetingPrepError, setMeetingPrepError] = useState("");
  const [selectedPrepRecommendation, setSelectedPrepRecommendation] = useState<Recommendation | null>(null);
  const [isPreparingMeeting, setIsPreparingMeeting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const networkFileInputRef = useRef<HTMLInputElement>(null);
  const meetingPrepRequestRef = useRef(0);

  const pasteResult = useMemo(() => normalizePaste(attendeeText), [attendeeText]);
  const networkPasteResult = useMemo(() => normalizeNetworkPaste(networkText), [networkText]);
  const activeResult = attendeeMode === "csv"
    ? csvResult
    : attendeeMode === "paste"
      ? pasteResult
      : emptyNormalizeResult;
  const activeNetworkResult = networkMode === "csv" ? networkCsvResult : networkPasteResult;
  const companyReady = Boolean(company.name.trim() && company.description.trim());
  const objectiveReady = Boolean(objective.primary.trim() && objective.details.trim());
  const attendeesReady = activeResult.attendees.length > 0;
  useEffect(() => {
    const modelContext = document.modelContext;
    if (!modelContext?.registerTool) return;
    const lifecycle = new AbortController();
    const registration = modelContext.registerTool({
      name: "build_conference_hit_list",
      title: "Build conference hit list",
      description: "Set the visible company brief, conference objective, and pasted attendee data, then build the prioritized Conference Copilot hit list.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          company: {
            type: "object",
            additionalProperties: false,
            properties: {
              name: { type: "string", minLength: 1 },
              description: { type: "string", minLength: 1 },
              stage: { type: "string" },
              geography: { type: "string" },
              fundraising: { type: "string" },
              commercial: { type: "string" },
              additional: { type: "string" },
            },
            required: ["name", "description"],
          },
          objective: {
            type: "object",
            additionalProperties: false,
            properties: {
              primary: { type: "string", enum: ["fundraising", "customers", "partnerships", "hiring", "advisors", "network", "other"] },
              details: { type: "string", minLength: 1 },
              secondary: { type: "string" },
              valuable: { type: "string" },
              deprioritize: { type: "string" },
            },
            required: ["primary", "details"],
          },
          attendeeText: { type: "string", minLength: 1 },
        },
        required: ["company", "objective", "attendeeText"],
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      async execute(input) {
        if (!input || typeof input !== "object") throw new Error("A company, objective, and attendeeText are required.");
        const candidate = input as { company?: Partial<CompanyContext>; objective?: Partial<ConferenceObjective>; attendeeText?: unknown };
        if (typeof candidate.company?.name !== "string" || !candidate.company.name.trim() || typeof candidate.company?.description !== "string" || !candidate.company.description.trim()) {
          throw new Error("Company name and description are required.");
        }
        if (typeof candidate.objective?.primary !== "string" || typeof candidate.objective?.details !== "string" || !candidate.objective.details.trim()) {
          throw new Error("A primary objective and specific objective details are required.");
        }
        if (typeof candidate.attendeeText !== "string" || !candidate.attendeeText.trim()) throw new Error("attendeeText is required.");
        const normalized = normalizePaste(candidate.attendeeText);
        if (!normalized.attendees.length) throw new Error("No identifiable attendees were found in attendeeText.");
        const nextCompany = { ...emptyCompany, ...candidate.company } as CompanyContext;
        const nextObjective = { ...emptyObjective, ...candidate.objective } as ConferenceObjective;
        const context: AnalysisContext = { company: nextCompany, objective: nextObjective, attendees: normalized.attendees };
        const result = await postAnalysis<RankingResult>({ action: "rank", context });
        setCompany(nextCompany);
        setObjective(nextObjective);
        setAttendeeText(candidate.attendeeText);
        setAttendeeMode("paste");
        setAnalysisContext(context);
        setAnalysisNetworkContacts([]);
        setRanking(result);
        setChallenge(null);
        setError("");
        setView("results");
        window.scrollTo({ top: 0, behavior: "smooth" });
        return {
          attendeeCount: normalized.attendees.length,
          recommendationCount: result.recommendations.length,
          eventOverview: result.eventAnalysis.overview,
          mode: result.mode,
        };
      },
    }, { signal: lifecycle.signal });
    void Promise.resolve(registration).catch(() => undefined);
    return () => lifecycle.abort();
  }, []);

  const updateCompany = (key: keyof CompanyContext, value: string) => {
    setCompany((current) => ({ ...current, [key]: value }));
    setError("");
  };
  const updateObjective = (key: keyof ConferenceObjective, value: string) => {
    setObjective((current) => ({ ...current, [key]: value }));
    setError("");
  };

  const handleFile = async (file?: File) => {
    if (!file) return;
    setCsvError("");
    if (file.size > 3_000_000) {
      setCsvResult({ attendees: [], rejected: [] });
      setCsvError("This file is over 3 MB. Use a smaller CSV for this prototype.");
      return;
    }
    try {
      const text = await file.text();
      const result = normalizeCsv(text);
      if (!result.attendees.length) throw new Error("No people with identifiable names were found in the CSV.");
      setCsvResult(result);
      setCsvFileName(file.name);
      setError("");
      toast.success(`${result.attendees.length} attendees identified`);
    } catch (fileError) {
      setCsvResult({ attendees: [], rejected: [] });
      setCsvFileName(file.name);
      setCsvError(fileError instanceof Error ? fileError.message : "The CSV could not be parsed.");
    }
  };

  const handleNetworkFile = async (file?: File) => {
    if (!file) return;
    setNetworkError("");
    if (file.size > 3_000_000) {
      setNetworkCsvResult(emptyNetworkNormalizeResult);
      setNetworkError("This file is over 3 MB. Use a smaller CSV.");
      return;
    }
    try {
      const text = await file.text();
      const result = normalizeNetworkCsv(text);
      if (!result.contacts.length) throw new Error("No network contacts with identifiable names were found.");
      setNetworkCsvResult(result);
      setNetworkCsvFileName(file.name);
      toast.success(`${result.contacts.length} network contacts identified`);
    } catch (fileError) {
      setNetworkCsvResult(emptyNetworkNormalizeResult);
      setNetworkCsvFileName(file.name);
      setNetworkError(fileError instanceof Error ? fileError.message : "The network CSV could not be parsed.");
    }
  };

  const validateBrief = () => {
    if (!companyReady) return "Add the company name and a one-line company description.";
    if (!objectiveReady) return "Describe the primary conference objective in specific terms.";
    if (attendeeMode === "closed") return "Closed-platform import is coming soon. Use CSV or text copy/paste in this prototype.";
    if (!attendeesReady) {
      return attendeeMode === "csv"
        ? "Upload a CSV containing at least one identifiable attendee."
        : "No attendees were detected. Try one person per line or paste a table with names.";
    }
    return "";
  };

  const buildHitList = async () => {
    const validationError = validateBrief();
    if (validationError) {
      setError(validationError);
      return;
    }
    setError("");
    setIsAnalyzing(true);
    const context: AnalysisContext = { company, objective, attendees: activeResult.attendees };
    try {
      const result = await postAnalysis<RankingResult>({ action: "rank", context });
      setRanking(result);
      setAnalysisContext(context);
      setAnalysisNetworkContacts(activeNetworkResult.contacts);
      setChallenge(null);
      setMeetingPrep(null);
      setMeetingPrepError("");
      setView("results");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "The analysis failed. Please retry.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const challengeRanking = async () => {
    if (!analysisContext || !ranking || !ranking.recommendations.length) return;
    setIsChallenging(true);
    setError("");
    try {
      const result = await postAnalysis<ChallengeResult>({
        action: "challenge",
        context: analysisContext,
        recommendations: ranking.recommendations,
      });
      setChallenge(result);
      window.setTimeout(() => document.getElementById("challenge")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "The ranking critique failed. Please retry.");
    } finally {
      setIsChallenging(false);
    }
  };

  const draftOutreach = async (recommendation: Recommendation) => {
    if (!analysisContext) return;
    setSelectedRecommendation(recommendation);
    setOutreach(null);
    setOutreachOpen(true);
    setIsDrafting(true);
    try {
      const result = await postAnalysis<OutreachResult>({
        action: "outreach",
        context: analysisContext,
        recommendation,
        attendeeId: recommendation.attendeeId,
      });
      setOutreach(result);
    } catch (requestError) {
      toast.error(requestError instanceof Error ? requestError.message : "The outreach draft failed. Please retry.");
    } finally {
      setIsDrafting(false);
    }
  };

  const prepareForMeeting = async (recommendation: Recommendation, warmPath?: WarmPath) => {
    if (!analysisContext) return;
    const attendee = analysisContext.attendees.find((item) => item.id === recommendation.attendeeId);
    if (!attendee) return;
    const requestId = meetingPrepRequestRef.current + 1;
    meetingPrepRequestRef.current = requestId;
    setSelectedPrepRecommendation(recommendation);
    setMeetingPrep(null);
    setMeetingPrepError("");
    setMeetingPrepOpen(true);
    setIsPreparingMeeting(true);
    try {
      const result = await postAnalysis<MeetingPrepResult>({
        action: "meeting_prep",
        context: {
          company: analysisContext.company,
          objective: analysisContext.objective,
          attendee,
        },
        recommendation,
        attendeeId: recommendation.attendeeId,
        ...(warmPath ? { warmPath } : {}),
      });
      if (meetingPrepRequestRef.current === requestId) setMeetingPrep(result);
    } catch (requestError) {
      if (meetingPrepRequestRef.current === requestId) {
        setMeetingPrepError(requestError instanceof Error ? requestError.message : "Meeting prep could not be generated. Please retry.");
      }
    } finally {
      if (meetingPrepRequestRef.current === requestId) setIsPreparingMeeting(false);
    }
  };

  const copyOutreach = async () => {
    if (!outreach?.message) return;
    try {
      await navigator.clipboard.writeText(outreach.message);
      toast.success("Outreach copied");
    } catch {
      toast.error("Could not access the clipboard. Select the message and copy it manually.");
    }
  };

  const copyHitList = async () => {
    if (!analysisContext || !ranking) return;
    try {
      await navigator.clipboard.writeText(buildHitListText(
        analysisContext.attendees,
        recommendationsForExport,
        ranking.eventAnalysis,
      ));
      toast.success("Hit list copied");
    } catch {
      toast.error("Could not access the clipboard. Try again or use Download CSV.");
    }
  };

  const attendeeMap = useMemo(
    () => new Map((analysisContext?.attendees ?? []).map((attendee) => [attendee.id, attendee])),
    [analysisContext],
  );
  const warmPathsByAttendee = new Map(
    findWarmPaths(analysisContext?.attendees ?? [], analysisNetworkContacts)
      .map((path) => [path.attendeeId, path]),
  );
  const recommendationsForExport = (ranking?.recommendations ?? []).map((recommendation) => {
    const warmPath = warmPathsByAttendee.get(recommendation.attendeeId);
    return warmPath
      ? { ...recommendation, suggestedAngle: warmSuggestedAngle(warmPath) }
      : recommendation;
  });
  const grouped = useMemo(() => {
    const groups: Record<RecommendationTier, Recommendation[]> = { must_meet: [], worth_meeting: [], wildcard: [] };
    ranking?.recommendations.forEach((recommendation) => groups[recommendation.tier].push(recommendation));
    return groups;
  }, [ranking]);
  const hitListCsvHref = (() => {
    if (!analysisContext || !ranking) return "";
    const csv = buildHitListCsv(analysisContext.attendees, recommendationsForExport);
    return `data:text/csv;charset=utf-8,${encodeURIComponent(`\uFEFF${csv}`)}`;
  })();
  const selectedAttendee = selectedRecommendation ? attendeeMap.get(selectedRecommendation.attendeeId) : null;
  const selectedPrepAttendee = selectedPrepRecommendation ? attendeeMap.get(selectedPrepRecommendation.attendeeId) : null;

  return (
    <main className="min-h-screen bg-background text-foreground">
      <Toaster position="bottom-right" />
      <header className="topbar">
        <button className="wordmark" type="button" onClick={() => { setView("brief"); window.scrollTo({ top: 0 }); }} aria-label="Conference Copilot home">
          <span className="wordmark-product">Conference Copilot</span>
        </button>
        <p className="topbar-note">Internal prototype · Session data only</p>
      </header>

      <div className={`workspace-shell ${view === "results" ? "results-shell" : ""}`}>
        <WorkflowRail view={view} />

        {view === "brief" ? (
          <section className="brief-panel" aria-labelledby="brief-title">
            <div className="section-intro">
              <h2 id="brief-title">Tell us what matters for this event.</h2>
              <p>Clear specifics create a sharper list. Leave unknown details blank.</p>
            </div>

            <form className="brief-form" onSubmit={(event) => { event.preventDefault(); void buildHitList(); }}>
              <section className="form-section" aria-labelledby="company-heading">
                <div className="section-marker">
                  <span>01</span>
                  <div><h3 id="company-heading">Tell us about your company</h3></div>
                </div>
                <div className="form-grid two-columns">
                  <Field label="Company name"><Input value={company.name} onChange={(event) => updateCompany("name", event.target.value)} placeholder="e.g. Northstar Materials" /></Field>
                  <Field label="Stage"><Input value={company.stage} onChange={(event) => updateCompany("stage", event.target.value)} placeholder="e.g. Pre-seed, raising" /></Field>
                </div>
                <Field label="One-line description"><Input value={company.description} onChange={(event) => updateCompany("description", event.target.value)} placeholder="What the company does, for whom, and why it is different" /></Field>
                <div className="form-grid two-columns">
                  <Field label="Geography / markets"><Input value={company.geography} onChange={(event) => updateCompany("geography", event.target.value)} placeholder="e.g. Nordics now, DACH next" /></Field>
                  <Field label="Fundraising context"><Input value={company.fundraising} onChange={(event) => updateCompany("fundraising", event.target.value)} placeholder="e.g. Raising €1.5m pre-seed" /></Field>
                </div>
                <Field label="Customer / commercial context"><Textarea value={company.commercial} onChange={(event) => updateCompany("commercial", event.target.value)} rows={3} placeholder="Traction, target customers, active conversations, or commercial gaps" /></Field>
                <Field label="Additional relevant context"><Textarea value={company.additional} onChange={(event) => updateCompany("additional", event.target.value)} rows={3} placeholder="Anything else that should shape the ranking" /></Field>
              </section>

              <section className="form-section" aria-labelledby="goal-heading">
                <div className="section-marker">
                  <span>02</span>
                  <div><h3 id="goal-heading">What do you want from this conference?</h3></div>
                </div>
                <div className="form-grid two-columns">
                  <Field label="Primary objective">
                    <Select value={objective.primary} onValueChange={(value) => updateObjective("primary", value)}>
                      <SelectTrigger className="w-full" aria-label="Primary objective"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="fundraising">Fundraising</SelectItem><SelectItem value="customers">Customers</SelectItem>
                        <SelectItem value="partnerships">Partnerships</SelectItem><SelectItem value="hiring">Hiring</SelectItem>
                        <SelectItem value="advisors">Advisors / experts</SelectItem><SelectItem value="network">General network</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="Secondary objective"><Input value={objective.secondary} onChange={(event) => updateObjective("secondary", event.target.value)} placeholder="Optional" /></Field>
                </div>
                <Field label="Describe the outcome you want" hint="Include useful constraints such as ticket size, geography, sector, buyer type, or timing.">
                  <Textarea value={objective.details} onChange={(event) => updateObjective("details", event.target.value)} rows={4} placeholder="We are raising a €1.5m pre-seed round and want to meet European climate investors who invest €300k–€2m and understand hardware-enabled businesses." />
                </Field>
                <div className="form-grid two-columns">
                  <Field label="Especially valuable to meet"><Textarea value={objective.valuable} onChange={(event) => updateObjective("valuable", event.target.value)} rows={3} placeholder="Signals, roles, or organizations to prioritize" /></Field>
                  <Field label="Deprioritize"><Textarea value={objective.deprioritize} onChange={(event) => updateObjective("deprioritize", event.target.value)} rows={3} placeholder="People unlikely to help with this goal" /></Field>
                </div>
              </section>

              <section className="form-section" aria-labelledby="attendee-heading">
                <div className="section-marker">
                  <span>03</span>
                  <div><h3 id="attendee-heading">Add the attendee list</h3></div>
                </div>
                <Tabs value={attendeeMode} onValueChange={(value) => { setAttendeeMode(value as AttendeeMode); setError(""); }} className="input-tabs">
                  <TabsList variant="line" className="mb-4">
                    <TabsTrigger value="csv"><Upload /> Upload CSV</TabsTrigger>
                    <TabsTrigger value="paste"><FileText /> Text copy/paste</TabsTrigger>
                    <TabsTrigger value="closed"><Lock /> Closed platform <span className="tab-soon">Soon</span></TabsTrigger>
                  </TabsList>
                  <TabsContent value="csv">
                    <input ref={fileInputRef} className="sr-only" type="file" accept=".csv,text/csv" onChange={(event) => void handleFile(event.target.files?.[0])} />
                    <button className={`upload-zone ${csvFileName && !csvError ? "upload-loaded" : ""}`} type="button" onClick={() => fileInputRef.current?.click()} aria-label={csvFileName ? `Replace CSV file ${csvFileName}` : "Choose a CSV file"}>
                      {csvFileName && !csvError ? <Check aria-hidden="true" /> : <Upload aria-hidden="true" />}
                      <span className="upload-title">{csvFileName || "Choose a CSV file"}</span>
                      <span>{csvFileName && !csvError ? "File parsed. Choose again to replace it." : "Column names can vary; we’ll infer what they mean."}</span>
                    </button>
                  </TabsContent>
                  <TabsContent value="paste">
                    <Textarea value={attendeeText} onChange={(event) => { setAttendeeText(event.target.value); setError(""); }} rows={8} className="attendee-textarea" aria-label="Copied attendee text" placeholder={"Paste names, companies, roles, copied tables, or visible profile text here…\n\nExample:\nMaya Chen — Partner, Northline Ventures — climate, industrial tech\nJon Bell | Procurement Director | Arc Foods"} />
                  </TabsContent>
                  <TabsContent value="closed">
                    <ClosedPlatformComingSoon onChooseMode={setAttendeeMode} />
                  </TabsContent>
                </Tabs>

                {csvError && attendeeMode === "csv" ? <div className="inline-error" role="alert"><strong>CSV could not be parsed.</strong><span>{csvError}</span></div> : null}
                {attendeeMode === "paste" && attendeeText.trim() && !pasteResult.attendees.length ? (
                  <div className="inline-error" role="alert"><strong>No attendees detected.</strong><span>Try one person per line, or paste a table with a Name column.</span></div>
                ) : null}
                {activeResult.attendees.length ? (
                  <div className="identified-status" aria-live="polite">
                    <span className="identified-count">{activeResult.attendees.length}</span>
                    <span><strong>attendees identified</strong>{activeResult.rejected.length ? ` · ${activeResult.rejected.length} rows skipped` : ""}</span>
                  </div>
                ) : null}

                <div className="network-input-block" aria-labelledby="network-heading">
                  <div className="network-input-heading">
                    <h4 id="network-heading">Add your network (optional)</h4>
                    <p>Only add people you know. To show a warm path, use <strong>Connector → Target</strong> or CSV columns such as <strong>Connector</strong> and <strong>Target attendee</strong>.</p>
                  </div>
                  <Tabs value={networkMode} onValueChange={(value) => { setNetworkMode(value as NetworkMode); setNetworkError(""); }} className="input-tabs network-input-tabs">
                    <TabsList variant="line" className="mb-4">
                      <TabsTrigger value="paste"><FileText /> Paste network</TabsTrigger>
                      <TabsTrigger value="csv"><Upload /> Upload network CSV</TabsTrigger>
                    </TabsList>
                    <TabsContent value="paste">
                      <Textarea
                        value={networkText}
                        onChange={(event) => { setNetworkText(event.target.value); setNetworkError(""); }}
                        rows={5}
                        className="network-textarea"
                        aria-label="Network relationships"
                        placeholder={"One explicit introduction path per line:\nElin Sjöberg -> Anna Berg\nOskar Lund -> Mikael Holm\n\nOr paste a table with Connector and Target attendee columns."}
                      />
                    </TabsContent>
                    <TabsContent value="csv">
                      <input ref={networkFileInputRef} className="sr-only" type="file" accept=".csv,text/csv" onChange={(event) => void handleNetworkFile(event.target.files?.[0])} />
                      <button className={`upload-zone network-upload-zone ${networkCsvFileName && !networkError ? "upload-loaded" : ""}`} type="button" onClick={() => networkFileInputRef.current?.click()} aria-label={networkCsvFileName ? `Replace network CSV file ${networkCsvFileName}` : "Choose a network CSV file"}>
                        {networkCsvFileName && !networkError ? <Check aria-hidden="true" /> : <Upload aria-hidden="true" />}
                        <span className="upload-title">{networkCsvFileName || "Choose a network CSV file"}</span>
                        <span>Use explicit Connector and Target attendee columns for warm paths.</span>
                      </button>
                    </TabsContent>
                  </Tabs>
                  {networkError && networkMode === "csv" ? <div className="inline-error" role="alert"><strong>Network CSV could not be parsed.</strong><span>{networkError}</span></div> : null}
                  {networkMode === "paste" && networkText.trim() && !networkPasteResult.contacts.length ? (
                    <div className="inline-error" role="alert"><strong>{networkPasteResult.rejected[0]?.reason?.includes("limited") ? "Network input is too large." : "No network relationships detected."}</strong><span>{networkPasteResult.rejected[0]?.reason ?? "Use one “Connector → Target attendee” relationship per line."}</span></div>
                  ) : null}
                  {activeNetworkResult.contacts.length ? (
                    <div className="identified-status network-status" aria-live="polite">
                      <span className="identified-count">{activeNetworkResult.contacts.length}</span>
                      <span><strong>network records identified</strong>{activeNetworkResult.rejected.length ? ` · ${activeNetworkResult.rejected.length} rows skipped` : ""}</span>
                    </div>
                  ) : null}
                </div>
              </section>

              {error ? <div className="form-error" role="alert"><strong>Before we analyze</strong><span>{error}</span></div> : null}
              <button className="sr-only" type="submit">Build my hit list</button>
            </form>
          </section>
        ) : (
          <section className="results-panel" aria-labelledby="results-title">
            <header className="results-header">
              <div>
                <p className="eyebrow">Who should I prioritize?</p>
                <h2 id="results-title">Your hit list</h2>
              </div>
              <div className="results-header-side">
                <p>
                  Prioritized for {objectiveLabels[objective.primary]?.toLowerCase() ?? objective.primary} based only on the brief and attendee data you supplied.
                </p>
                <div className="export-actions" aria-label="Export hit list">
                  <Button variant="outline" size="sm" asChild>
                    <a href={hitListCsvHref} download="conference-copilot-hit-list.csv" onClick={() => toast.success("CSV downloaded")}><Download /> Download CSV</a>
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => void copyHitList()}><Clipboard /> Copy list</Button>
                </div>
              </div>
            </header>

            {error ? <div className="form-error results-error" role="alert"><strong>Something went wrong</strong><span>{error}</span></div> : null}

            {ranking ? <EventAnalysisSection analysis={ranking.eventAnalysis} /> : null}

            {ranking && !ranking.recommendations.length ? (
              <div className="no-recommendations" role="status">
                <p className="eyebrow">Individual hit list</p>
                <h2>No profiles cleared the evidence bar</h2>
                <p>Use the event strategy above, then verify more attendee detail before committing scarce meeting time.</p>
              </div>
            ) : null}

            <div className="tier-groups">
              {(["must_meet", "worth_meeting", "wildcard"] as RecommendationTier[]).map((tier) => {
                const recommendations = grouped[tier];
                if (!recommendations.length) return null;
                const detail = tierDetails[tier];
                return (
                  <section className={`tier-section tier-${tier}`} key={tier} aria-labelledby={`tier-${tier}`}>
                    <header className="tier-header">
                      <span>{detail.number}</span>
                      <div><h2 id={`tier-${tier}`}>{detail.label}</h2><p>{detail.description}</p></div>
                      <span className="tier-count">{recommendations.length}</span>
                    </header>
                    <div className="recommendation-list">
                      {recommendations.map((recommendation, index) => {
                        const attendee = attendeeMap.get(recommendation.attendeeId);
                        const warmPath = warmPathsByAttendee.get(recommendation.attendeeId);
                        return attendee ? (
                          <RecommendationCard
                            key={recommendation.attendeeId}
                            attendee={attendee}
                            recommendation={recommendation}
                            index={index}
                            onOutreach={draftOutreach}
                            onPrepare={prepareForMeeting}
                            warmPath={warmPath}
                          />
                        ) : null;
                      })}
                    </div>
                  </section>
                );
              })}
            </div>

            {ranking?.recommendations.length ? <section id="challenge" className="challenge-section" aria-labelledby="challenge-title">
              {!challenge && !isChallenging ? (
                <div className="challenge-intro">
                  <div><p className="eyebrow">Second pass</p><h2 id="challenge-title">Review the ranking</h2><p>Check obvious choices, overlooked attendees, and one possible wildcard before deciding.</p></div>
                  <Button size="lg" onClick={() => void challengeRanking()}>Challenge my list <RotateCcw /></Button>
                </div>
              ) : isChallenging ? (
                <div className="challenge-loading" aria-live="polite">
                  <Skeleton className="h-4 w-28" /><Skeleton className="h-9 w-3/5" /><Skeleton className="h-24 w-full" />
                  <span>Reviewing assumptions and missed profiles…</span>
                </div>
              ) : challenge ? (
                <div className="challenge-results">
                  <header><div><p className="eyebrow">Ranking review</p><h2 id="challenge-title">Review the alternatives</h2></div><Button variant="outline" size="sm" onClick={() => void challengeRanking()}><RotateCcw /> Run again</Button></header>
                  <div className="challenge-grid">
                    <div><h3>Possibly overrated</h3>{challenge.possiblyOverrated.length ? challenge.possiblyOverrated.map((item) => <article key={item.attendeeId}><strong>{attendeeMap.get(item.attendeeId)?.name ?? "Unknown attendee"}</strong><p>{item.reason}</p></article>) : <p className="empty-challenge">No defensible overrated call from the current evidence.</p>}</div>
                    <div><h3>People I may have missed</h3>{challenge.peopleMissed.length ? challenge.peopleMissed.map((item) => <article key={item.attendeeId}><strong>{attendeeMap.get(item.attendeeId)?.name ?? "Unknown attendee"}</strong><p>{item.reason}</p></article>) : <p className="empty-challenge">The shortlist already covers the strongest supplied profiles.</p>}</div>
                    <div><h3>Wildcard</h3>{challenge.wildcard ? <article><strong>{attendeeMap.get(challenge.wildcard.attendeeId)?.name ?? "Unknown attendee"}</strong><p>{challenge.wildcard.reason}</p><p className="potential-unlock"><span>Potential unlock</span>{challenge.wildcard.potentialUnlock}</p></article> : <p className="empty-challenge">There is not enough evidence for a credible additional wildcard.</p>}</div>
                  </div>
                  <p className="decision-reminder">Use the ranking as a starting point. You make the final decision.</p>
                </div>
              ) : null}
            </section> : null}

            {analysisContext && ranking ? <ExploreRoom context={analysisContext} recommendations={ranking.recommendations} /> : null}
          </section>
        )}

        <aside className="action-rail" aria-label={view === "brief" ? "Analysis summary" : "Hit list summary"}>
          {view === "brief" ? (
            <div className="action-card">
              <p className="eyebrow">Brief status</p>
              <div className="readiness-row"><span>Company context</span><span className={companyReady ? "ready-label" : "pending-label"}>{companyReady ? "Ready" : "Needed"}</span></div>
              <div className="readiness-row"><span>Conference goal</span><span className={objectiveReady ? "ready-label" : "pending-label"}>{objectiveReady ? "Ready" : "Needed"}</span></div>
              <div className="readiness-row"><span>Attendees</span><span className={attendeesReady ? "ready-label" : "pending-label"}>{activeResult.attendees.length} found</span></div>
              <Button size="lg" className="build-button" type="button" onClick={() => void buildHitList()} disabled={isAnalyzing}>
                {isAnalyzing ? <><Loader2 className="spin" /> Building your list…</> : <>Build my hit list <ArrowRight /></>}
              </Button>
              <p className="privacy-copy">Nothing is saved by the app.</p>
            </div>
          ) : (
            <div className="action-card result-actions">
              <p className="eyebrow">Current analysis</p>
              <div className="readiness-row"><span>Recommendations</span><strong>{ranking?.recommendations.length ?? 0}</strong></div>
              <div className="readiness-row"><span>Attendees reviewed</span><strong>{analysisContext?.attendees.length ?? 0}</strong></div>
              <Button variant="outline" className="edit-button" onClick={() => { setView("brief"); setError(""); window.scrollTo({ top: 0, behavior: "smooth" }); }}><ArrowLeft /> Edit brief</Button>
              {!challenge && ranking?.recommendations.length ? <Button className="build-button" onClick={() => void challengeRanking()} disabled={isChallenging}>Challenge my list <RotateCcw /></Button> : null}
            </div>
          )}
        </aside>
      </div>

      <Dialog open={outreachOpen} onOpenChange={setOutreachOpen}>
        <DialogContent className="outreach-dialog">
          <DialogHeader>
            <p className="eyebrow">Draft outreach</p>
            <DialogTitle>{selectedAttendee ? `Message ${selectedAttendee.name}` : "Outreach message"}</DialogTitle>
            <DialogDescription>Built only from the company brief, objective, and supplied attendee information.</DialogDescription>
          </DialogHeader>
          {isDrafting ? (
            <div className="outreach-loading" aria-live="polite"><Loader2 className="spin" /><span>Drafting outreach…</span></div>
          ) : outreach ? (
            <>
              {outreach.personalization === "limited" ? <div className="limited-note"><strong>Limited personalization</strong><span>More detail about {outreach.missingInformation.join(", ")} would make this more specific.</span></div> : null}
              <Textarea className="outreach-message" value={outreach.message} readOnly rows={8} aria-label="Outreach draft" />
              <div className="message-meta"><span>{outreach.message.trim().split(/\s+/).length} words</span></div>
              <DialogFooter>
                <Button variant="outline" onClick={() => selectedRecommendation && void draftOutreach(selectedRecommendation)}><RotateCcw /> Redraft</Button>
                <Button onClick={() => void copyOutreach()}><Clipboard /> Copy message</Button>
              </DialogFooter>
            </>
          ) : (
            <div className="inline-error"><strong>Draft unavailable</strong><span>Close this window and try again.</span></div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={meetingPrepOpen}
        onOpenChange={(open) => {
          setMeetingPrepOpen(open);
          if (!open) {
            meetingPrepRequestRef.current += 1;
            setIsPreparingMeeting(false);
          }
        }}
      >
        <DialogContent className="outreach-dialog meeting-prep-dialog">
          <DialogHeader>
            <p className="eyebrow">Meeting prep</p>
            <DialogTitle>{selectedPrepAttendee ? `Prepare for ${selectedPrepAttendee.name}` : "Meeting brief"}</DialogTitle>
            <DialogDescription>Built from the company brief, conference goal, attendee information, and any path supported by the network data you supplied.</DialogDescription>
          </DialogHeader>
          {isPreparingMeeting ? (
            <div className="outreach-loading" aria-live="polite"><Loader2 className="spin" /><span>Preparing meeting brief…</span></div>
          ) : meetingPrep ? (
            <dl className="meeting-prep-grid">
              <div><dt>Why this meeting</dt><dd>{meetingPrep.whyThisMeeting}</dd></div>
              <div><dt>Lead with</dt><dd>{meetingPrep.leadWith}</dd></div>
              <div><dt>Ask this</dt><dd>{meetingPrep.askThis}</dd></div>
              <div><dt>Listen for</dt><dd>{meetingPrep.listenFor}</dd></div>
              <div><dt>Don&apos;t waste time on</dt><dd>{meetingPrep.dontWasteTimeOn}</dd></div>
              <div><dt>Desired next step</dt><dd>{meetingPrep.desiredNextStep}</dd></div>
            </dl>
          ) : meetingPrepError ? (
            <>
              <div className="inline-error" role="alert"><strong>Meeting prep unavailable</strong><span>{meetingPrepError}</span></div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => selectedPrepRecommendation && void prepareForMeeting(
                    selectedPrepRecommendation,
                    warmPathsByAttendee.get(selectedPrepRecommendation.attendeeId),
                  )}
                >
                  <RotateCcw /> Try again
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </main>
  );
}
