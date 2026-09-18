/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  BarChart3,
  Bot,
  Boxes,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  ExternalLink,
  Gauge,
  Inbox,
  Layers3,
  LogOut,
  MessageCircle,
  Package,
  RefreshCw,
  Route,
  ShieldCheck,
  Settings,
  ShoppingCart,
  Truck,
  UsersRound,
  Warehouse,
  X,
  Zap,
} from "lucide-react";

type Role = "ADMIN" | "MANAGER" | "STAFF" | "READ_ONLY";
type SectionKey =
  | "home"
  | "customer-operations"
  | "orders-checkout"
  | "fulfillment"
  | "inventory-suppliers"
  | "agents-automations"
  | "analytics";

type CaseItem = {
  id: string;
  title?: string;
  case_number?: string;
  case_type?: string;
  customer_name?: string;
  customer?: string;
  order_number?: string;
  order?: string;
  priority?: string;
  status?: string;
  summary?: string;
  what_happened?: string;
  why_here?: string;
  why_is_this_here?: string;
  why_this_person_sees_it?: string;
  owner_scope?: string;
  owner?: string;
  queue_name?: string;
  assignee_name?: string;
  requires_human?: boolean;
  recommended_action?: string;
  proposed_side_effect?: string;
  human_work_status?: "NEW" | "IN_PROGRESS" | "WAITING" | "RESOLVED" | string;
  human_work?: {status?: string; waiting_reason?: string | null};
  approval_status?: string;
  approval_state?: string;
  due_state?: string;
  age?: string;
  due_at?: string;
  evidence?: Record<string, unknown>;
  context?: {
    case_type?: string;
    priority?: string;
    source?: string;
    source_reference?: string;
  };
  twenty_id?: string | null;
  product_outcome?: string;
  source?: string;
};

type DeepLink = {
  key: "TWENTY" | "WOO" | "CHATWOOT";
  label: string;
  href?: string;
  status: string;
  reason: string;
  referenceOnly: boolean;
  target: string;
};
type ReadReference = {
  available: boolean;
  data?: any;
  error?: string;
  source: string;
};
type TimelineEntry = {
  title?: string;
  summary?: string;
  occurred_at?: string;
  source_of_truth?: string;
};
type CaseContext = CaseItem & {
  communications?: Array<Record<string, unknown>>;
  timeline?: TimelineEntry[];
  routing_history?: Array<Record<string, unknown>>;
  assignments?: Array<Record<string, unknown>>;
  order_context?: Record<string, any> | null;
  source_of_truth?: string;
  execution?: string;
  case_packet?: any;
  human_decision?: any;
};

type OperationsPayload = {
  contract: string;
  generatedAt: string;
  environment: string;
  humanWork: CaseItem[];
  humanWorkMetrics: any;
  runtime?: {git_sha?: string; build_id?: string; build_timestamp?: string; environment?: string; api_version?: string} | null;
  operationalAttention: {
    state: string;
    label: string;
    detail: string;
    jobs?: Array<{ name: string; state: string; detail: string }>;
  };
  orders: {
    items: Array<Record<string, any>>;
    source: string;
    operationalStore: string;
    execution: string;
  };
  viewer?: {
    displayName: string;
    role: Role;
    identitySource: string;
    capabilities: {
      readConsequentialDecisionContext: boolean;
      decideConsequentialIntent: boolean;
    };
  };
  monitoring: {
    sourceHealth: Array<{
      key: string;
      label: string;
      state: string;
      detail: string;
      source: string;
    }>;
    jobHealth: Array<{ name: string; state: string; detail: string }>;
    conditions: Array<{
      label: string;
      state: string;
      detail: string;
      source: string;
    }>;
    projection: any;
  };
  commandCenter: {
    source: string;
    readOnly: boolean;
    home: ReadReference;
    orders: ReadReference;
    inventory: ReadReference;
    supplierOps: ReadReference;
    paymentMethods: ReadReference;
    reviewFunnel: ReadReference;
    chatwootReference: ReadReference;
    analytics: any;
    processorState: ReadReference;
    checkout: { status: string; detail: string };
  };
  customerOperations: {
    cases: CaseItem[];
    automationWork: AutomationWork[];
  };
  fulfillment: {
    cases: CaseItem[];
    orders: Array<Record<string, any>>;
    source: string;
  };
  agents: {
    runtime: { name: string; state: string; detail: string; source: string };
    supportPolicy?: {available: boolean; data?: any; error?: string};
    work: AutomationWork[];
    reviewFunnel: ReadReference;
    jobHealth: Array<{ name: string; state: string; detail: string }>;
    projectionAttempts: Array<{
      id: string;
      job_id: string;
      entity_type: string;
      source_event_id: string;
      attempt_number: number;
      outcome: string;
      error?: string;
      occurred_at: string;
    }>;
    execution: string;
  };
  links: DeepLink[];
  source: string;
  synthetic: boolean;
  execution: string;
};

type AutomationWork = {
  id: string;
  customer_name?: string;
  order_number?: string;
  case_number?: string;
  case_type?: string;
  status?: string;
  summary?: string;
  requires_human?: boolean;
  input: string;
  inputSource: string;
  handler: string;
  contextUsed: string[];
  recommendation: string;
  proposedAction: string;
  currentState: string;
  outcome: "AI_AUTOMATED" | "HUMAN_REQUIRED" | "WAITING_ON_CUSTOMER" | "FAILED_AUTOMATION" | string;
  product_outcome?: "Resolved automatically" | "Waiting on customer" | "Needs Human" | "Failed automation" | string;
  case_packet?: any;
  humanRequired: boolean;
  sourceOfTruth: string;
  execution: string;
};

function outcomeTone(work: {product_outcome?: string; outcome?: string}): "success" | "signal" | "danger" | "brand" {
  const o = String(work.product_outcome || work.outcome || "").toUpperCase();
  if (o.includes("RESOLVED") || o === "AI_AUTOMATED") return "success";
  if (o.includes("WAITING") || o === "WAITING_ON_CUSTOMER") return "signal";
  if (o.includes("FAILED") || o === "FAILED_AUTOMATION") return "danger";
  return "brand";
}

function outcomeLabel(work: {product_outcome?: string; outcome?: string}): string {
  if (work.product_outcome) return work.product_outcome;
  const o = String(work.outcome || "").toUpperCase();
  if (o === "AI_AUTOMATED") return "Resolved automatically";
  if (o === "WAITING_ON_CUSTOMER") return "Waiting on customer";
  if (o === "FAILED_AUTOMATION") return "Failed automation";
  return "Needs Human";
}

const sectionItems: Array<{
  key: SectionKey;
  label: string;
  description: string;
  icon: ReactNode;
}> = [
  {
    key: "customer-operations",
    label: "Human Work",
    description: "Work that needs a person",
    icon: <MessageCircle size={16} />,
  },
  {
    key: "orders-checkout",
    label: "Orders & Checkout",
    description: "Customer and order context",
    icon: <ShoppingCart size={16} />,
  },
  {
    key: "agents-automations",
    label: "Automation Health",
    description: "Failures and work that needs attention",
    icon: <Bot size={16} />,
  },
];

const validSections = new Set(sectionItems.map((item) => item.key));

async function loadOperations(section: SectionKey): Promise<OperationsPayload> {
  const response = await fetch(
    "/api/operations?section=" + encodeURIComponent(section),
    { cache: "no-store" },
  );
  if (!response.ok) throw new Error("Operations read path is unavailable.");
  return response.json();
}

async function loadCaseContext(caseId: string): Promise<CaseContext> {
  const response = await fetch(
    "/api/operations/cases/" + encodeURIComponent(caseId),
    { cache: "no-store" },
  );
  if (!response.ok) throw new Error("Case context is unavailable.");
  return response.json();
}

async function loadOrderContext(orderId: string): Promise<any> {
  const response = await fetch(
    "/api/operations/orders/" + encodeURIComponent(orderId),
    { cache: "no-store" },
  );
  if (!response.ok) throw new Error("Order context is unavailable.");
  return response.json();
}

function humanize(value?: string) {
  return String(value || "—")
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/^./, (value) => value.toUpperCase());
}

function operatorCopy(value: unknown) {
  return String(value || "")
    .replace(/Woo LAB/gi, "the order system")
    .replace(/chatwoot-lab/gi, "Customer support intake")
    .replace(/NO_EXECUTION/g, "No external action")
    .replace(/\bLAB\b/g, "this workspace")
    .replace(/source-backed/gi, "verified");
}

function operatorJobLabel(name: string) {
  const labels: Record<string, string> = {
    "approval-reconciler": "Approval review",
    "customer-reference-sync": "Customer records",
    "twilio-ingestion": "Customer messaging",
    "woo-lab-checkout-catchup": "Order intake",
    "woo-lab-automatic-catchup": "Order intake",
    "woo-read-only-shadow": "Order reference",
    "woocommerce-read-only-shadow": "Order reference",
  };
  return labels[name] || humanize(name);
}

function operatorOutcomeLabel(value?: string) {
  if (!value) return undefined;
  const outcome = value.toUpperCase().replaceAll(" ", "_");
  if (outcome === "AI_AUTOMATED" || outcome === "RESOLVED_AUTOMATICALLY") return "Resolved automatically";
  if (outcome === "WAITING_ON_CUSTOMER") return "Waiting on customer";
  if (outcome === "FAILED_AUTOMATION" || outcome === "AUTOMATION_FAILED") return "Failed automation";
  if (outcome === "HUMAN_REQUIRED" || outcome === "NEEDS_HUMAN") return "Needs Human";
  return value;
}

function operatorQueueLabel(value?: string) {
  return String(value || "").toUpperCase() === "HUMAN_WORK" ? "Human Work" : value || "Human Work";
}

function operatorWorkState(value?: string) {
  const state = String(value || "NEW").toUpperCase();
  if (state === "WAITING") return "Waiting";
  if (state === "RESOLVED" || state === "CLOSED") return "Resolved";
  return "Open";
}

function customerName(item: CaseItem) {
  return item.customer_name || item.customer || "Customer context pending";
}

function orderNumber(item: CaseItem) {
  return item.order_number || item.order || "Order number pending";
}

function formatTime(value?: string) {
  if (!value) return "Time unavailable";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function formatMoney(value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  const amount = Number(value);
  return Number.isFinite(amount)
    ? new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(amount)
    : "—";
}

function formatRate(value: unknown) {
  const rate = Number(value);
  return Number.isFinite(rate) ? `${(rate * 100).toFixed(1)}%` : "—";
}

function addressText(value: unknown) {
  if (!value || typeof value !== "object") return "Address unavailable";
  const address = value as Record<string, unknown>;
  return [
    address.address_1,
    address.address_2,
    [address.city, address.state].filter(Boolean).join(", "),
    address.postcode,
    address.country,
  ]
    .filter(Boolean)
    .join(" · ");
}

function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "brand" | "signal" | "success" | "danger";
}) {
  const colors = {
    neutral: "border-white/10 bg-white/[0.06] text-slate-300",
    brand: "border-blue-300/25 bg-blue-300/10 text-blue-200",
    signal: "border-amber-300/25 bg-amber-300/10 text-amber-200",
    success: "border-emerald-300/25 bg-emerald-300/10 text-emerald-200",
    danger: "border-rose-300/25 bg-rose-300/10 text-rose-200",
  };
  return (
    <span
      className={
        "inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.13em] " +
        colors[tone]
      }
    >
      {children}
    </span>
  );
}

function SectionHeader({
  eyebrow,
  title,
  description,
  count,
  icon,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  count?: number;
  icon: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
      <div>
        <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em] text-blue-300">
          {icon}
          {eyebrow}
        </div>
        <h1 className="mt-2 text-3xl font-bold tracking-[-0.03em] text-white sm:text-4xl">
          {title}
        </h1>
        {description ? (
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
            {description}
          </p>
        ) : null}
      </div>
      {typeof count === "number" ? (
        <span className="rounded-full border border-white/10 bg-white/[0.06] px-3 py-1 text-sm font-bold text-slate-200">
          {count}
        </span>
      ) : null}
    </div>
  );
}

