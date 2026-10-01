import assert from "node:assert/strict";
import test from "node:test";
import { CUSTOM_FIELD_TYPE_IDS, getFieldType } from "../field-types";
import { isFieldFormable } from "../form-utils";
import type { FieldRow } from "@/types";

const advanced = ["team", "location", "signature", "link", "lookup", "rollup", "button", "barcode", "ai_field", "json", "api_result"];

function field(type: string): FieldRow {
  return { id: `field-${type}`, projectId: "p", name: type, type, config: null, order: 0, isPrimary: false, visible: true, description: null, defaultValue: null };
}

test("all eleven advanced custom field types are enabled", () => {
  for (const type of advanced) {
    assert.ok(CUSTOM_FIELD_TYPE_IDS.includes(type), `${type} is missing from custom field registry`);
    assert.equal(getFieldType(type).comingSoon, undefined);
  }
});

test("safe standalone advanced inputs are available on forms while relational/computed fields stay out", () => {
  for (const type of ["team", "location", "signature", "barcode", "json"]) assert.equal(isFieldFormable(field(type)), true, type);
  for (const type of ["link", "lookup", "rollup", "button", "ai_field", "api_result"]) assert.equal(isFieldFormable(field(type)), false, type);
});
