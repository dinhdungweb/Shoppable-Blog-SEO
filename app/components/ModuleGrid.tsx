import { useState } from "react";
import { Button, Checkbox, Link } from "@shopify/polaris";
import type { IconSource } from "@shopify/polaris";
import { Chips, IconTile, type Tone } from "./rm";

export type ModuleStatus = "active" | "off" | "setup" | "locked" | "checking";

export type AppModule = {
  id: string;
  title: string;
  description: string;
  status: ModuleStatus;
  icon: IconSource;
  tone: Tone;
  /** Plan needed when locked, e.g. "Pro". */
  requiredPlan?: string;
  /** Detail under the description, e.g. "12 of 25 AI generations used". */
  detail?: string;
  url: string;
  /** Present when the module can be switched on/off from the dashboard. */
  toggle?: { checked: boolean; pending?: boolean; onChange: (checked: boolean) => void };
};

/** Dashboard › Modules: every feature in one place, with its status and a way in. */
export function ModuleGrid({ modules, planKey }: { modules: AppModule[]; planKey: string }) {
  const [filter, setFilter] = useState<"all" | "active" | "locked">("all");
  const active = modules.filter((module) => module.status === "active").length;
  const locked = modules.filter((module) => module.status === "locked").length;
  const visible = modules.filter((module) => filter === "all" || (filter === "active" ? module.status === "active" : module.status === "locked"));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <Chips
        label="Filter modules"
        active={filter}
        items={[
          { id: "all", label: "All", count: modules.length, onClick: () => setFilter("all") },
          { id: "active", label: "Active", count: active, onClick: () => setFilter("active") },
          ...(locked ? [{ id: "locked", label: "Locked", count: locked, onClick: () => setFilter("locked") }] : []),
        ]}
      />
      <div className="rm-modules">
        {visible.map((module) => {
          const isLocked = module.status === "locked";
          return (
            <div key={module.id} className={`rm-module${isLocked ? " rm-module--locked" : ""}`}>
              <IconTile icon={module.icon} tone={isLocked ? "plain" : module.tone} />
              <div className="rm-module__body">
                <div className="rm-module__title">{module.title}</div>
                <div className="rm-module__text">
                  {isLocked ? `${module.requiredPlan} plan` : module.status === "setup" ? "Needs setup" : module.status === "checking" ? "Checking…" : module.detail || module.description}
                </div>
              </div>
              {isLocked ? (
                <Link url={`/app/pricing?reason=${encodeURIComponent(module.id)}&plan=${planKey}`} removeUnderline>Upgrade</Link>
              ) : module.toggle ? (
                <Checkbox label={`${module.title} enabled`} labelHidden checked={module.toggle.checked} disabled={module.toggle.pending} onChange={module.toggle.onChange} />
              ) : module.status === "setup" ? (
                <Button size="slim" variant="primary" url={module.url}>Set up</Button>
              ) : (
                <Button size="slim" variant="tertiary" url={module.url}>Open</Button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
