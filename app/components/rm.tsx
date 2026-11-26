import type { ReactNode } from "react";
import { Link } from "@remix-run/react";
import { Icon } from "@shopify/polaris";
import type { IconSource } from "@shopify/polaris";

/**
 * Rankmath SEO visual components (styles: app/styles/rm.css). They sit inside
 * Polaris Cards and Pages; use them for scores, stats, action lists and chips
 * so every screen looks the same.
 */

export type Tone = "good" | "warn" | "bad" | "brand" | "plain";

export function scoreLevel(score: number | null | undefined, goodAt = 80): "good" | "warn" | "bad" | "none" {
  if (score === null || score === undefined || Number.isNaN(score)) return "none";
  return score >= goodAt ? "good" : score >= 50 ? "warn" : "bad";
}

const RING_COLORS = { good: "#1a8754", warn: "#c58a00", bad: "#c4291c", none: "#c9cccf" } as const;

/** Circular 0–100 score, as in the editors and SEO Analyzer. */
export function ScoreRing({ score, size = 120, label, caption, goodAt = 80 }: { score: number | null | undefined; size?: number; label?: string; caption?: string; /** Lighthouse uses 90. */ goodAt?: number }) {
  const level = scoreLevel(score, goodAt);
  const stroke = Math.max(6, Math.round(size / 10));
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const value = level === "none" ? 0 : Math.max(0, Math.min(100, score as number));
  const center = size / 2;
  return (
    <svg className="rm-ring" width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label || (level === "none" ? "Not scored yet" : `Score ${value} out of 100`)}>
      <circle cx={center} cy={center} r={radius} fill="none" stroke="#eeeef6" strokeWidth={stroke} />
      {level !== "none" && (
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={RING_COLORS[level]}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${(value / 100) * circumference} ${circumference}`}
          transform={`rotate(-90 ${center} ${center})`}
        />
      )}
      <text x={center} y={caption ? center + size * 0.02 : center + size * 0.1} textAnchor="middle" fontSize={Math.round(size * 0.3)} fontWeight={700} fill="#1f2124">
        {level === "none" ? "–" : value}
      </text>
      {caption && (
        <text x={center} y={center + size * 0.2} textAnchor="middle" fontSize={Math.max(10, Math.round(size * 0.1))} fill="#5c5f62">
          {caption}
        </text>
      )}
    </svg>
  );
}

/** Small score circle for table rows. */
export function DotScore({ score }: { score: number | null | undefined }) {
  const level = scoreLevel(score);
  return (
    <span className={`rm-dot-score${level === "good" ? " rm-dot-score--good" : level === "bad" ? " rm-dot-score--bad" : level === "none" ? " rm-dot-score--none" : ""}`} aria-label={level === "none" ? "Not scanned" : `Score ${score}`}>
      {level === "none" ? "–" : score}
    </span>
  );
}

export function StatTiles({ children }: { children: ReactNode }) {
  return <div className="rm-tiles">{children}</div>;
}

export function StatTile({ label, value, hint, tone = "plain" }: { label: string; value: ReactNode; hint?: ReactNode; tone?: Tone | "dark" }) {
  return (
    <div className={`rm-tile rm-tile--${tone}`}>
      <div className="rm-tile__label">{label}</div>
      <div className="rm-tile__value">{value}</div>
      {hint && <div className="rm-tile__hint">{hint}</div>}
    </div>
  );
}

export function IconTile({ icon, tone = "plain", size }: { icon: IconSource; tone?: Tone | "dark"; size?: "sm" | "lg" }) {
  return (
    <span className={`rm-icon rm-icon--${tone}${size ? ` rm-icon--${size}` : ""}`} aria-hidden>
      <Icon source={icon} />
    </span>
  );
}

export function Pill({ tone = "plain", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`rm-pill rm-pill--${tone}`}>{children}</span>;
}

export function impactTone(impact: string | undefined): Tone {
  return impact === "High" ? "bad" : impact === "Medium" ? "warn" : "plain";
}

export function ActionRows({ children }: { children: ReactNode }) {
  return <div className="rm-rows">{children}</div>;
}

/** Icon · title/description · pill · action, as in "Next best actions" and SEO checks. */
export function ActionRow({ icon, iconTone = "plain", title, text, meta, aside }: { icon?: IconSource; iconTone?: Tone | "dark"; title: ReactNode; text?: ReactNode; meta?: ReactNode; aside?: ReactNode }) {
  return (
    <div className="rm-row">
      {icon && <IconTile icon={icon} tone={iconTone} />}
      <div className="rm-row__body">
        <div className="rm-row__title">{title}</div>
        {text && <div className="rm-row__text">{text}</div>}
        {meta && <div className="rm-row__meta">{meta}</div>}
      </div>
      {aside && <div className="rm-row__aside">{aside}</div>}
    </div>
  );
}

export function GroupLabel({ children, aside, tone }: { children: ReactNode; aside?: ReactNode; tone?: "good" }) {
  return (
    <div className={`rm-group-label${tone ? ` rm-group-label--${tone}` : ""}`}>
      <span>{children}</span>
      {aside}
    </div>
  );
}

export type ChipItem = { id: string; label: string; count?: number | string; to?: string; onClick?: () => void };

/** Rounded switcher for scopes and filters (one row; never a second tab bar). */
export function Chips({ items, active, label }: { items: ChipItem[]; active: string; label: string }) {
  return (
    <div className="rm-chips" role="group" aria-label={label}>
      {items.map((item) => {
        const className = `rm-chip${item.id === active ? " rm-chip--active" : ""}`;
        const content = (
          <>
            {item.label}
            {item.count !== undefined && item.count !== "" && <span className="rm-chip__count">{item.count}</span>}
          </>
        );
        return item.to ? (
          <Link key={item.id} to={item.to} className={className} aria-current={item.id === active ? "page" : undefined}>{content}</Link>
        ) : (
          <button key={item.id} type="button" className={className} aria-pressed={item.id === active} onClick={item.onClick}>{content}</button>
        );
      })}
    </div>
  );
}

export function CheckItem({ status, children }: { status: "pass" | "warn" | "fail"; children: ReactNode }) {
  return (
    <div className={`rm-check rm-check--${status}`}>
      <span className="rm-check__mark" aria-label={status === "pass" ? "Passed" : status === "warn" ? "Warning" : "Failed"}>{status === "pass" ? "✓" : status === "warn" ? "!" : "✕"}</span>
      <span>{children}</span>
    </div>
  );
}

/** The brand-colored button used for AI actions. */
export function AiButton({ children, onClick, disabled, loading, fullWidth, url }: { children: ReactNode; onClick?: () => void; disabled?: boolean; loading?: boolean; fullWidth?: boolean; url?: string }) {
  const className = `rm-ai-button${fullWidth ? " rm-ai-button--full" : ""}`;
  if (url) return <Link to={url} className={className}>{children}</Link>;
  return (
    <button type="button" className={className} onClick={onClick} disabled={disabled || loading} aria-busy={loading || undefined}>
      {loading ? "Working…" : children}
    </button>
  );
}

export function Bar({ value, tone }: { value: number; tone?: "good" | "warn" | "bad" }) {
  return (
    <div className={`rm-bar${tone ? ` rm-bar--${tone}` : ""}`} role="progressbar" aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={100}>
      <span style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

export function Funnel({ steps }: { steps: Array<{ label: string; value: number; display: string; color?: string }> }) {
  const max = Math.max(1, ...steps.map((step) => step.value));
  return (
    <div className="rm-funnel">
      {steps.map((step) => (
        <div className="rm-funnel__row" key={step.label}>
          <span>{step.label}</span>
          <div className="rm-funnel__bar" style={{ width: `${Math.max(1, (step.value / max) * 100)}%`, background: step.color }} />
          <span className="rm-funnel__value">{step.display}</span>
        </div>
      ))}
    </div>
  );
}

export function Steps({ steps, active }: { steps: Array<{ title: string; text: string }>; active: number }) {
  return (
    <ol className="rm-steps">
      {steps.map((step, index) => (
        <li key={step.title} className={`rm-step${index === active ? " rm-step--active" : index < active ? " rm-step--done" : ""}`} aria-current={index === active ? "step" : undefined}>
          <span className="rm-step__n">{index < active ? "✓" : index + 1}</span>
          <span><span className="rm-step__title">{step.title}</span><span className="rm-step__text">{step.text}</span></span>
        </li>
      ))}
    </ol>
  );
}
