import { Effect } from "effect";
import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { api } from "../../lib/api.js";
import { getErrorMessage } from "../../lib/errors.js";
import { useAuth } from "../../lib/hooks/useAuth.js";
import { authUserQuery } from "../../lib/queries.js";
import { InstrumentPicker } from "../../components/onboarding/InstrumentPicker.js";
import { Button } from "../../components/ui/Button.js";
import { Card } from "../../components/ui/Card.js";
import { Input } from "../../components/ui/Input.js";
import { Textarea } from "../../components/ui/Textarea.js";
import type { OnboardingState } from "../../../shared/api/onboarding.js";
import type { StudentInstrument } from "../../../shared/studentProfile.js";

export const Route = createFileRoute("/_authed/onboarding")({
  head: () => ({ meta: [{ title: "Welcome | DFG Portal" }] }),
  component: OnboardingPage,
});

const onboardingQuery = {
  queryKey: ["onboarding"],
  queryFn: () => Effect.runPromise(api.onboarding.onboardingState()),
} as const;

type Step = "welcome" | "account" | "instruments" | "background" | "children";

const studentSteps: readonly Step[] = ["welcome", "account", "instruments", "background"];
const parentSteps: readonly Step[] = ["welcome", "account", "children"];

/**
 * The steps a new student or parent sees once, at first login. Every answer except the
 * children is saved together when they finish; each child is saved as it is added.
 */
function OnboardingPage() {
  const { data: state } = useSuspenseQuery(onboardingQuery);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const steps = state.role === "parent" ? parentSteps : studentSteps;
  const [stepIndex, setStepIndex] = useState(0);
  const [name, setName] = useState(state.name);
  const [username, setUsername] = useState(state.username);
  const [password, setPassword] = useState("");
  const [instruments, setInstruments] = useState<StudentInstrument[]>([
    ...state.profile.instruments,
  ]);
  const [background, setBackground] = useState(state.profile.background);

  const finish = useMutation({
    mutationFn: () =>
      Effect.runPromise(
        api.onboarding.finishOnboarding({
          payload: {
            name,
            username,
            password: password === "" ? undefined : password,
            profile: state.role === "parent" ? undefined : { background, instruments },
          },
        }),
      ),
    onSuccess: async () => {
      // The layout's guard reads the cached auth state: refresh it before leaving, or the
      // guard sends the person straight back here.
      await queryClient.fetchQuery({ ...authUserQuery, staleTime: 0 });
      await navigate({ to: "/dashboard" });
    },
  });

  const step = steps[stepIndex] ?? "welcome";
  const isLast = stepIndex === steps.length - 1;
  const accountError =
    name.trim() === ""
      ? "Enter your name"
      : !/^[a-zA-Z][a-zA-Z0-9_-]+$/.test(username) || username.length > 64
        ? "Usernames start with a letter and use letters, numbers, _ and -"
        : password !== "" && password.length < 8
          ? "Passwords need at least 8 characters"
          : null;
  const otherUnnamed = instruments.some(
    (item) => item.instrument === "other" && !item.other_instrument?.trim(),
  );
  const blocked =
    (step === "account" && accountError !== null) || (step === "instruments" && otherUnnamed);

  const next = () => {
    if (isLast) finish.mutate();
    else setStepIndex(stepIndex + 1);
  };

  return (
    <main data-testid="onboarding" className="mx-auto max-w-2xl px-5 pt-16 pb-16 md:px-8">
      <p className="mb-3 text-sm text-muted dark:text-muted-dark">
        Step {stepIndex + 1} of {steps.length}
      </p>
      <Card>
        <div data-testid={`onboarding-step-${step}`} className="space-y-6">
          {step === "welcome" ? <Welcome state={state} /> : null}
          {step === "account" ? (
            <AccountStep
              hasPassword={state.hasPassword}
              name={name}
              username={username}
              password={password}
              onName={setName}
              onUsername={setUsername}
              onPassword={setPassword}
              error={accountError}
            />
          ) : null}
          {step === "instruments" ? (
            <section className="space-y-4">
              <h1 className="text-2xl font-bold tracking-tight">What do you want to learn?</h1>
              <p className="text-sm text-muted dark:text-muted-dark">
                Pick every instrument you are interested in. You can change this later in Settings.
              </p>
              <InstrumentPicker idPrefix="me" value={instruments} onChange={setInstruments} />
            </section>
          ) : null}
          {step === "background" ? (
            <section className="space-y-4">
              <h1 className="text-2xl font-bold tracking-tight">Tell me about yourself</h1>
              <Textarea
                id="background"
                name="background"
                label="How did you get into music, and what do you want from lessons?"
                rows={6}
                value={background}
                onChange={setBackground}
                data-testid="onboarding-background"
              />
            </section>
          ) : null}
          {step === "children" ? <ChildrenStep /> : null}

          {finish.isError ? (
            <p
              role="alert"
              data-testid="onboarding-error"
              className="text-sm text-red-600 dark:text-red-400"
            >
              {getErrorMessage(finish.error, "Could not save your answers")}
            </p>
          ) : null}

          <div className="flex justify-between gap-3">
            {stepIndex > 0 ? (
              <Button variant="ghost" onClick={() => setStepIndex(stepIndex - 1)}>
                Back
              </Button>
            ) : (
              <span />
            )}
            <Button
              onClick={next}
              disabled={blocked || finish.isPending}
              data-testid="onboarding-next"
            >
              {isLast ? (finish.isPending ? "Saving..." : "Finish") : "Next"}
            </Button>
          </div>
        </div>
      </Card>
    </main>
  );
}