function Metric({
  label,
  value,
  detail,
  icon,
  tone = "brand",
}: {
  label: string;
  value: string | number;
  detail: string;
  icon: ReactNode;
  tone?: "brand" | "signal" | "success" | "danger";
}) {
  const iconTone =
    tone === "signal" || tone === "danger"
      ? "bg-amber-300/10 text-amber-200"
      : tone === "success"
        ? "bg-emerald-300/10 text-emerald-200"
        : "bg-blue-300/10 text-blue-200";
  return (
    <article className="rounded-2xl border border-white/10 bg-white/[0.055] p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-semibold text-slate-300">{label}</p>
        <span className={"rounded-xl p-2.5 " + iconTone}>{icon}</span>
      </div>
      <p className="mt-5 text-3xl font-bold tracking-tight text-white">
        {value}
      </p>
      <p className="mt-2 text-xs leading-5 text-slate-500">{detail}</p>
    </article>
  );
}

function TechnicalDetails({ children }: { children: ReactNode }) {
  return (
    <details className="rounded-2xl border border-white/10 bg-white/[0.025] px-4 py-3 text-xs text-slate-500">
      <summary className="cursor-pointer list-none font-semibold text-slate-400 marker:hidden">
        Technical details
      </summary>
      <div className="mt-3 border-t border-white/10 pt-3 leading-5">{children}</div>
    </details>
  );
}

function SourceBadge({ state }: { state: string }) {
  const displayState =
    ({
      REFERENCE_ONLY: "UNAVAILABLE",
      FIXTURE: "UNAVAILABLE",
      RECONCILE: "NEEDS ATTENTION",
      "LAB READ-ONLY": "READ-ONLY",
    } as Record<string, string>)[state] || state;
  const tone =
    state === "AVAILABLE" ||
    state === "CLEAR" ||
    state === "IN STOCK" ||
    state === "RESOLVED" ||
    state === "AUTO" ||
    state === "SUCCEEDED"
      ? "success"
      : state === "RECONCILE" ||
          state === "WATCH" ||
          state === "LOW STOCK" ||
          state === "HUMAN REQUIRED" ||
          state === "HUMAN REVIEW" ||
          state === "OWNER APPROVAL" ||
          state === "FAILED"
        ? "signal"
        : state === "ATTENTION" ||
            state === "DOWN" ||
            state === "OUT OF STOCK" ||
            state === "DEAD"
          ? "danger"
          : "neutral";
  return <Badge tone={tone}>{displayState}</Badge>;
}

function SourceHealth({
  items,
}: {
  items: OperationsPayload["monitoring"]["sourceHealth"];
}) {
  const presentation: Record<string, {label: string; detail: string}> = {
    chameleon: {
      label: "Operations data",
      detail: "Cases, assignments, approvals, audit, and routing.",
    },
    "command-center": {
      label: "Commerce data",
      detail: "Commerce, inventory, and supplier information.",
    },
    twenty: {
      label: "Customer records",
      detail: "Additional customer and case context.",
    },
    "kai-openclaw": {
      label: "Support automation",
      detail: "Automation availability and supervised support work.",
    },
  };
  const stateLabel = (state: string) =>
    ({
      AVAILABLE: "Available",
      REFERENCE_ONLY: "Unavailable",
      FIXTURE: "Unavailable",
      RECONCILE: "Needs attention",
    })[state] || humanize(state);
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {items.map((item) => (
        (() => {
          const copy = presentation[item.key] || {
            label: item.label,
            detail: item.detail,
          };
          return (
        <div
          key={item.key}
          className="rounded-2xl border border-white/10 bg-white/[0.04] p-4"
        >
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-bold text-white">{copy.label}</p>
            <SourceBadge state={stateLabel(item.state)} />
          </div>
          <p className="mt-2 text-xs leading-5 text-slate-500">{copy.detail}</p>
          <TechnicalDetails>
            Source: {item.source} · status: {item.state} · {item.detail}
          </TechnicalDetails>
        </div>
          );
        })()
      ))}
    </div>
  );
}

function ReferenceMeta({
  source,
  generatedAt,
  detail = "Read-only reference",
}: {
  source?: string;
  generatedAt?: string | null;
  detail?: string;
}) {
  return (
    <details className="mt-3 text-[10px] uppercase tracking-[0.13em] text-slate-600">
      <summary className="cursor-pointer list-none hover:text-slate-400 marker:hidden">
        Technical details
      </summary>
      <p className="mt-2 normal-case tracking-normal">
        {detail} · source: {source || "unavailable"}
        {generatedAt ? " · as of " + formatTime(generatedAt) : ""}
      </p>
    </details>
  );
}

// Retained presentation only; this legacy area is intentionally not in operator navigation.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function HomeSection({
  payload,
  onSelect,
}: {
  payload: OperationsPayload;
  onSelect: (section: SectionKey) => void;
}) {
  const home = payload.commandCenter.home.data;
  const revenue = home?.summary?.revenue;
  const orders = home?.summary?.orders;
  const analytics = payload.commandCenter.analytics || {};
  const paymentSummary = analytics.paymentMethods?.data?.summary;
  const landingToday = analytics.landingConversions?.data?.today;
  const topProduct = home?.leaders?.topProducts30d?.[0];
  const todayAov = orders?.today ? Number(revenue?.today || 0) / Number(orders.today) : null;
  const conditions = payload.monitoring.conditions.slice(0, 6);
  const workMetrics = payload.humanWorkMetrics || {};
  return (
    <div className="space-y-8">
      <section className="flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
        <div>
          <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.22em] text-blue-300">
            <Activity size={14} /> Operations
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-[-0.04em] text-white sm:text-4xl">
            Today’s work
          </h1>
        </div>
      </section>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          label="AI automated"
          value={formatRate(workMetrics.resolved_without_human_rate)}
          detail="resolved automatically"
          icon={<CheckCircle2 size={18} />}
          tone="success"
        />
        <Metric
          label="Open"
          value={workMetrics.open_human_work ?? payload.humanWork?.length ?? "—"}
          detail="Human Work items"
          icon={<Inbox size={18} />}
          tone="signal"
        />
        <Metric
          label="Waiting"
          value={workMetrics.waiting ?? "—"}
          detail="needs information"
          icon={<AlertTriangle size={18} />}
        />
        <Metric
          label="Resolved today"
          value={workMetrics.resolved_today ?? "—"}
          detail="Human Work items"
          icon={<UsersRound size={18} />}
          tone="success"
        />
      </div>
      <section className="rounded-2xl border border-white/10 bg-white/[0.035] p-5">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
          <div>
            <h2 className="text-xl font-bold text-white">Commerce</h2>
          </div>
          <button
            onClick={() => onSelect("analytics")}
            className="inline-flex items-center gap-1 text-sm font-semibold text-blue-200 hover:text-white"
          >
            Open all analytics <ChevronRight size={15} />
          </button>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric
            label="Paid sales · today"
            value={formatMoney(revenue?.today)}
            detail={String(orders?.today ?? "—") + " paid orders · AOV " + formatMoney(todayAov)}
            icon={<ShoppingCart size={18} />}
            tone="success"
          />
          <Metric
            label="Paid sales · yesterday"
            value={formatMoney(revenue?.yesterday)}
            detail={String(orders?.yesterday ?? "—") + " paid orders · comparison"}
            icon={<Activity size={18} />}
          />
          <Metric
            label="Paid sales · 7d"
            value={formatMoney(revenue?.trailing7d)}
            detail={String(orders?.trailing7d ?? "—") + " paid orders · " + String(orders?.trailing30d ?? "—") + " in 30d"}
            icon={<BarChart3 size={18} />}
          />
          <Metric
            label="Top product · 30d"
            value={topProduct ? formatMoney(topProduct.paidRevenue30d) : "—"}
            detail={topProduct ? String(topProduct.name) + " · " + String(topProduct.quantitySold30d) + " units" : "Product data unavailable"}
            icon={<Package size={18} />}
          />
        </div>
        <div className="mt-4 grid gap-3 lg:grid-cols-3">
          <div className="rounded-xl border border-white/10 bg-black/10 p-4">
            <p className="text-xs font-bold text-white">Payment method mix</p>
            <p className="mt-2 text-sm text-slate-300">
              {paymentSummary ? String(paymentSummary.totalOrders) + " orders · " + formatMoney(paymentSummary.totalRevenue) : "Unavailable"}
            </p>
            <p className="mt-1 text-xs text-slate-500">Card / invoice / ACH mix</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/10 p-4">
            <p className="text-xs font-bold text-white">Release demand</p>
            <p className="mt-2 text-sm text-slate-300">
              {String(analytics.releaseDemand?.data?.waitlist?.length ?? 0)} waitlist records
            </p>
            <p className="mt-1 text-xs text-slate-500">No active release requests</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/10 p-4">
            <p className="text-xs font-bold text-white">Landing conversion · today</p>
            <p className="mt-2 text-sm text-slate-300">
              {landingToday ? String(landingToday.clickRate) + "% click rate · " + String(landingToday.paidOrders) + " paid orders" : "Unavailable"}
            </p>
            <p className="mt-1 text-xs text-slate-500">Current-day conversion signal</p>
          </div>
        </div>
        <ReferenceMeta
          source={analytics.source}
          generatedAt={analytics.generatedAt}
          detail="Derived metrics from connected operational sources"
        />
      </section>
      <section className="flex flex-col justify-between gap-3 rounded-2xl border border-emerald-300/15 bg-emerald-300/[0.05] px-4 py-3.5 sm:flex-row sm:items-center">
        <div className="flex items-center gap-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-300/10 text-emerald-200">
            <Activity size={16} />
          </span>
          <div>
            <p className="text-sm font-bold text-white">
              {payload.operationalAttention.label}
            </p>
            <p className="text-xs text-slate-400">
              {payload.operationalAttention.detail}
            </p>
          </div>
        </div>
        <SourceBadge
          state={
            payload.operationalAttention.state === "LAB"
              ? "READ-ONLY"
              : payload.operationalAttention.state
          }
        />
      </section>
      <section>
        <div className="mb-4 flex items-end justify-between gap-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-blue-300">
              Monitoring
            </p>
            <h2 className="mt-1 text-2xl font-bold text-white">
              Needs attention
            </h2>
          </div>
          <button
            onClick={() => onSelect("agents-automations")}
            className="hidden items-center gap-1 text-sm font-semibold text-blue-200 hover:text-white sm:inline-flex"
          >
            Open automation health <ChevronRight size={15} />
          </button>
        </div>
        <div className="grid gap-3 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="space-y-3">
            {conditions.length ? (
              conditions.map((condition, index) => (
                <div
                  key={condition.label + index}
                  className="flex items-start justify-between gap-4 rounded-2xl border border-white/10 bg-white/[0.04] p-4"
                >
                  <div className="flex gap-3">
                    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-amber-300/10 text-amber-200">
                      <AlertTriangle size={15} />
                    </span>
                    <div>
                      <p className="text-sm font-bold text-white">
                        {condition.label}
                      </p>
                      <p className="mt-1 text-xs leading-5 text-slate-400">
                        {condition.detail}
                      </p>
                    </div>
                  </div>
                  <SourceBadge state={condition.state} />
                </div>
              ))
            ) : (
              <div className="rounded-2xl border border-dashed border-white/10 p-5 text-sm text-slate-500">
                No operational conditions need attention right now.
              </div>
            )}
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
            <div className="mb-4 flex items-center gap-2 text-sm font-bold text-white">
              <RefreshCw size={17} className="text-blue-200" /> Source health
            </div>
            <SourceHealth items={payload.monitoring.sourceHealth} />
          </div>
        </div>
      </section>
      <section>
        <div className="mb-4">
          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-blue-300">
            Operations areas
          </p>
          <h2 className="mt-1 text-2xl font-bold text-white">
            Open an area
          </h2>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {sectionItems
            .filter((item) => item.key !== "home")
            .map((item) => (
              <button
                key={item.key}
                onClick={() => onSelect(item.key)}
                className="group rounded-2xl border border-white/10 bg-white/[0.04] p-5 text-left transition hover:border-blue-300/25 hover:bg-white/[0.07]"
              >
                <div className="flex items-start justify-between gap-4">
                  <span className="rounded-xl bg-blue-300/10 p-2.5 text-blue-200">
                    {item.icon}
                  </span>
                  <ArrowUpRight
                    size={16}
                    className="text-slate-600 transition group-hover:text-blue-200"
                  />
                </div>
                <p className="mt-5 text-base font-bold text-white">
                  {item.label}
                </p>
                <p className="mt-1 text-sm leading-6 text-slate-500">
                  {item.description}
                </p>
              </button>
            ))}
        </div>
      </section>
      <TechnicalDetails>
        API {payload.runtime?.api_version || "unknown"} · build {payload.runtime?.git_sha || "unavailable"} · {payload.runtime?.environment || "unknown"} · source {payload.source} · {payload.execution}
      </TechnicalDetails>
      <section>
        <div className="mb-4">
          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-blue-300">
            Deep links
          </p>
          <h2 className="mt-1 text-2xl font-bold text-white">
            Open the authoritative record
          </h2>
        </div>
        <DeepLinks links={payload.links} />
      </section>
    </div>
  );
}

