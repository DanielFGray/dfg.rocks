import { expect, test } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { field } from "./field.js";
import { TimeField } from "./TimeField.js";

/**
 * The server's markup for the control group: the attributes and classes a browser receives,
 * which is where react-aria publishes the field's invalid state.
 */
function controlMarkup(error?: string): string {
  const markup = renderToStaticMarkup(
    createElement(TimeField, { label: "Time", value: null, onChange: () => {}, error }),
  );
  const group = /<div[^>]*role="group"[^>]*>/.exec(markup);
  if (!group) throw new Error(`no time control in ${markup}`);
  return group[0];
}

test("an error marks the control invalid", () => {
  const control = controlMarkup("Required");
  expect(control).toContain('data-invalid="true"');
  // The red border comes from the field recipe's invalid variant, as on the other ui fields.
  expect(control).toContain(field({ invalid: true }).control({ className: "flex" }));
});

test("no error leaves the control valid", () => {
  const control = controlMarkup();
  expect(control).not.toContain('data-invalid="true"');
  expect(control).toContain(field().control({ className: "flex" }));
});
