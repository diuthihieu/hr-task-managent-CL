"use client";
import { useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormFieldInput, type FormMember } from "./form-field-input";
import { getOrderedFormFields, isFieldVisible } from "@/lib/form-utils";
import type { FormConfig } from "@/lib/query-engine";
import type { FieldRow } from "@/types";

// Renders the exact same field list the builder configured, whether it's
// being previewed in-app or filled in anonymously on the public /form/[id]
// page - see lib/form-utils.ts for the shared ordering/visibility logic.
export function FormRenderer({
  tableName,
  fields,
  members,
  config,
  onSubmit,
}: {
  tableName: string;
  fields: FieldRow[];
  members: FormMember[];
  config: FormConfig;
  onSubmit: (data: Record<string, unknown>) => Promise<void>;
}) {
  const orderedFields = getOrderedFormFields(fields, config);
  const [values, setValues] = useState<Record<string, unknown>>(() => {
    const initial: Record<string, unknown> = {};
    for (const { field, formField } of orderedFields) {
      if (formField.defaultValue !== undefined) initial[field.id] = formField.defaultValue;
    }
    return initial;
  });
  const [errors, setErrors] = useState<Record<string, boolean>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  function setValue(fieldId: string, value: unknown) {
    setValues((v) => ({ ...v, [fieldId]: value }));
    setErrors((e) => ({ ...e, [fieldId]: false }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const visibleRequired = orderedFields.filter(
      ({ field, formField }) => formField.visible && formField.required && isFieldVisible(field.id, config, values)
    );
    const nextErrors: Record<string, boolean> = {};
    for (const { field } of visibleRequired) {
      const v = values[field.id];
      if (v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length)) nextErrors[field.id] = true;
    }
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors);
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit(values);
      setSubmitted(true);
      setValues({});
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div className="flex flex-col items-center justify-center text-center py-16 gap-3">
        <CheckCircle2 size={40} className="text-green-500" />
        <p className="text-lg font-medium text-neutral-900 dark:text-neutral-50">{config.successMessage || "Thanks! Your response has been recorded."}</p>
        <Button variant="secondary" onClick={() => setSubmitted(false)}>
          Submit another response
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5 max-w-xl">
      <div>
        <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-50">{tableName}</h1>
      </div>
      {orderedFields
        .filter(({ formField }) => formField.visible)
        .map(({ field, formField }) => {
          if (!isFieldVisible(field.id, config, values)) return null;
          return (
            <div key={field.id}>
              <label className="text-sm font-medium text-neutral-800 dark:text-neutral-100 mb-1 block">
                {field.name}
                {formField.required && <span className="text-red-500 ml-0.5">*</span>}
              </label>
              {formField.description && <p className="text-xs text-neutral-500 mb-1.5">{formField.description}</p>}
              <FormFieldInput field={field} value={values[field.id]} members={members} onChange={(v) => setValue(field.id, v)} />
              {errors[field.id] && <p className="text-xs text-red-500 mt-1">This field is required.</p>}
            </div>
          );
        })}
      <Button type="submit" disabled={submitting} className="justify-center">
        {submitting ? "Submitting…" : config.submitLabel || "Submit"}
      </Button>
    </form>
  );
}