// Retained presentation only; this legacy area is intentionally not in operator navigation.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function AnalyticsSection({ payload }: { payload: OperationsPayload }) {
  const analytics = payload.commandCenter.analytics || {};
  const home = payload.commandCenter.home.data || {};
  const summary = home.summary || {};
  const revenue = summary.revenue || {};
  const orders = summary.orders || {};
  const salesRows = analytics.salesTrend?.data?.rows || analytics.salesTrend?.data?.data || [];
  const payment = analytics.paymentMethods?.data || {};
  const acquisition = analytics.customerAcquisition?.data?.summary || {};
  const retention = analytics.retention?.summary || {};
  const discovery = analytics.howFoundUs?.data || {};
  const landing = analytics.landingConversions?.data || {};
  const traffic = analytics.traffic || {};
  const trafficSummary = traffic.summary || {};
  const realtime = analytics.realtime || {};
  const trafficAvailable = traffic.available === true;
  const realtimeAvailable = realtime.available === true;
  const weekdayRows = analytics.weekdaySales?.data?.rows || [];
  const topProducts = home.leaders?.topProducts30d || [];
  const chat = analytics.chatwoot?.data?.conversations || [];
  const release = analytics.releaseDemand?.data || {};
  const processor = analytics.processorState?.data || {};
  return (
    <div className="space-y-8">
      <SectionHeader
        eyebrow="Growth & Analytics"
        title="Growth & Analytics"
        count={salesRows.length}
        icon={<BarChart3 size={14} />}
      />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <Metric label="Paid sales · today" value={formatMoney(revenue.today)} detail={String(orders.today ?? "—") + " paid orders"} icon={<ShoppingCart size={18} />} tone="success" />
        <Metric label="Paid sales · yesterday" value={formatMoney(revenue.yesterday)} detail={String(orders.yesterday ?? "—") + " paid orders"} icon={<Activity size={18} />} />
        <Metric label="Paid sales · 7d" value={formatMoney(revenue.trailing7d)} detail={String(orders.trailing7d ?? "—") + " paid orders"} icon={<BarChart3 size={18} />} />
        <Metric label="AOV · today" value={orders.today ? formatMoney(Number(revenue.today || 0) / Number(orders.today)) : "—"} detail="paid revenue / paid orders" icon={<Gauge size={18} />} />
        <Metric label="Sessions · latest day" value={trafficAvailable && trafficSummary.sessions != null ? trafficSummary.sessions : "—"} detail={trafficAvailable ? "Latest available traffic" : "Traffic data unavailable"} icon={<Activity size={18} />} />
        <Metric label="Active users" value={realtimeAvailable && realtime.activeUsers != null ? realtime.activeUsers : "—"} detail={realtimeAvailable ? "Current activity" : "Realtime data unavailable"} icon={<UsersRound size={18} />} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <article className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-blue-300">Sales trend</p>
              <h2 className="mt-1 text-xl font-bold text-white">Paid revenue and order volume</h2>
            </div>
            <Badge>Last 30 days</Badge>
          </div>
          <div className="mt-5 space-y-2">
            {salesRows.slice(-8).map((row: any) => (
              <div key={row.date} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 rounded-xl border border-white/10 px-3 py-2.5">
                <span className="text-sm text-slate-300">{row.date}</span>
                <span className="text-xs text-slate-500">{row.paidOrders} orders</span>
                <span className="text-sm font-semibold text-slate-200">{formatMoney(row.paidRevenue)}</span>
              </div>
            ))}
            {!salesRows.length ? <p className="text-sm text-slate-500">Sales trend is unavailable.</p> : null}
          </div>
        </article>
        <article className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-blue-300">Payment method mix</p>
              <h2 className="mt-1 text-xl font-bold text-white">Paid order composition</h2>
            </div>
            <Badge>Read only</Badge>
          </div>
          <p className="mt-4 text-sm text-slate-400">{payment.summary ? String(payment.summary.totalOrders) + " orders · " + formatMoney(payment.summary.totalRevenue) : "Payment data unavailable"}</p>
          <div className="mt-5 space-y-3">
            {(payment.totals || []).map((row: any) => (
              <div key={row.method} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 px-3 py-3">
                <span className="text-sm font-semibold text-slate-200">{row.method}</span>
                <span className="text-sm text-slate-400">{row.orders} orders · {formatMoney(row.revenue)}</span>
              </div>
            ))}
          </div>
          <ReferenceMeta source={analytics.paymentMethods?.source} detail="Payment method data" />
        </article>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <article className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-blue-300">Acquisition / retention</p>
          <h2 className="mt-1 text-xl font-bold text-white">Who is coming back</h2>
          <div className="mt-5 space-y-3 text-sm">
            <div className="flex justify-between gap-3"><span className="text-slate-400">New customers</span><span className="font-semibold text-white">{acquisition.newCustomers ?? "—"}</span></div>
            <div className="flex justify-between gap-3"><span className="text-slate-400">Returning customers</span><span className="font-semibold text-white">{acquisition.returningCustomers ?? "—"}</span></div>
            <div className="flex justify-between gap-3"><span className="text-slate-400">Returning share</span><span className="font-semibold text-white">{retention.returningSharePct ?? "—"}%</span></div>
            <div className="flex justify-between gap-3"><span className="text-slate-400">Returning revenue</span><span className="font-semibold text-white">{formatMoney(retention.returningRevenue)}</span></div>
          </div>
          <ReferenceMeta source={analytics.customerAcquisition?.source} detail="Customer acquisition data" />
        </article>
        <article className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-blue-300">How found us</p>
          <h2 className="mt-1 text-xl font-bold text-white">Discovery answers</h2>
          <p className="mt-4 text-sm text-slate-400">{discovery.summary ? String(discovery.summary.answeredOrders) + " of " + String(discovery.summary.eligibleOrders) + " eligible orders answered" : "Discovery data unavailable"}</p>
          <div className="mt-5 space-y-3">
            {(discovery.sources || []).map((row: any) => <div key={row.label} className="flex justify-between gap-3 rounded-xl border border-white/10 px-3 py-3"><span className="text-sm text-slate-200">{row.label}</span><span className="text-sm text-slate-400">{row.orders} orders</span></div>)}
          </div>
          <ReferenceMeta source={analytics.howFoundUs?.source} detail="Attribution data" />
        </article>
        <article className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-blue-300">Landing + associate</p>
          <h2 className="mt-1 text-xl font-bold text-white">Demand capture</h2>
          <div className="mt-5 space-y-3 text-sm">
            <div className="flex justify-between gap-3"><span className="text-slate-400">Views · 30d</span><span className="font-semibold text-white">{landing.summary?.views ?? "—"}</span></div>
            <div className="flex justify-between gap-3"><span className="text-slate-400">Shop clicks</span><span className="font-semibold text-white">{landing.summary?.shopClicks ?? "—"}</span></div>
            <div className="flex justify-between gap-3"><span className="text-slate-400">Paid orders</span><span className="font-semibold text-white">{landing.summary?.paidOrders ?? "—"}</span></div>
            <div className="flex justify-between gap-3"><span className="text-slate-400">Associate revenue</span><span className="font-semibold text-white">{formatMoney(analytics.associateProgram?.data?.summary?.attributedRevenue)}</span></div>
          </div>
          <ReferenceMeta source={analytics.landingConversions?.source} detail="Landing conversion data" />
        </article>
      </div>
      <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <article className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-blue-300">Traffic + realtime</p>
              <h2 className="mt-1 text-xl font-bold text-white">Acquisition sources and live shape</h2>
            </div>
            <Badge>{trafficAvailable || realtimeAvailable ? "Connected" : "Unavailable"}</Badge>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-white/10 p-4">
              <p className="text-xs text-slate-500">Latest-day conversion</p>
              <p className="mt-2 text-2xl font-bold text-white">{trafficAvailable && trafficSummary.conversionRatePct != null ? trafficSummary.conversionRatePct + "%" : "—"}</p>
              <p className="mt-1 text-xs text-slate-500">{trafficAvailable ? String(trafficSummary.paidOrders ?? "—") + " paid orders / " + String(trafficSummary.sessions ?? "—") + " sessions" : "Traffic data unavailable"}</p>
            </div>
            <div className="rounded-xl border border-white/10 p-4">
              <p className="text-xs text-slate-500">Realtime funnel</p>
              <p className="mt-2 text-2xl font-bold text-white">{realtimeAvailable && realtime.activeUsers != null ? realtime.activeUsers + " active" : "—"}</p>
              <p className="mt-1 text-xs text-slate-500">{realtimeAvailable && (realtime.funnel || []).length ? realtime.funnel.map((row: any) => (row.stage || row.label) + " " + (row.activeUsers ?? row.users)).join(" · ") : "Realtime data unavailable"}</p>
            </div>
          </div>
          <div className="mt-4 space-y-2">
            {trafficAvailable && (traffic.sources || []).length ? traffic.sources.map((row: any) => <div key={row.source} className="flex justify-between gap-3 rounded-xl border border-white/10 px-3 py-2.5"><span className="text-sm text-slate-200">{row.source}</span><span className="text-xs text-slate-400">{row.sessions} sessions · {row.paidOrders} paid</span></div>) : <p className="rounded-xl border border-white/10 px-3 py-3 text-sm text-slate-400">Traffic sources are unavailable.</p>}
          </div>
          <ReferenceMeta source={traffic.source} detail={traffic.error || "Traffic source"} />
          <ReferenceMeta source={realtime.source} detail={realtime.error || "Realtime source"} />
        </article>
        <article className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-blue-300">Weekday sales</p>
          <h2 className="mt-1 text-xl font-bold text-white">When demand appears</h2>
          <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {weekdayRows.map((row: any) => <div key={row.label} className="rounded-xl border border-white/10 p-3"><p className="text-xs text-slate-500">{row.label}</p><p className="mt-2 text-sm font-semibold text-slate-200">{formatMoney(row.averageRevenue)}</p><p className="mt-1 text-[10px] text-slate-600">{row.windowKey}</p></div>)}
          </div>
          <div className="mt-5 border-t border-white/10 pt-4">
            <p className="text-xs font-bold text-white">Top products · 30d</p>
            <div className="mt-3 space-y-2">{topProducts.map((row: any) => <div key={row.sku || row.name} className="flex justify-between gap-3 text-sm"><span className="text-slate-300">{row.name}</span><span className="text-slate-500">{formatMoney(row.paidRevenue30d)}</span></div>)}</div>
          </div>
          <ReferenceMeta source={analytics.weekdaySales?.source} detail="Weekday and product sales data" />
        </article>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <article className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-blue-300">Release demand</p>
          <h2 className="mt-1 text-xl font-bold text-white">Waitlist and launch signal</h2>
          <p className="mt-5 text-3xl font-bold text-white">{analytics.releaseDemand?.available ? (release.waitlist || release.items || []).length : "—"}</p>
          <p className="mt-2 text-sm text-slate-400">{analytics.releaseDemand?.available ? "Waitlist requests" : "Release demand unavailable"}</p>
          <p className="mt-3 text-xs text-slate-500">{release.automation || (analytics.releaseDemand?.available ? "No release workflow is active." : "No release data is available.")}</p>
        </article>
        <article className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-blue-300">Processor state</p>
          <h2 className="mt-1 text-xl font-bold text-white">No financial action</h2>
          <p className="mt-5 text-sm font-semibold text-emerald-200">{processor.mutationsDisabled === true ? "Protected" : "State unavailable"}</p>
          <p className="mt-2 text-sm leading-6 text-slate-400">Payment controls are protected from this workspace.</p>
        </article>
        <article className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-blue-300">Customer conversations</p>
          <h2 className="mt-1 text-xl font-bold text-white">Chatwoot queue</h2>
          {chat.length ? chat.map((row: any) => <div key={row.id} className="mt-5 rounded-xl border border-white/10 p-3"><div className="flex justify-between gap-3"><span className="text-sm font-semibold text-slate-200">{row.contact?.name || "Customer"}</span><Badge>{row.status || "OPEN"}</Badge></div><p className="mt-2 text-xs leading-5 text-slate-400">{row.lastMessage || "Conversation content unavailable"}</p></div>) : <p className="mt-5 text-sm text-slate-500">No customer conversations are available.</p>}
          <ReferenceMeta source={analytics.chatwoot?.source} detail="Conversation source" />
        </article>
      </div>
      <ReferenceMeta source={analytics.source} generatedAt={analytics.generatedAt} detail="Analytics data assembled from connected sources" />
    </div>
  );
}

