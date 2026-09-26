"use client";
import { useCallback, useEffect, useState } from "react";
import { Plus, ExternalLink } from "lucide-react";
import { api } from "@/lib/api-client";
import { toast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Badge, Switch } from "@/components/ui/misc";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { formatDate } from "@/lib/utils";
import type { DesktopReleaseDto } from "@/lib/desktop-releases";

/**
 * Release registry. CI registers releases automatically; this panel is for
 * pulling a bad build (unpublish -> the Download link falls back to the
 * previous version) or registering a build manually when CI isn't set up.
 */
export function DesktopReleasesPanel() {
  const [rows, setRows] = useState<DesktopReleaseDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      setRows(await api.get<DesktopReleaseDto[]>("/api/desktop/releases"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load releases");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
    load();
  }, [load]);

  async function togglePublished(r: DesktopReleaseDto, isPublished: boolean) {
    try {
      await api.patch(`/api/admin/desktop-releases/${r.id}`, { isPublished });
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update failed");
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-neutral-500">
          The <a href="/download" className="text-indigo-600 hover:underline">Download page</a> and the in-app updater always use the highest published version.
        </p>
        <Button variant="secondary" onClick={() => setOpen(true)}>
          <Plus size={14} /> Register release
        </Button>
      </div>
      <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 overflow-x-auto">
        <table className="w-full">
          <thead className="text-xs text-neutral-500 border-b border-neutral-200 dark:border-neutral-800">
            <tr>
              <th className="text-left font-medium px-4 py-2">Version</th>
              <th className="text-left font-medium px-4 py-2">Channel</th>
              <th className="text-left font-medium px-4 py-2">Released</th>
              <th className="text-left font-medium px-4 py-2">Installer</th>
              <th className="text-left font-medium px-4 py-2">Auto-update</th>
              <th className="text-left font-medium px-4 py-2">Published</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-neutral-400">Loading…</td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-neutral-400">No releases yet. Tag a release (see docs/DESKTOP.md) or register one manually.</td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="border-b last:border-0 border-neutral-100 dark:border-neutral-800">
                <td className="px-4 py-2 font-medium">v{r.version}</td>
                <td className="px-4 py-2 capitalize">{r.channel}</td>
                <td className="px-4 py-2 text-neutral-500">{formatDate(r.publishedAt)}</td>
                <td className="px-4 py-2">
                  <a href={r.downloadUrl} className="inline-flex items-center gap-1 text-indigo-600 hover:underline">
                    {r.installerFileName} <ExternalLink size={11} />
                  </a>
                </td>
                <td className="px-4 py-2">{r.updaterReady ? <Badge className="bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300">Signed</Badge> : <span className="text-neutral-400 text-xs">Not signed</span>}</td>
                <td className="px-4 py-2">
                  <Switch checked={r.isPublished} onCheckedChange={(v) => togglePublished(r, v)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <RegisterDialog open={open} onOpenChange={setOpen} onDone={load} />
    </div>
  );
}

function RegisterDialog({ open, onOpenChange, onDone }: { open: boolean; onOpenChange: (v: boolean) => void; onDone: () => void }) {
  const [version, setVersion] = useState("");
  const [installerUrl, setInstallerUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const fileName = decodeURIComponent(new URL(installerUrl).pathname.split("/").pop() || "installer");
      await api.post("/api/desktop/releases", { version: version.trim().replace(/^v/, ""), installerUrl: installerUrl.trim(), installerFileName: fileName, releaseNotes: notes || undefined });
      toast.success("Release registered");
      onOpenChange(false);
      setVersion("");
      setInstallerUrl("");
      setNotes("");
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to register release");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogTitle>Register desktop release</DialogTitle>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label htmlFor="rel-version" className="text-xs font-medium text-neutral-500 mb-1 block">Version</label>
            <Input id="rel-version" value={version} onChange={(e) => setVersion(e.target.value)} placeholder="1.0.0" required />
          </div>
          <div>
            <label htmlFor="rel-url" className="text-xs font-medium text-neutral-500 mb-1 block">Installer URL (https)</label>
            <Input id="rel-url" value={installerUrl} onChange={(e) => setInstallerUrl(e.target.value)} placeholder="https://github.com/…/releases/download/desktop-v1.0.0/Basework_1.0.0_x64_en-US.msi" required />
          </div>
          <div>
            <label htmlFor="rel-notes" className="text-xs font-medium text-neutral-500 mb-1 block">Release notes (optional)</label>
            <Textarea id="rel-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving ? "Saving…" : "Register"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
