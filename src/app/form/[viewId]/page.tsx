"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { FormRenderer } from "@/components/form/form-renderer";
import type { FormConfig } from "@/lib/query-engine";
import type { FieldRow } from "@/types";
import type { FormMember } from "@/components/form/form-field-input";

interface PublicForm {
  tableName: string;
  fields: FieldRow[];
  members: FormMember[];
  config: FormConfig;
}

export default function PublicFormPage() {
  const params = useParams<{ viewId: string }>();
  const [form, setForm] = useState<PublicForm | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    fetch(`/api/public/forms/${params.viewId}`)
      .then((res) => {
        if (!res.ok) throw new Error();
        return res.json();
      })
      .then(setForm)
      .catch(() => setNotFound(true));
  }, [params.viewId]);

  async function handleSubmit(data: Record<string, unknown>) {
    const res = await fetch(`/api/public/forms/${params.viewId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || "Failed to submit");
    }
  }

  if (notFound) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-neutral-400">
        This form isn&apos;t available.
      </div>
    );
  }
  if (!form) {
    return <div className="min-h-screen flex items-center justify-center text-sm text-neutral-400">Loading…</div>;
  }

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950 py-12 px-4">
      <div className="max-w-xl mx-auto">
        <FormRenderer tableName={form.tableName} fields={form.fields} members={form.members} config={form.config} onSubmit={handleSubmit} />
      </div>
    </div>
  );
}