function CustomerOperationsSection({
  payload,
  onOpenCase,
}: {
  payload: OperationsPayload;
  onOpenCase: (item: CaseItem) => void;
}) {
  const metrics = payload.humanWorkMetrics || {};
  const outcomes = metrics.product_outcomes || {};
  const humanWorkCases = payload.customerOperations.cases.filter((item) => item.requires_human);
  return (
    <div className="space-y-8">
      <SectionHeader
        eyebrow="Customer Operations"
        title="Human Work"
        description="What needs a person right now. Review the verified customer, order, support, and decision context before recording a safe next step."
        count={humanWorkCases.length}
        icon={<MessageCircle size={14} />}
      />
      <section className="rounded-2xl border border-white/10 bg-white/[0.035] p-5">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">Support work status</p>
          <span className="text-xs text-slate-500">Read-only operational view</span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric label="Needs Human" value={outcomes.needs_human ?? 0} detail="Current cases whose outcome requires CSR or owner judgment" icon={<Inbox size={18} />} tone="brand" />
          <Metric label="Waiting on customer" value={outcomes.waiting_on_customer ?? metrics.waiting ?? 0} detail="Current cases waiting for customer information; excluded from the open queue" icon={<AlertTriangle size={18} />} tone="signal" />
          <Metric label="Failed automation" value={outcomes.failed_automation ?? 0} detail="Current cases where automation stopped safely; review if retained in Human Work" icon={<CircleAlert size={18} />} tone="danger" />
          <Metric label="Resolved automatically" value={outcomes.resolved_automatically ?? metrics.ai_resolved ?? 0} detail="Current cases resolved by policy with verified facts and no human work" icon={<Bot size={18} />} tone="success" />
        </div>
        <p className="mt-4 text-xs leading-5 text-slate-500">
          Scope: all currently retained LAB support interactions, not a time window. Human Work queue: {humanWorkCases.length} open cases; it includes cases requiring review and excludes Waiting on customer and resolved cases.
        </p>
      </section>
      <section>
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-blue-300">Primary workspace</p>
            <h2 className="mt-1 text-2xl font-bold text-white">Work queue</h2>
          </div>
          <span className="text-xs text-slate-500">{humanWorkCases.length} cases requiring review</span>
        </div>
        <div className="overflow-hidden rounded-2xl border border-white/10">
          <div className="hidden grid-cols-[1.05fr_1fr_0.85fr_0.75fr_1.3fr] gap-4 border-b border-white/10 bg-white/[0.035] px-5 py-3 text-[10px] font-bold uppercase tracking-[0.15em] text-slate-500 md:grid">
            <span>Priority / issue</span>
            <span>Customer / order</span>
            <span>Age / status</span>
            <span>Owner</span>
            <span>Next action</span>
          </div>
          {humanWorkCases.map((item) => (
            <button
              key={item.id}
              onClick={() => onOpenCase(item)}
              className="grid w-full gap-3 border-b border-white/10 px-5 py-4 text-left transition last:border-0 hover:bg-white/[0.05] md:grid-cols-[1.05fr_1fr_0.85fr_0.75fr_1.3fr] md:items-center md:gap-4"
            >
              <div>
                <Badge tone={String(item.priority || "").toUpperCase().includes("HIGH") || String(item.priority || "").toUpperCase().includes("URGENT") ? "danger" : "neutral"}>{item.priority || "Priority pending"}</Badge>
                <p className="text-sm font-bold text-white">
                  {humanize(item.case_type)}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                    {item.summary ||
                    item.what_happened ||
                    "Case information available"}
                </p>
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-200">
                  {customerName(item)}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  #{orderNumber(item)}
                </p>
              </div>
              <div className="flex flex-col items-start gap-2">
                <Badge tone={outcomeTone({product_outcome: item.product_outcome, outcome: item.status})}>
                  {operatorOutcomeLabel(item.product_outcome) || operatorWorkState(item.human_work?.status || item.human_work_status || item.status)}
                </Badge>
                <p className="text-xs text-slate-500">{item.age || "Age unavailable"}</p>
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-200">{item.assignee_name || item.owner || "Unassigned"}</p>
                <p className="mt-1 text-xs text-slate-500">{operatorQueueLabel(item.queue_name)}</p>
              </div>
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm leading-5 text-slate-300">
                  {item.recommended_action || "Review case context"}
                </p>
                <ChevronRight size={16} className="shrink-0 text-slate-600" />
              </div>
            </button>
          ))}
          {!humanWorkCases.length ? (
            <p className="px-5 py-8 text-sm leading-6 text-slate-400">
              No cases currently require human review. Failed or waiting automation remains visible in Automation Health.
            </p>
          ) : null}
        </div>
      </section>
      <section>
        <div className="mb-4 flex items-end justify-between gap-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-blue-300">Recent automation results</p>
            <h2 className="mt-1 text-xl font-bold text-white">Support activity</h2>
          </div>
          <span className="text-xs text-slate-500">{payload.customerOperations.automationWork.length} recent items</span>
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          {payload.customerOperations.automationWork.map((work) => (
            <AutomationTrace
              key={work.id}
              work={work}
              onOpenCase={() =>
                onOpenCase({
                  id: work.id,
                  summary: work.input,
                  status: work.product_outcome || work.outcome,
                  product_outcome: work.product_outcome,
                  recommended_action: work.recommendation,
                  customer_name: work.customer_name,
                  order_number: work.order_number,
                  case_number: work.case_number,
                  case_type: work.case_type,
                  requires_human: work.requires_human,
                })
              }
            />
          ))}
        </div>
      </section>
    </div>
  );
}

function AutomationTrace({
  work,
  onOpenCase,
}: {
  work: AutomationWork;
  onOpenCase?: () => void;
}) {
  const tone = outcomeTone(work);
  const label = outcomeLabel(work);
  return (
    <button
      onClick={onOpenCase}
      disabled={!onOpenCase}
      className="w-full rounded-2xl border border-white/10 bg-white/[0.04] p-5 text-left transition hover:border-blue-300/25 hover:bg-white/[0.07] disabled:cursor-default disabled:hover:border-white/10 disabled:hover:bg-white/[0.04]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="rounded-xl bg-blue-300/10 p-2.5 text-blue-200">
            <Route size={17} />
          </span>
          <div>
            <p className="text-sm font-bold text-white">{humanize(work.case_type)}</p>
            <p className="mt-1 text-xs text-slate-500">{work.customer_name || "Customer context pending"} · Order #{work.order_number || "pending"}</p>
          </div>
        </div>
        <Badge tone={tone}>{label}</Badge>
      </div>
      <p className="mt-4 text-sm leading-6 text-slate-200">{operatorCopy(work.input)}</p>
      <div className="mt-4 border-t border-white/10 pt-4">
        <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-600">Recommended action</p>
        <p className="mt-1 text-sm leading-5 text-slate-300">{operatorCopy(work.recommendation)}</p>
      </div>
    </button>
  );
}

function OrdersSection({
  payload,
  onOpenOrder,
}: {
  payload: OperationsPayload;
  onOpenOrder: (order: Record<string, any>) => void;
}) {
  const orders = payload.orders.items || [];
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const referenceOrders = payload.commandCenter.orders.data?.orders || [];
  const normalizedSearch = search.trim().toLowerCase();
  const filteredOrders = orders.filter((order: any) => {
    const status = String(order.order_status || order.fulfillment_state || "").toLowerCase();
    const haystack = [
      order.id,
      order.order_number,
      order.customer_name,
      order.payment_method_title,
      ...(order.line_items || []).map((item: any) => item.product_name),
    ].join(" ").toLowerCase();
    return (statusFilter === "all" || status === statusFilter) &&
      (!normalizedSearch || haystack.includes(normalizedSearch));
  });
  const total = filteredOrders.reduce(
    (sum, order) => sum + Number(order.amount || 0),
    0,
  );
  return (
    <div className="space-y-8">
      <SectionHeader
        eyebrow="Orders & Checkout"
        title="Orders & Checkout"
        description="Search a customer or order to inspect checkout, payment, fulfillment, and the context needed to resolve support work."
        count={filteredOrders.length}
        icon={<ShoppingCart size={14} />}
      />
      <div className="grid gap-3 sm:grid-cols-4">
        <Metric
          label="Orders in view"
          value={filteredOrders.length}
          detail={orders.length + " operational orders · current filter"}
          icon={<CheckCircle2 size={18} />}
          tone="success"
        />
        <Metric
          label="Order total"
          value={formatMoney(total)}
          detail="Read-only customer order context"
          icon={<ShoppingCart size={18} />}
        />
        <Metric
          label="Reference records"
          value={referenceOrders.length}
          detail="Imported order records"
          icon={<Boxes size={18} />}
        />
        <Metric
          label="Checkout state"
          value={humanize(payload.commandCenter.checkout.status)}
          detail={payload.commandCenter.checkout.detail}
          icon={<RefreshCw size={18} />}
          tone="signal"
        />
      </div>
      <TechnicalDetails>
        Commerce source: {payload.orders.source}. Operational store:{" "}
        {payload.orders.operationalStore}. Checkout, payment, refund,
        replacement, messaging, and fulfillment changes are not available here.
      </TechnicalDetails>
      <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.035] p-4 sm:flex-row">
        <label className="flex-1">
          <span className="sr-only">Search orders</span>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search order, customer, payment or item"
            className="w-full rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2.5 text-sm text-white outline-none ring-blue-300/40 placeholder:text-slate-600 focus:ring-2"
          />
        </label>
        <label>
          <span className="sr-only">Filter order status</span>
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            className="w-full rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2.5 text-sm text-slate-200 outline-none sm:w-48"
          >
            <option value="all">All statuses</option>
            <option value="processing">Processing</option>
            <option value="completed">Completed</option>
            <option value="on-hold">On hold</option>
            <option value="failed">Failed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </label>
      </div>
      <div className="overflow-hidden rounded-2xl border border-white/10">
        <div className="hidden grid-cols-[1.2fr_1.1fr_0.8fr_0.8fr_1fr] gap-4 border-b border-white/10 bg-white/[0.035] px-5 py-3 text-[10px] font-bold uppercase tracking-[0.15em] text-slate-500 md:grid">
          <span>Order</span>
          <span>Customer</span>
          <span>Checkout / payment</span>
          <span>Total</span>
          <span>Items</span>
        </div>
        {filteredOrders.map((order: any) => (
          <button
            key={order.id}
            onClick={() => onOpenOrder(order)}
            className="grid w-full gap-2 border-b border-white/10 px-5 py-4 text-left transition hover:bg-white/[0.05] last:border-0 md:grid-cols-[1.2fr_1.1fr_0.8fr_0.8fr_1fr] md:items-center md:gap-4"
          >
            <div>
              <p className="text-sm font-bold text-white">
                Order #{order.order_number || order.id}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                {formatTime(order.source_created_at)}
              </p>
            </div>
            <p className="text-sm text-slate-300">{order.customer_name}</p>
            <p>
              <Badge
                tone={
                  order.order_status === "failed" ||
                  order.order_status === "cancelled"
                    ? "danger"
                    : "success"
                }
              >
                {humanize(order.fulfillment_state || order.order_status)}
              </Badge>
              <span className="mt-1 block text-xs text-slate-500">
                {order.payment_method_title || "Payment context unavailable"}
              </span>
            </p>
            <p className="text-sm font-semibold text-slate-200">
              {formatMoney(order.amount)}
            </p>
            <p className="text-xs text-slate-400">
              {(order.line_items || [])
                .map((item: any) => `${item.product_name} × ${item.quantity}`)
                .join(", ") || "No line items recorded"}
            </p>
          </button>
        ))}
        {!filteredOrders.length ? (
          <p className="px-5 py-6 text-sm text-slate-500">
            No operational orders match the current search and status filter.
          </p>
        ) : null}
      </div>
      <section>
        <div className="mb-4 flex items-end justify-between gap-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-blue-300">
              Additional order records
            </p>
            <h2 className="mt-1 text-2xl font-bold text-white">
              Imported commerce records
            </h2>
          </div>
          <Badge>Read only</Badge>
        </div>
        <div className="overflow-hidden rounded-2xl border border-white/10">
          {referenceOrders.map((order: any) => (
            <div
              key={order.id}
              className="grid gap-2 border-b border-white/10 px-5 py-4 last:border-0 sm:grid-cols-[1.1fr_1fr_0.8fr_0.8fr_1fr] sm:items-center"
            >
              <div>
                <p className="text-sm font-semibold text-white">
                  {order.displayId || order.id}
                </p>
                <p className="mt-1 text-xs text-slate-600">
                  {formatTime(order.createdAt)}
                </p>
              </div>
              <p className="text-sm text-slate-300">
                {order.displayCustomerName || order.customerName}
              </p>
              <Badge>{humanize(order.status)}</Badge>
              <p className="text-sm font-semibold text-slate-200">
                {formatMoney(order.totalAmount)}
              </p>
              <p className="text-xs text-slate-500">
                {order.paymentMethodTitle || "Payment method unavailable"} ·{" "}
                {(order.items || [])
                  .map((item: any) => (item.name || "Item") + " × " + item.quantity)
                  .join(", ")}
              </p>
            </div>
          ))}
          {!referenceOrders.length ? (
            <p className="px-5 py-6 text-sm text-slate-500">
              No additional order records are available.
            </p>
          ) : null}
        </div>
        <ReferenceMeta
          source={payload.commandCenter.orders.source}
          generatedAt={payload.commandCenter.orders.data?.generatedAt}
          detail="Imported commerce records"
        />
      </section>
    </div>
  );
}

