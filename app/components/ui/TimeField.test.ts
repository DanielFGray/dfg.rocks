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

/** The control's classes as tokens, so a reordered or merged class list still matches. */
function controlClasses(error?: string): string[] {
  const control = controlMarkup(error);
  const attribute = /class="([^"]*)"/.exec(control);
  if (!attribute) throw new Error(`no class attribute in ${control}`);
  return tokens(attribute[1]);
}

/** The classes a field recipe slot produces, as tokens. */
function tokens(classes: string): string[] {
  return classes.split(/\s+/).filter(Boolean);
}

test("an error marks the control invalid", () => {
  expect(controlMarkup("Required")).toContain('data-invalid="true"');
});

test("an error gives the control a red border", () => {
  // Stated literally so the assertion fails if the invalid variant stops producing a border,
  // even when the recipe and the component change together.
  expect(controlClasses("Required")).toContain("border-red-500/50");
});

test("no error leaves the control valid", () => {
  expect(controlMarkup()).not.toContain('data-invalid="true"');
  expect(controlClasses()).not.toContain("border-red-500/50");
});

test("the control takes its classes from the field recipe", () => {
  expect(controlClasses("Required")).toEqual(
    expect.arrayContaining(tokens(field({ invalid: true }).control({ className: "flex" }))),
  );
  expect(controlClasses()).toEqual(
    expect.arrayContaining(tokens(field().control({ className: "flex" }))),
  );
});
