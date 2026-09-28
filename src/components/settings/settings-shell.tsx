export function SettingsSection({ title, description, action, children }: { title: string; description?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div>
          <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-50">{title}</h2>
          {description && <p className="text-sm text-neutral-500 mt-0.5">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}
