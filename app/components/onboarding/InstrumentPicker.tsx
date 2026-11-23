import { contact } from "../../config.js";
import { experienceLabels, experienceValues } from "../../../shared/studentProfile.js";
import type { StudentInstrument } from "../../../shared/studentProfile.js";
import { Input } from "../ui/Input.js";
import { Select } from "../ui/Select.js";
import { ToggleButton } from "../ui/ToggleButton.js";

const experienceOptions = experienceValues.map((value) => ({
  value,
  label: experienceLabels[value],
}));

/**
 * Which instruments a student wants to learn, and how long they have played each. The
 * instruments are the contact form's list; choosing "Something else" asks for its name.
 */
export function InstrumentPicker({
  idPrefix,
  value,
  onChange,
  disabled,
}: {
  idPrefix: string;
  value: readonly StudentInstrument[];
  onChange: (value: StudentInstrument[]) => void;
  disabled?: boolean;
}) {
  const chosen = (instrument: StudentInstrument["instrument"]) =>
    value.find((item) => item.instrument === instrument);
  const update = (
    instrument: StudentInstrument["instrument"],
    change: Partial<StudentInstrument>,
  ) =>
    onChange(value.map((item) => (item.instrument === instrument ? { ...item, ...change } : item)));
  const toggle = (instrument: StudentInstrument["instrument"], on: boolean) =>
    onChange(
      on
        ? [...value, { instrument, experience: "none" }]
        : value.filter((item) => item.instrument !== instrument),
    );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Instruments">
        {contact.instruments.map((option) => (
          <ToggleButton
            key={option.value}
            isSelected={chosen(option.value) !== undefined}
            onChange={(on) => toggle(option.value, on)}
            isDisabled={disabled}
            data-testid={`${idPrefix}-instrument-${option.value}`}
          >
            {option.label}
          </ToggleButton>
        ))}
      </div>
      {value.map((item) => {
        const label =
          contact.instruments.find((option) => option.value === item.instrument)?.label ??
          item.instrument;
        return (
          <div
            key={item.instrument}
            className="grid gap-3 rounded-xl border border-overlay/8 p-4 sm:grid-cols-2 dark:border-overlay-dark/8"
          >
            {item.instrument === "other" ? (
              <Input
                id={`${idPrefix}-other-name`}
                name="other_instrument"
                label="Which instrument?"
                value={item.other_instrument ?? ""}
                onChange={(other) => update("other", { other_instrument: other })}
                disabled={disabled}
                data-testid={`${idPrefix}-other-name`}
              />
            ) : (
              <p className="self-center font-medium">{label}</p>
            )}
            <Select
              id={`${idPrefix}-experience-${item.instrument}`}
              name={`experience-${item.instrument}`}
              label="How long have you played?"
              options={experienceOptions}
              value={item.experience}
              onChange={(experience) =>
                update(item.instrument, {
                  experience: experienceValues.find((v) => v === experience) ?? "none",
                })
              }
              disabled={disabled}
              data-testid={`${idPrefix}-experience-${item.instrument}`}
            />
          </div>
        );
      })}
    </div>
  );
}