function Welcome({ state }: { state: OnboardingState }) {
  return (
    <section className="space-y-4">
      <h1 className="text-3xl font-bold tracking-tight">
        Welcome{state.name ? `, ${state.name}` : ""}!
      </h1>
      <p className="text-muted dark:text-muted-dark">
        {state.role === "parent"
          ? "Let's set up your account and add your students. It takes a minute."
          : "Let's set up your account and hear what you want to learn. It takes a minute."}
      </p>
      {state.invitation?.message ? (
        <blockquote
          data-testid="onboarding-message"
          className="border-l-4 border-accent/50 pl-4 text-sm whitespace-pre-line"
        >
          {state.invitation.message}
          {state.invitation.inviterName ? (
            <span className="mt-2 block text-muted dark:text-muted-dark">
              — {state.invitation.inviterName}
            </span>
          ) : null}
        </blockquote>
      ) : null}
    </section>
  );
}

function AccountStep(props: {
  hasPassword: boolean;
  name: string;
  username: string;
  password: string;
  onName: (value: string) => void;
  onUsername: (value: string) => void;
  onPassword: (value: string) => void;
  error: string | null;
}) {
  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">Your account</h1>
      <Input
        id="onboarding-name"
        name="name"
        label="Name"
        value={props.name}
        onChange={props.onName}
        autoComplete="name"
        data-testid="onboarding-name"
      />
      <Input
        id="onboarding-username"
        name="username"
        label="Username"
        value={props.username}
        onChange={props.onUsername}
        autoComplete="username"
        data-testid="onboarding-username"
      />
      {props.hasPassword ? null : (
        <div className="space-y-1">
          <Input
            id="onboarding-password"
            name="password"
            type="password"
            label="Password (optional)"
            value={props.password}
            onChange={props.onPassword}
            autoComplete="new-password"
            data-testid="onboarding-password"
          />
          <p className="text-xs text-muted dark:text-muted-dark">
            Without one, you log in with a link sent to your email.
          </p>
        </div>
      )}
      {props.error ? (
        <p
          className="text-sm text-muted dark:text-muted-dark"
          data-testid="onboarding-account-hint"
        >
          {props.error}
        </p>
      ) : null}
    </section>
  );
}

/** A parent adds each child with the child's instruments; each one is saved at once. */
function ChildrenStep() {
  const { familyStudents } = useAuth();
  const queryClient = useQueryClient();
  const [childName, setChildName] = useState("");
  const [instruments, setInstruments] = useState<StudentInstrument[]>([]);
  const add = useMutation({
    mutationFn: () =>
      Effect.runPromise(
        api.families.createChild({ payload: { name: childName.trim(), instruments } }),
      ),
    onSuccess: async () => {
      setChildName("");
      setInstruments([]);
      await queryClient.fetchQuery({ ...authUserQuery, staleTime: 0 });
    },
  });
  const otherUnnamed = instruments.some(
    (item) => item.instrument === "other" && !item.other_instrument?.trim(),
  );

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">Your students</h1>
      <p className="text-sm text-muted dark:text-muted-dark">
        Add each child who takes lessons. They don't need their own login. You can add more later.
      </p>
      {familyStudents.length > 0 ? (
        <ul data-testid="onboarding-children" className="list-disc space-y-1 pl-5 text-sm">
          {familyStudents.map((child) => (
            <li key={child.id}>{child.name || child.username}</li>
          ))}
        </ul>
      ) : null}
      <div className="space-y-4 rounded-xl border border-overlay/8 p-4 dark:border-overlay-dark/8">
        <Input
          id="child-name"
          name="child-name"
          label="Student name"
          value={childName}
          onChange={setChildName}
          data-testid="onboarding-child-name"
        />
        <InstrumentPicker idPrefix="child" value={instruments} onChange={setInstruments} />
        {add.isError ? (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {getErrorMessage(add.error, "Could not add the student")}
          </p>
        ) : null}
        <Button
          variant="outline"
          onClick={() => add.mutate()}
          disabled={childName.trim() === "" || otherUnnamed || add.isPending}
          data-testid="onboarding-add-child"
        >
          {add.isPending ? "Adding..." : "Add student"}
        </Button>
      </div>
    </section>
  );
}
