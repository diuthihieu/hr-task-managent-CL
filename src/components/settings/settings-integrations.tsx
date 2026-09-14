import { MessageSquare, Mail, Webhook, Calendar } from "lucide-react";
import { SettingsSection } from "./settings-shell";

const INTEGRATIONS = [
  { name: "Slack", description: "Post task updates and mentions to a channel.", icon: MessageSquare },
  { name: "Email", description: "Send digest and reminder emails.", icon: Mail },
  { name: "Webhooks", description: "Push record events to an external URL.", icon: Webhook },
  { name: "Calendar sync", description: "Two-way sync of due dates with Google/Outlook.", icon: Calendar },
];

export function SettingsIntegrations() {
  return (
    <SettingsSection title="Integrations" description="Connect external tools to this workspace.">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-2xl">
        {INTEGRATIONS.map((i) => (
          <div key={i.name} className="flex items-center gap-3 rounded-lg border border-neutral-200 dark:border-neutral-800 px-3 py-3">
            <div className="h-9 w-9 rounded-md bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center shrink-0">
              <i.icon size={16} className="text-neutral-500" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-neutral-800 dark:text-neutral-100">{i.name}</div>
              <div className="text-xs text-neutral-400">{i.description}</div>
            </div>
            <button disabled className="text-xs font-medium text-neutral-400 border border-neutral-200 dark:border-neutral-700 rounded-md px-2 py-1 cursor-not-allowed">
              Coming soon
            </button>
          </div>
        ))}
      </div>
    </SettingsSection>
  );
}