// Retained presentation only; this legacy area is intentionally not in operator navigation.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function FulfillmentSection({
  payload,
  onOpenCase,
}: {
  payload: OperationsPayload;
  onOpenCase: (item: CaseItem) => void;
}) {
  const orders = payload.fulfillment.orders || [];
  return (
    <div className="space-y-8">
      <SectionHeader
        eyebrow="Fulfillment"
        title="Fulfillment"
        count={orders.length}
        icon={<Truck size={14} />}
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <Metric
          label="Orders in view"
          value={orders.length}
          detail="Orders in the fulfillment queue"
          icon={<Package size={18} />}
        />
        <Metric
          label="Customer exceptions"
          value={payload.fulfillment.cases.length}
          detail="cases needing staff context"
          icon={<UsersRound size={18} />}
          tone="signal"
        />
        <Metric
          label="Execution"
          value="Blocked"
          detail="no carrier or label action"
          icon={<ShieldCheck size={18} />}
          tone="success"
        />
      </div>
      <section>
        <div className="mb-4 flex items-end justify-between gap-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-blue-300">
              Outbound order status
            </p>
            <h2 className="mt-1 text-2xl font-bold text-white">
              Customer fulfillment signals
            </h2>
          </div>
          <Badge>Order status</Badge>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {orders.slice(0, 8).map((order: any) => (
            <article
              key={order.id}
              className="rounded-2xl border border-white/10 bg-white/[0.04] p-5"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-bold text-white">
                    {order.customer_name}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Order #{order.order_number || order.id}
                  </p>
                </div>
                <Badge
                  tone={
                    order.order_status === "failed" ||
                    order.order_status === "cancelled"
                      ? "danger"
                      : "success"
                  }
                >
                  {humanize(order.fulfillment_state || order.order_status)}
                </Badge>
              </div>
              <p className="mt-4 text-sm text-slate-300">
                {(order.line_items || [])
                  .map((item: any) => `${item.product_name} × ${item.quantity}`)
                  .join(", ") || "No order details recorded"}
              </p>
              <p className="mt-2 text-xs text-slate-500">
                {formatMoney(order.amount)} · status only, no fulfillment action
              </p>
            </article>
          ))}
        </div>
      </section>
      <section>
        <div className="mb-4">
          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-blue-300">
            Human Review queue
          </p>
          <h2 className="mt-1 text-2xl font-bold text-white">
            Human Work tied to customer fulfillment
          </h2>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {payload.fulfillment.cases.slice(0, 8).map((item) => (
            <button
              key={item.id}
              onClick={() => onOpenCase(item)}
              className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 text-left transition hover:border-blue-300/25 hover:bg-white/[0.07]"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-bold text-white">
                    {customerName(item)}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {humanize(item.case_type)} · {orderNumber(item)}
                  </p>
                </div>
                <ChevronRight size={16} className="text-slate-600" />
              </div>
              <p className="mt-4 text-sm leading-6 text-slate-300">
                {item.summary || item.recommended_action}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Badge>{operatorWorkState(item.human_work?.status || item.human_work_status || item.status)}</Badge>
              </div>
            </button>
          ))}
        </div>
      </section>
      <TechnicalDetails>
        Fulfillment source: {payload.fulfillment.source}. Carrier, label
        purchase, replacement, and fulfillment changes are not available here.
      </TechnicalDetails>
    </div>
  );
}

