import { cn, initials } from "@/lib/utils";

/** Workspace logo, or its initials on the accent colour when no logo is set. */
export function WorkspaceAvatar({ name, logoUrl, size = 28, className }: { name: string; logoUrl?: string | null; size?: number; className?: string }) {
  const style = { width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.4)) };
  if (logoUrl)
    // eslint-disable-next-line @next/next/no-img-element -- small DB-served logo
    return <img src={logoUrl} alt="" style={style} className={cn("rounded-lg object-cover shrink-0 bg-white", className)} />;
  return (
    <span style={style} className={cn("rounded-lg bg-indigo-600 text-white font-semibold flex items-center justify-center shrink-0", className)}>
      {initials(name)}
    </span>
  );
}
