import { z } from "zod";
import { normalizeTag } from "./links-core";

// Validation for knowledge metadata sent by the page's properties panel.

const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .nullable();

export const knowledgeMetaSchema = z
  .object({
    kind: z.enum(["page", "meeting", "retrospective", "process", "note"]).optional(),
    status: z.enum(["draft", "current", "outdated", "superseded", "archived"]).optional(),
    tags: z
      .array(z.string().max(60))
      .max(30)
      .transform((a) => [...new Set(a.map(normalizeTag).filter(Boolean))])
      .optional(),
    validFrom: date.optional(),
    validTo: date.optional(),
    eventDate: date.optional(),
    sourceType: z.enum(["manual", "imported", "ai_generated", "converted"]).optional(),
    sourceLabel: z.string().trim().max(300).nullable().optional(),
    sourceUrl: z
      .string()
      .trim()
      .max(1000)
      .refine((u) => /^(https?:\/\/|\/)/i.test(u), "Source link must be a web address or an app link")
      .nullable()
      .optional(),
    confidence: z.enum(["low", "medium", "high"]).nullable().optional(),
    /** "I checked this page is still correct" - stamps last checked. */
    markChecked: z.boolean().optional(),
  })
  .refine((m) => !m.validFrom || !m.validTo || m.validTo >= m.validFrom, { message: "Valid to must be on or after valid from", path: ["validTo"] });

export type KnowledgeMetaInput = z.infer<typeof knowledgeMetaSchema>;

export const toDate = (s: string | null | undefined) => (s === undefined ? undefined : s === null ? null : new Date(`${s}T00:00:00Z`));