// Retained presentation only; this legacy area is intentionally not in operator navigation.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function InventorySuppliersSection({
  payload,
}: {
  payload: OperationsPayload;
}) {
  const inventory = payload.commandCenter.inventory.data;
  const supplier = payload.commandCenter.supplierOps.data;
  const groups = inventory?.groups || [];
  const recommendations = supplier?.recommendations || [];
  const tracking = supplier?.tracking || [];
  const trackingSummary = supplier?.trackingSummary || {};
  return (
    <div className="space-y-8">
      <SectionHeader
        eyebrow="Inventory & Suppliers"
        title="Inventory & Suppliers"
        count={groups.length}
        icon={<Warehouse size={14} />}
      />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          label="Tracked items"
          value={inventory?.summary?.trackedItems ?? "—"}
          detail="product / variation groups"
          icon={<Boxes size={18} />}
        />
        <Metric
          label="In stock"
          value={inventory?.summary?.inStock ?? "—"}
          detail="Current inventory"
          icon={<CheckCircle2 size={18} />}
          tone="success"
        />
        <Metric
          label="Out of stock"
          value={inventory?.summary?.outOfStock ?? "—"}
          detail="Current inventory"
          icon={<AlertTriangle size={18} />}
          tone="danger"
        />
        <Metric
          label="Priority recommendations"
          value={supplier?.run?.priorityRecommendations ?? "—"}
          detail="Recommended reorder actions"
          icon={<Zap size={18} />}
          tone="signal"
        />
      </div>
      <section>
        <div className="mb-4">
          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-blue-300">
            Stock position
          </p>
          <h2 className="mt-1 text-2xl font-bold text-white">
            Products and runway
          </h2>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {groups.map((item: any) => (
            <article
              key={item.productId}
              className="rounded-2xl border border-white/10 bg-white/[0.04] p-5"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-bold text-white">
                    {item.displayProductName || item.productName}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {item.productSku}
                  </p>
                </div>
                <SourceBadge
                  state={
                    item.stockStatus === "outofstock"
                      ? "OUT OF STOCK"
                      : item.runwayDays <= 10
                        ? "LOW STOCK"
                        : "IN STOCK"
                  }
                />
              </div>
              <div className="mt-5 grid grid-cols-3 gap-3">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.14em] text-slate-600">
                    Available
                  </p>
                  <p className="mt-1 text-lg font-bold text-white">
                    {item.stockQuantity}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-[0.14em] text-slate-600">
                    Runway
                  </p>
                  <p className="mt-1 text-lg font-bold text-white">
                    {item.runwayDays}d
                  </p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-[0.14em] text-slate-600">
                    Sold 30d
                  </p>
                  <p className="mt-1 text-lg font-bold text-white">
                    {item.sales30d?.quantitySold ?? "—"}
                  </p>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>
      <section>
        <div className="mb-4 flex items-end justify-between gap-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-blue-300">
              Inbound supplier signals
            </p>
            <h2 className="mt-1 text-2xl font-bold text-white">
              What is on the way
            </h2>
          </div>
          <Badge>Inbound status</Badge>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {tracking.slice(0, 8).map((item: any) => (
            <article
              key={item.packageRef}
              className="rounded-2xl border border-white/10 bg-white/[0.04] p-5"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-bold text-white">
                    {item.displayContents || item.contents}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {item.supplier} ·{" "}
                    {item.displayPackageRef || item.packageRef}
                  </p>
                </div>
                <SourceBadge state={item.latestStatus} />
              </div>
              <p className="mt-4 text-sm text-slate-300">{item.eta}</p>
              {item.operatorStatus ? (
                <p className="mt-2 text-xs text-emerald-200">
                  Receipt state: {humanize(item.operatorStatus)}
                </p>
              ) : null}
            </article>
          ))}
        </div>
        <p className="mt-3 text-xs text-slate-600">
          {trackingSummary.total ?? tracking.length} inbound deliveries ·
          supplier commitments are read-only.
        </p>
      </section>
      <section>
        <div className="mb-4">
          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-blue-300">
            Supplier intelligence
          </p>
          <h2 className="mt-1 text-2xl font-bold text-white">
            Inbound, alerts and reorder logic
          </h2>
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          {recommendations.slice(0, 6).map((item: any) => (
            <article
              key={item.sku}
              className="rounded-2xl border border-white/10 bg-white/[0.04] p-5"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-bold text-white">
                    {item.displayProductName || item.productName}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {item.sku}
                  </p>
                </div>
                <Badge tone={item.status === "critical" ? "danger" : "signal"}>
                  {humanize(item.status)}
                </Badge>
              </div>
              <p className="mt-4 text-sm leading-6 text-slate-300">
                {item.recommendedQuantity} units recommended ·{" "}
                {item.inboundQuantity} inbound · {item.unitsPerDayCurrent}{" "}
                units/day current
              </p>
              <p className="mt-2 text-xs text-slate-500">
                Stockout: {item.stockoutDateCurrent}. Recommended order:{" "}
                {item.recommendedOrderDate}.
              </p>
            </article>
          ))}
        </div>
      </section>
      <TechnicalDetails>
        Inventory and supplier data are read-only projections. Supplier
        commitments, purchase orders, and stock changes are not available in
        this workspace.
      </TechnicalDetails>
    </div>
  );
}

function AgentsSection({ payload }: { payload: OperationsPayload }) {
  const policy = payload.agents.supportPolicy;
  const currentPolicy = policy?.available ? policy.data?.current : null;
  const jobHealth = payload.agents.jobHealth || [];
  const failedJobs = jobHealth.filter((item) => /DOWN|FAILED|DEAD|ERROR/.test(String(item.state).toUpperCase()));
  const workingJobs = jobHealth.filter((item) => /AVAILABLE|HEALTHY|CLEAR|OK|UP|SUCCEEDED/.test(String(item.state).toUpperCase()));
  const lastSuccessfulRun = payload.agents.projectionAttempts.find((item) => /SUCCESS|SUCCEEDED/.test(String(item.outcome).toUpperCase()));
  const failedWork = payload.agents.work.filter((work) => outcomeLabel(work) === "Failed automation");
  const humanReviewWork = payload.agents.work.filter((work) => work.humanRequired);
  const failedSignals = failedJobs.length + failedWork.length;
  const degradedSignals = jobHealth.filter((item) => !/AVAILABLE|HEALTHY|CLEAR|OK|UP|SUCCEEDED/.test(String(item.state).toUpperCase())).length;
  const automationState = failedSignals > 0 ? "Failed" : degradedSignals > 0 ? "Degraded" : "Working";
  const impactText = failedWork.length
    ? `${failedWork.length} ${failedWork.length === 1 ? "support case" : "support cases"} affected`
    : failedJobs.length
      ? "Impact is not known"
      : degradedSignals
        ? "Customer impact is not known"
        : "No customer impact identified";
  const reviewText = humanReviewWork.length
    ? `Review Human Work (${humanReviewWork.length})`
    : "Human Work review is not currently required";
  return (
    <div className="space-y-8">
      <SectionHeader
        eyebrow="Customer Operations"
        title="Automation Health"
        description="Make degraded or failed automation visible before it creates hidden customer work."
        count={payload.agents.work.length}
        icon={<Bot size={14} />}
      />
      <div className="grid gap-3 lg:grid-cols-[1fr_1fr]">
        <article className="rounded-2xl border border-blue-300/15 bg-blue-300/[0.045] p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="rounded-xl bg-blue-300/10 p-2.5 text-blue-200">
                <Bot size={18} />
              </span>
              <div>
                <p className="text-sm font-bold text-white">
                  Automation status
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {automationState}
                </p>
              </div>
            </div>
            <SourceBadge state={automationState === "Working" ? "AVAILABLE" : automationState === "Failed" ? "FAILED" : "ATTENTION"} />
          </div>
          <p className="mt-5 text-sm leading-6 text-slate-300">
            {automationState} — {impactText}; {reviewText}.
          </p>
          <TechnicalDetails>
            Runtime: {payload.agents.runtime.name} · source:{" "}
            {payload.agents.runtime.source}. {payload.agents.runtime.detail} · {failedWork.length} recent failed-automation {failedWork.length === 1 ? "case" : "cases"} · {degradedSignals} component(s) not reporting a fully available state.
          </TechnicalDetails>
        </article>
        <article className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
          <div className="flex items-center gap-2 text-sm font-bold text-white">
            <Activity size={17} className="text-emerald-200" /> Current health
          </div>
          <div className="mt-4 space-y-2">
            {payload.agents.jobHealth.map((item) => (
              <div
                key={item.name}
                className="flex items-center justify-between gap-3 rounded-xl border border-white/10 px-3 py-2.5"
              >
                <span>
                  <span className="block text-sm font-semibold text-slate-200">
                    {operatorJobLabel(item.name)}
                  </span>
                  <span className="mt-0.5 block text-xs text-slate-600">
                    {item.detail}
                  </span>
                </span>
                <SourceBadge state={item.state} />
              </div>
            ))}
          </div>
        </article>
      </div>
      <article className="rounded-2xl border border-amber-300/20 bg-amber-300/[0.04] p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-bold text-white">AI Support Policy</p>
            <p className="mt-1 text-xs text-slate-500">The policy that governs automated support</p>
          </div>
          <SourceBadge state={currentPolicy ? "AVAILABLE" : "UNAVAILABLE"} />
        </div>
        {currentPolicy ? (
          <div className="mt-4 grid gap-2 text-xs text-slate-300 sm:grid-cols-3">
            <span>Version <strong className="text-white">{currentPolicy.policy_version}</strong></span>
            <span>Preset <strong className="text-white">{currentPolicy.preset}</strong></span>
            <span>Changed by <strong className="text-white">{currentPolicy.changed_by}</strong></span>
          </div>
        ) : <p className="mt-4 text-sm text-slate-500">Policy state unavailable; no authorization decision is inferred.</p>}
        <TechnicalDetails>
          Candidate M recommends; Chameleon policy authorizes. Hard boundaries,
          approval thresholds, identity conflicts, and execution controls remain
          enforced outside the model.
        </TechnicalDetails>
      </article>
      <TechnicalDetails>
        Automation is limited to the internal Chameleon API and read-only
        workspace. Browser, messaging, payment, fulfillment, provider, DNS,
        and shell capabilities are unavailable. Support decisions currently
        come from Chameleon routing policy.
      </TechnicalDetails>
      <section>
        <div className="mb-4">
          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-blue-300">
            Cases affected
          </p>
          <h2 className="mt-1 text-2xl font-bold text-white">
            Recent automation outcomes
          </h2>
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          {payload.agents.work.map((work) => (
            <AutomationTrace key={work.id} work={work} />
          ))}
        </div>
      </section>
      <section>
        <div className="mb-4">
          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-blue-300">
            Failures and recovery
          </p>
          <h2 className="mt-1 text-2xl font-bold text-white">
            Failures stay visible after recovery
          </h2>
        </div>
        <div className="overflow-hidden rounded-2xl border border-white/10">
          {payload.agents.projectionAttempts.slice(0, 12).map((item) => (
            <div
              key={item.id}
              className="grid gap-2 border-b border-white/10 px-5 py-4 last:border-0 sm:grid-cols-[0.8fr_1fr_0.5fr_1.5fr] sm:items-center"
            >
              <SourceBadge state={item.outcome} />
              <p className="text-sm font-semibold text-slate-300">
                {humanize(item.entity_type)}
              </p>
              <p className="text-xs text-slate-500">
                Attempt {item.attempt_number}
              </p>
              <div>
                <p className="text-xs text-slate-400">
                  {item.source_event_id}
                </p>
                <p className="mt-1 text-xs text-slate-600">
                  {item.error || formatTime(item.occurred_at)}
                </p>
              </div>
            </div>
          ))}
          {payload.agents.projectionAttempts.length === 0 ? (
            <p className="px-5 py-5 text-sm text-slate-500">
              No completed projection attempts recorded.
            </p>
          ) : null}
        </div>
      </section>
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <Metric
          label="Working"
          value={workingJobs.length}
          detail="Current components reporting a healthy state"
          icon={<Inbox size={18} />}
          tone="success"
        />
        <Metric
          label="Degraded"
          value={degradedSignals}
          detail="Current components needing monitoring or recovery"
          icon={<AlertTriangle size={18} />}
          tone="signal"
        />
        <Metric
          label="Failed"
          value={failedSignals}
          detail="Current failed jobs or recent failed cases"
          icon={<CircleAlert size={18} />}
          tone="danger"
        />
        <Metric
          label="Last successful run"
          value={lastSuccessfulRun ? formatTime(lastSuccessfulRun.occurred_at) : "—"}
          detail="Most recent successful projection recorded"
          icon={<CheckCircle2 size={18} />}
          tone="success"
        />
        <Metric
          label="Cases affected"
          value={payload.agents.work.filter((work) => work.outcome === "FAILED_AUTOMATION" || work.humanRequired).length}
          detail="Recent failed cases or cases retained for review"
          icon={<Route size={18} />}
          tone="signal"
        />
        <Metric
          label="Human intervention required"
          value={payload.agents.work.filter((work) => work.humanRequired).length}
          detail="Recent cases retained for a person to review"
          icon={<UsersRound size={18} />}
          tone="brand"
        />
      </section>
      <TechnicalDetails>
        Raw component and job identifiers: {jobHealth.map((item) => `${item.name}=${item.state}`).join(" · ") || "none"}.{" "}
        Automation work is read-only. Failed projections remain retryable in
        Chameleon; message, approval, processor, webhook, schedule, and provider
        actions are not available from the browser.
      </TechnicalDetails>
    </div>
  );
}

function DeepLinks({ links }: { links: DeepLink[] }) {
  const linkCopy: Record<string, {label: string; reason: string}> = {
    TWENTY: {label: "Customer records", reason: "Open deeper customer and case context."},
    WOO: {label: "Order system", reason: "Open the order record and commerce context."},
    CHATWOOT: {label: "Customer conversations", reason: "Open the conversation when a source is connected."},
  };
  return (
    <div className="space-y-2">
      {links.map((link) => {
        const copy = linkCopy[link.key] || {label: link.label, reason: link.reason};
        return link.href ? (
          <a
            key={link.key}
            href={link.href}
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-3 transition hover:border-blue-300/25 hover:bg-white/[0.07]"
          >
            <span>
              <span className="block text-sm font-semibold text-slate-200">
                {copy.label}
              </span>
              <span className="mt-0.5 block text-xs text-slate-600">
                {copy.reason}
              </span>
            </span>
            <ExternalLink size={15} className="text-slate-600" />
          </a>
        ) : (
          <div
            key={link.key}
            className="rounded-xl border border-dashed border-white/10 px-3.5 py-3"
          >
            <p className="text-sm font-semibold text-slate-500">{copy.label}</p>
            <p className="mt-1 text-xs leading-5 text-slate-600">
              {copy.reason}
            </p>
          </div>
        );
      })}
    </div>
  );
}

function OrderContextDialog({
  item,
  onClose,
}: {
  item: Record<string, any>;
  onClose: () => void;
}) {
  const query = useQuery({
    queryKey: ["order-context", item.id],
    queryFn: () => loadOrderContext(String(item.id)),
  });
  const detail = query.data;
  const order = detail?.order || item;
  const customer = detail?.customer || {};
  const shipping = order.shipping_address || {};
  const tracking = Array.isArray(order.tracking) ? order.tracking : [];
  const lineItems = detail?.line_items || item.line_items || [];
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/80 p-0 backdrop-blur-sm sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Order and customer context"
    >
      <div className="max-h-[94vh] w-full max-w-4xl overflow-y-auto rounded-t-3xl border border-white/10 bg-[#151a27] shadow-2xl sm:rounded-3xl">
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-white/10 bg-[#151a27]/95 px-5 py-5 backdrop-blur sm:px-8">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-blue-300">Order context</p>
            <h2 className="mt-1 text-2xl font-bold tracking-tight text-white">Order #{order.order_number || item.id}</h2>
            <p className="mt-1 text-sm text-slate-400">Woo commerce truth · Chameleon operational read model</p>
          </div>
          <button onClick={onClose} aria-label="Close order context" className="rounded-xl border border-white/10 p-2 text-slate-400 hover:bg-white/10 hover:text-white"><X size={19} /></button>
        </div>
        <div className="grid gap-5 p-5 sm:p-8 md:grid-cols-2">
          {query.isLoading ? <p className="text-sm text-slate-400">Loading order details…</p> : null}
          {query.isError ? <p className="text-sm text-rose-200">{query.error.message}</p> : null}
          {!query.isLoading && !query.isError ? <>
            <section className="rounded-2xl border border-white/10 bg-white/[0.045] p-5">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-600">Customer</p>
              <p className="mt-3 text-lg font-bold text-white">{customer.name || item.customer_name || "Customer context unavailable"}</p>
              <p className="mt-2 text-sm text-slate-300">Contact details available in the order record</p>
            </section>
            <section className="rounded-2xl border border-white/10 bg-white/[0.045] p-5">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-600">Order and payment</p>
              <p className="mt-3 text-sm font-semibold text-white">{humanize(order.fulfillment_state || order.status)}</p>
              <p className="mt-2 text-sm text-slate-300">{formatMoney(order.amount)} · {order.currency || "USD"}</p>
              <p className="mt-1 text-xs text-slate-500">{order.payment_method_title || "Payment status unavailable"}</p>
            </section>
            <section className="rounded-2xl border border-white/10 bg-white/[0.045] p-5">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-600">Shipping and fulfillment</p>
              <p className="mt-3 text-sm text-slate-200">{addressText(shipping)}</p>
              <p className="mt-2 text-xs text-slate-500">{order.same_as_billing ? "Shipping matches billing" : "Shipping address recorded separately"}</p>
              <div className="mt-3 space-y-2 text-sm text-slate-300">{tracking.length ? tracking.map((entry: any, index: number) => <p key={index}>{entry.carrier || "Carrier"} · {entry.tracking_number || entry.reference || "Reference unavailable"} · {humanize(entry.status)}</p>) : <p>No tracking reference is recorded.</p>}</div>
            </section>
            <section className="rounded-2xl border border-white/10 bg-white/[0.045] p-5">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-600">Items and connected support</p>
              <div className="mt-3 space-y-2 text-sm text-slate-200">{lineItems.map((line: any, index: number) => <p key={line.source_line_item_id || index}>{line.product_name} × {line.quantity} · {formatMoney(line.line_total ?? line.unit_price)}</p>)}</div>
              <p className="mt-4 text-xs leading-5 text-slate-500">Customer support cases remain linked in Chameleon. No refund, replacement, fulfillment, or customer message can run from this view.</p>
            </section>
          </> : null}
        </div>
      </div>
    </div>
  );
}

function CaseContextDialog({
  item,
  links,
  onClose,
}: {
  item: CaseItem;
  links: DeepLink[];
  onClose: () => void;
}) {
  const contextQuery = useQuery({
    queryKey: ["case-context", item.id],
    queryFn: () => loadCaseContext(item.id),
  });
  const queryClient = useQueryClient();
  const [decisionReason, setDecisionReason] = useState("");
  const [decisionState, setDecisionState] = useState("");
  const [humanWorkState, setHumanWorkState] = useState("");
  const context = contextQuery.data;
  const timeline = context?.timeline || [];
  const orderContext = context?.order_context || context?.evidence?.order_context || item.evidence?.order_context;
  const orderDetails = orderContext && typeof orderContext === "object" ? orderContext as Record<string, any> : {};
  const orderItems = Array.isArray(orderDetails.line_items) ? orderDetails.line_items : [];
  const orderTracking = Array.isArray(orderDetails.tracking) ? orderDetails.tracking : [];
  const packet = context?.case_packet;
  const humanWorkStatus = String(context?.human_work?.status || item.human_work?.status || item.human_work_status || (item.requires_human ? "NEW" : "RESOLVED"));
  const operatorState = operatorWorkState(humanWorkStatus);
  const humanDecision = context?.human_decision || {};
  const decisionRequired = Boolean(humanDecision.required || packet?.proposed_action?.required);
  const decisionStatus = String(humanDecision.status || (decisionRequired ? "PENDING" : "NOT_REQUIRED"));
  const canResolve = !decisionRequired || ["APPROVED", "REJECTED"].includes(decisionStatus);
  const twenty = links.find((link) => link.key === "TWENTY");
  const twentyHref = twenty?.href
    ? twenty.href.replace(/\/?$/, "/") +
      "object/case/" +
      (context?.twenty_id || item.twenty_id || "")
    : undefined;
  async function recordHumanWork(action: "START_WORK" | "MARK_WAITING" | "RESOLVE") {
    setHumanWorkState("Recording…");
    const response = await fetch("/api/operations/cases/" + encodeURIComponent(item.id), {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: JSON.stringify({
        action,
        reason: action === "MARK_WAITING" ? "Waiting for additional case information." : undefined,
        idempotency_key: crypto.randomUUID(),
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      setHumanWorkState(body?.error?.message || "Human Work state could not be updated.");
      return;
    }
    setHumanWorkState("Human Work is now " + operatorWorkState(body.human_work_status) + ".");
    await queryClient.invalidateQueries({queryKey: ["operations-os"]});
    await queryClient.invalidateQueries({queryKey: ["case-context", item.id]});
  }
  async function recordDecision(action: "APPROVE" | "REJECT" | "REQUEST_MORE_INFORMATION" | "EDIT") {
    const reason = decisionReason.trim();
    if (!reason) {
      setDecisionState(action === "REQUEST_MORE_INFORMATION" ? "Record the information needed before waiting." : "Add a decision reason before recording.");
      return;
    }
    setDecisionState("Recording…");
    const response = await fetch(
      "/api/operations/cases/" + encodeURIComponent(item.id),
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action,
          reason,
          requested_information: action === "REQUEST_MORE_INFORMATION" ? reason : undefined,
          idempotency_key: crypto.randomUUID(),
        }),
      },
    );
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      setDecisionState(
        body?.error?.message || "Decision could not be recorded.",
      );
      return;
    }
    setDecisionState(action === "APPROVE" ? "Proposed action approved. No external action was run." : action === "REJECT" ? "Proposed action rejected." : "Waiting for the requested information.");
    await queryClient.invalidateQueries({ queryKey: ["operations-os"] });
    await queryClient.invalidateQueries({
      queryKey: ["case-context", item.id],
    });
  }
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/80 p-0 backdrop-blur-sm sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Decision and case context"
    >
      <div className="max-h-[94vh] w-full max-w-5xl overflow-y-auto rounded-t-3xl border border-white/10 bg-[#151a27] shadow-2xl sm:rounded-3xl">
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-white/10 bg-[#151a27]/95 px-5 py-5 backdrop-blur sm:px-8">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-blue-300">
              Human Work
            </p>
            <h2 className="mt-1 text-2xl font-bold tracking-tight text-white">
              {customerName(item)}
            </h2>
            <p className="mt-1 text-sm text-slate-400">
              Order #{orderNumber(item)} · {item.case_number || "Chameleon case"}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close case context"
            className="rounded-xl border border-white/10 p-2 text-slate-400 hover:bg-white/10 hover:text-white"
          >
            <X size={19} />
          </button>
        </div>
        <div className="grid gap-6 p-5 sm:p-8 lg:grid-cols-[1.25fr_0.75fr]">
          <div className="space-y-5">
            <section className="rounded-2xl border border-white/10 bg-white/[0.045] p-5">
              <div className="flex items-center gap-2 text-sm font-bold text-white">
                <MessageCircle size={17} className="text-blue-300" /> Customer
                message
              </div>
              <p className="mt-4 text-sm leading-7 text-slate-200">
                {typeof (
                  context?.evidence?.message || item.evidence?.message
                ) === "string"
                  ? String(context?.evidence?.message || item.evidence?.message)
              : item.summary || "Case information is available."}
              </p>
            </section>
            <section className="rounded-2xl border border-blue-400/25 bg-blue-500/[0.04] p-5 shadow-lg">
              <div className="flex items-center justify-between gap-2 border-b border-white/10 pb-3">
                <div className="flex items-center gap-2 text-sm font-bold text-white">
                  <Package size={17} className="text-blue-300" /> Customer Interaction / Decision Details
                </div>
                <Badge tone={outcomeTone({product_outcome: packet?.product_outcome || item.product_outcome, outcome: packet?.product_outcome || item.status})}>
                  {operatorOutcomeLabel(packet?.product_outcome || item.product_outcome) || (item.requires_human ? "Needs Human" : "Resolved automatically")}
                </Badge>
              </div>
              <div className="mt-4 space-y-4 text-sm">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Customer + relevant order</p>
                  <p className="mt-1 font-semibold text-white">
                    {packet?.customer_and_order?.display || `${packet?.customer?.name || customerName(item)} · ${packet?.order?.number ? '#' + packet.order.number : (orderNumber(item) ? '#' + orderNumber(item) : 'No order reference')}`}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Issue summary</p>
                  <p className="mt-1 text-slate-200 leading-6">
                    {packet?.issue_summary || item.summary || (typeof (context?.evidence?.message || item.evidence?.message) === "string" ? String(context?.evidence?.message || item.evidence?.message) : "Case information available")}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Verified facts</p>
                  <ul className="mt-1.5 list-disc list-inside space-y-1 text-slate-300">
                    {Array.isArray(packet?.verified_facts) && packet.verified_facts.length > 0 ? (
                      packet.verified_facts.map((fact: string, idx: number) => (
                        <li key={idx} className="text-xs leading-5 text-slate-300">{fact}</li>
                      ))
                    ) : (
                      <>
                        <li className="text-xs leading-5 text-slate-300">Customer identity: {customerName(item)}</li>
                        <li className="text-xs leading-5 text-slate-300">{orderNumber(item) ? `Order #${orderNumber(item)} verified in Woo LAB` : "No order reference attached"}</li>
                        <li className="text-xs leading-5 text-slate-300">Containment: no external action has been taken in LAB</li>
                      </>
                    )}
                  </ul>
                </div>
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Applicable approved policy / knowledge</p>
                  <p className="mt-1 text-slate-300 text-xs leading-5">
                    {packet?.applicable_approved_policy_knowledge?.knowledge?.title
                      ? `${packet.applicable_approved_policy_knowledge.knowledge.title} (${packet.applicable_approved_policy_knowledge.knowledge.playbook}) · Policy: ${packet.applicable_approved_policy_knowledge.policy.version || 'v2'}`
                      : `${packet?.policy?.disposition || 'Standard CSR'} · Approved support playbook`}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Automation result / attempt</p>
                  <p className="mt-1 text-slate-300 text-xs leading-5">
                    {packet?.automation_result_attempt?.attempt || (item.requires_human === false ? "Automated response generated and resolved by policy" : "Evaluated by advisory triage; routed safely to Human Work")}
                  </p>
                </div>
                {packet?.agent_contract ? (
                  <div className="rounded-xl border border-emerald-300/20 bg-emerald-300/[0.04] p-4">
                    <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-emerald-200">Support decision</p>
                    <p className="mt-2 text-xs text-slate-300">Provider / worker: {packet.agent_contract.provider || "unavailable"} / {packet.agent_contract.model || "unavailable"} - Status: {packet.agent_contract.status || "unknown"}</p>
                    <p className="mt-2 text-xs text-slate-200">Decision: {packet.agent_contract.decision || "not recorded"}</p>
                    <p className="mt-2 text-xs leading-5 text-slate-300">Reason: {packet.agent_contract.escalation_reason || "No reason recorded."}</p>
                    <p className="mt-2 text-xs leading-5 text-slate-300">Missing information: {Array.isArray(packet.agent_contract.missing_information) ? packet.agent_contract.missing_information.join(" - " ) : (packet.agent_contract.missing_information || "None")}</p>
                    <p className="mt-2 text-xs leading-5 text-slate-300">Verified facts: {Array.isArray(packet.agent_contract.verified_facts) ? packet.agent_contract.verified_facts.join(" - " ) : "Not recorded"}</p>
                    <p className="mt-2 text-xs leading-5 text-emerald-100">Reason: {packet.agent_contract.escalation_reason || "Not recorded"}</p>
                    <p className="mt-2 text-xs leading-5 text-slate-300">Prepared customer response: {packet.agent_contract.proposed_customer_response || "None"}</p>
                    <p className="mt-2 text-xs leading-5 text-amber-100">Proposed action: {packet.agent_contract.proposed_action || "None"}</p>
                  </div>
                ) : null}
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Why it stopped</p>
                  <p className="mt-1 text-amber-200/90 text-xs leading-5">
                    {packet?.why_it_stopped || context?.why_is_this_here || context?.why_here || item.why_here || "Containment policy requires operator review before action."}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Recommended next action</p>
                  <p className="mt-1 text-emerald-200/90 text-xs font-medium leading-5">
                    {packet?.recommended_next_action || item.recommended_action || "Review enriched context and record decision."}
                  </p>
                </div>
              </div>
            </section>
            <section className="rounded-2xl border border-white/10 bg-white/[0.045] p-5">
              <div className="flex items-center gap-2 text-sm font-bold text-white">
                <Route size={17} className="text-amber-200" /> Work status
              </div>
              <p className="mt-4 text-sm leading-7 text-slate-300">
                {context?.why_is_this_here ||
                  context?.why_here ||
                  item.why_here ||
                  "Chameleon routed this item into an accountable operations queue."}
              </p>
              {Boolean(context?.requires_human ?? item.requires_human) ? (
                <div className="mt-4 rounded-xl border border-blue-300/15 bg-blue-300/[0.04] p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-200">Human Work</p>
                    <Badge tone={operatorState === "Waiting" ? "signal" : operatorState === "Resolved" ? "success" : "brand"}>{operatorState}</Badge>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {humanWorkStatus === "WAITING" ? (
                      <button onClick={() => recordHumanWork("START_WORK")} className="rounded-lg bg-white px-3 py-2 text-xs font-bold text-slate-950 hover:bg-blue-50">Reopen</button>
                    ) : null}
                    {humanWorkStatus !== "RESOLVED" ? (
                      <>
                        {humanWorkStatus !== "WAITING" ? <button onClick={() => recordHumanWork("MARK_WAITING")} className="rounded-lg border border-amber-300/30 px-3 py-2 text-xs font-bold text-amber-100 hover:bg-amber-300/10">Waiting</button> : null}
                        <button disabled={!canResolve} onClick={() => recordHumanWork("RESOLVE")} className="rounded-lg border border-emerald-300/30 px-3 py-2 text-xs font-bold text-emerald-100 hover:bg-emerald-300/10 disabled:cursor-not-allowed disabled:opacity-50">Resolve</button>
                      </>
                    ) : null}
                  </div>
                  {humanWorkState ? <p className="mt-2 text-xs leading-5 text-slate-400">{humanWorkState}</p> : null}
                  {decisionRequired && !canResolve ? <p className="mt-2 text-[11px] leading-5 text-amber-100">Record an approve or reject decision before resolving this case.</p> : null}
                  <p className="mt-2 text-[11px] leading-5 text-slate-500">State and audit only. Customer messaging, refunds, replacements, labels, payments, and fulfillment remain unavailable.</p>
                </div>
              ) : null}
            </section>
            <section className="rounded-2xl border border-white/10 bg-white/[0.045] p-5">
              <div className="flex items-center gap-2 text-sm font-bold text-white"><Package size={17} className="text-blue-300" /> Customer, order and shipping context</div>
              <div className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
                <div><p className="text-xs text-slate-500">Customer</p><p className="mt-1 font-semibold text-slate-200">{orderDetails.customer_name || customerName(item)}</p><p className="mt-1 text-slate-400">Contact details available in the order record</p></div>
                <div><p className="text-xs text-slate-500">Order and fulfillment</p><p className="mt-1 font-semibold text-slate-200">#{orderDetails.order_number || orderNumber(item)} · {humanize(orderDetails.fulfillment_state || orderDetails.order_status)}</p><p className="mt-1 text-slate-400">{formatMoney(orderDetails.amount)} · {orderDetails.payment_method_title || "Payment status unavailable"}</p></div>
                <div><p className="text-xs text-slate-500">Shipping address</p><p className="mt-1 leading-6 text-slate-300">{addressText(orderDetails.shipping_address)}</p></div>
                <div><p className="text-xs text-slate-500">Carrier / tracking</p><p className="mt-1 leading-6 text-slate-300">{orderTracking.length ? orderTracking.map((entry: any) => `${entry.carrier || "Carrier"} · ${entry.tracking_number || entry.reference || "Reference unavailable"} · ${humanize(entry.status)}`).join("\n") : "No tracking reference is recorded."}</p></div>
              </div>
              <div className="mt-4 border-t border-white/10 pt-4"><p className="text-xs text-slate-500">Items</p><p className="mt-1 text-sm leading-6 text-slate-300">{orderItems.length ? orderItems.map((line: any) => `${line.product_name} × ${line.quantity}`).join(" · ") : "Line-item context unavailable"}</p></div>
              <div className="mt-4 border-t border-white/10 pt-4">
                <p className="text-xs text-slate-500">Identity / order match</p>
                <p className="mt-1 text-sm text-emerald-200">
                  {orderDetails.customer_name || customerName(item)} ↔ #
                  {orderDetails.order_number || orderNumber(item)} · matched in operations
                </p>
              </div>
            </section>
            <TechnicalDetails>
              <div className="space-y-4 text-sm">
                <div><p className="font-semibold text-slate-300">Policy and routing</p><p className="mt-1 text-slate-500">{humanize(packet?.policy?.disposition)} · {packet?.policy?.reason || "Policy reason unavailable"} · playbook: {packet?.applicable_approved_policy_knowledge?.knowledge?.playbook || "support-routing-v2"}</p></div>
                <div><p className="font-semibold text-slate-300">Evidence</p><p className="mt-1 text-slate-500">{packet?.evidence_available?.length ? packet.evidence_available.join(" · ") : "No evidence inventory recorded"}</p></div>
                <div><p className="font-semibold text-slate-300">Missing information</p><p className="mt-1 text-slate-500">{packet?.missing_information?.length ? packet.missing_information.join(" · ") : "No missing information recorded"}</p></div>
                <div><p className="font-semibold text-slate-300">Provenance</p><p className="mt-1 text-slate-500">{packet?.provenance?.source || "chameleon-postgres"} · {packet?.provenance?.source_reference || "source reference unavailable"} · {packet?.provenance?.execution || "NO_EXECUTION"}</p></div>
              </div>
            </TechnicalDetails>
            <TechnicalDetails>
              <div className="flex items-center gap-2 text-sm font-bold text-white">
                <Activity size={17} className="text-emerald-200" />{" "}
                Audit timeline
              </div>
              {contextQuery.isLoading ? (
                <p className="mt-4 text-sm text-slate-500">
                  Loading timeline…
                </p>
              ) : contextQuery.isError ? (
                <p className="mt-4 text-sm text-rose-200">
                  {contextQuery.error.message}
                </p>
              ) : timeline.length ? (
                <div className="mt-5 space-y-4">
                  {timeline.slice(0, 12).map((entry, index) => (
                    <div
                      key={(entry.occurred_at || "") + index}
                      className="flex gap-3"
                    >
                      <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-blue-300 ring-4 ring-blue-300/10" />
                      <div>
                        <p className="text-sm font-semibold text-slate-200">
                          {entry.title || "Case event"}
                        </p>
                        <p className="mt-1 text-sm leading-6 text-slate-400">
                          {entry.summary || "Event recorded in Chameleon."}
                        </p>
                        <p className="mt-1 text-xs text-slate-600">
                          {formatTime(entry.occurred_at)} ·{" "}
                          {entry.source_of_truth || "chameleon-postgres"}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-4 text-sm text-slate-500">
                  No timeline entries returned.
                </p>
              )}
            </TechnicalDetails>
          </div>
          <aside className="min-w-0 space-y-5">
            <section className="rounded-2xl border border-amber-300/20 bg-amber-300/[0.06] p-5">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-amber-200">
                Recommendation / proposed action
              </p>
              <p className="mt-3 text-sm font-semibold leading-6 text-white">
                {operatorCopy(
                  context?.recommended_action ||
                    item.recommended_action ||
                    "Review the available evidence.",
                )}
              </p>
              <p className="mt-3 text-xs leading-5 text-slate-400">
                {operatorCopy(
                  context?.proposed_side_effect ||
                    item.proposed_side_effect ||
                    "No external action proposed.",
                )}
              </p>
              {decisionRequired ? (
                <div className="mt-5 rounded-xl border border-amber-300/15 bg-black/10 px-3 py-3">
                  <p className="text-xs font-semibold text-amber-100">
                    Decision status: {humanize(decisionStatus)}. Decisions record intent only; no external action runs.
                  </p>
                  {!["APPROVED", "REJECTED"].includes(decisionStatus) ? (
                    <>
                      <label className="mt-3 block text-[10px] font-bold uppercase tracking-[0.14em] text-amber-200">
                        Decision reason or information requested
                      </label>
                      <textarea
                        value={decisionReason}
                        onChange={(event) =>
                          setDecisionReason(event.target.value)
                        }
                        rows={3}
                        className="mt-2 w-full rounded-lg border border-white/10 bg-slate-950/40 px-3 py-2 text-sm text-white outline-none ring-amber-300/40 placeholder:text-slate-600 focus:ring-2"
                        placeholder="What evidence supports this decision, or what information is required?"
                      />
                        <button disabled={decisionState === "Recording…" || !decisionReason.trim()} onClick={() => recordDecision("EDIT")} className="rounded-lg border border-amber-300/30 px-3 py-2 text-xs font-bold text-amber-100 disabled:opacity-50">Edit</button>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          disabled={decisionState === "Recording…" || !decisionReason.trim()}
                          onClick={() => recordDecision("APPROVE")}
                          className="rounded-lg bg-emerald-300 px-3 py-2 text-xs font-bold text-slate-950 disabled:opacity-50"
                        >
                          Approve proposed action
                        </button>
                        <button
                          disabled={decisionState === "Recording…" || !decisionReason.trim()}
                          onClick={() => recordDecision("REJECT")}
                          className="rounded-lg border border-rose-300/30 px-3 py-2 text-xs font-bold text-rose-100 disabled:opacity-50"
                        >
                          Reject proposed action
                        </button>
                        <button
                          disabled={decisionState === "Recording…" || !decisionReason.trim()}
                          onClick={() => recordDecision("REQUEST_MORE_INFORMATION")}
                          className="rounded-lg border border-blue-300/30 px-3 py-2 text-xs font-bold text-blue-100 disabled:opacity-50"
                        >
                          Ask customer
                        </button>
                      </div>
                    </>
                  ) : null}
                  {decisionState ? (
                    <p className="mt-2 text-xs text-amber-100">
                      {decisionState}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </section>
            <section className="rounded-2xl border border-white/10 bg-white/[0.045] p-5">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-600">
                Deep records
              </p>
              <div className="mt-3 space-y-2">
                {twentyHref && (context?.twenty_id || item.twenty_id) ? (
                  <a
                    href={twentyHref}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center justify-between rounded-xl border border-white/10 px-3 py-2.5 text-sm font-semibold text-slate-200 hover:bg-white/10"
                  >
                    Open Twenty CRM context <ArrowUpRight size={15} />
                  </a>
                ) : null}
              </div>
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
}

export default function OperationsHome() {
  const [activeSection, setActiveSection] = useState<SectionKey>("customer-operations");
  const [selectedCase, setSelectedCase] = useState<CaseItem>();
  const [selectedOrder, setSelectedOrder] = useState<Record<string, any>>();
  const query = useQuery({
    queryKey: ["operations-os", activeSection],
    queryFn: () => loadOperations(activeSection),
  });
  const payload = query.data;

  useEffect(() => {
    const hash = window.location.hash.replace("#", "") as SectionKey;
    if (validSections.has(hash)) setActiveSection(hash);
  }, []);

  function selectSection(section: SectionKey) {
    setActiveSection(section);
    window.history.replaceState(null, "", "#" + section);
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.assign("/login");
  }

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#0d111b] text-white">
      <div className="mx-auto max-w-[1540px] px-4 pb-12 sm:px-6 lg:px-8">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 py-5">
          <button
            onClick={() => selectSection("customer-operations")}
            className="flex items-center gap-3 text-left"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/15 text-blue-200">
              <Layers3 size={21} />
            </span>
            <span>
              <span className="block text-sm font-bold tracking-wide text-white">
                Chameleon
              </span>
              <span className="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">
                Operations
              </span>
            </span>
          </button>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Badge tone="success">
              <CheckCircle2 size={12} className="mr-1" /> LAB · Read only
            </Badge>
            <Badge>No external action</Badge>
            {payload?.viewer ? (
              <div className="ml-1 flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2">
                <div className="text-right"><p className="text-xs font-semibold text-white">{payload.viewer.displayName}</p><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-blue-200">{payload.viewer.role}</p></div>
                {payload.viewer.role === "ADMIN" ? <Link className="rounded-lg p-1.5 text-slate-300 hover:bg-white/10 hover:text-white" href="/settings/users" aria-label="Settings and users"><Settings size={15} /></Link> : null}
                <button className="rounded-lg p-1.5 text-slate-300 hover:bg-white/10 hover:text-white" onClick={() => { void logout(); }} aria-label="Log out"><LogOut size={15} /></button>
              </div>
            ) : null}
          </div>
        </header>
        <div className="grid gap-8 pt-6 lg:grid-cols-[232px_minmax(0,1fr)] lg:gap-10">
          <aside className="min-w-0 lg:sticky lg:top-5 lg:h-fit">
            <p className="px-3 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-600">
              Customer operations
            </p>
            <nav className="mt-3 flex gap-1 overflow-x-auto lg:grid">
              {sectionItems.map((item) => (
                <button
                  key={item.key}
                  onClick={() => selectSection(item.key)}
                  className={
                    "group flex min-w-max items-center gap-3 rounded-xl px-3 py-3 text-left transition lg:w-full " +
                    (activeSection === item.key
                      ? "bg-blue-400/10 text-white ring-1 ring-blue-300/15"
                      : "text-slate-400 hover:bg-white/[0.05] hover:text-white")
                  }
                >
                  <span
                    className={
                      activeSection === item.key
                        ? "text-blue-200"
                        : "text-slate-600"
                    }
                  >
                    {item.icon}
                  </span>
                  <span>
                    <span className="block text-sm font-semibold">
                      {item.label}
                    </span>
                  </span>
                </button>
              ))}
            </nav>
          </aside>
          <section className="min-w-0">
            {query.isError ? (
              <div className="rounded-2xl border border-rose-300/20 bg-rose-300/[0.06] p-5 text-sm font-semibold text-rose-100">
                {query.error.message}
              </div>
            ) : null}
            {query.isLoading ? (
              <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-6 text-sm text-slate-400">
                Loading customer operations…
              </div>
            ) : null}
            {payload ? (
              <>
                {activeSection === "customer-operations" ? (
                  <CustomerOperationsSection
                    payload={payload}
                    onOpenCase={setSelectedCase}
                  />
                ) : null}
                {activeSection === "orders-checkout" ? (
                  <OrdersSection payload={payload} onOpenOrder={setSelectedOrder} />
                ) : null}
                {activeSection === "agents-automations" ? (
                  <AgentsSection payload={payload} />
                ) : null}
                <footer className="mt-10 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-white/10 pt-5 text-xs text-slate-600">
                  <CircleAlert size={13} /> Updated {formatTime(payload.generatedAt)}
                  <TechnicalDetails>
                    Source: {payload.source} · execution: {payload.execution} ·
                    contract: {payload.contract}
                  </TechnicalDetails>
                </footer>
              </>
            ) : null}
          </section>
        </div>
      </div>
      {selectedCase ? (
        <CaseContextDialog
          item={selectedCase}
          links={payload?.links || []}
          onClose={() => setSelectedCase(undefined)}
        />
      ) : null}
      {selectedOrder ? (
        <OrderContextDialog
          item={selectedOrder}
          onClose={() => setSelectedOrder(undefined)}
        />
      ) : null}
    </main>
  );
}
