import { useState } from "react";
import { Schema as S } from "effect";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  site,
  nav,
  hero,
  about,
  lessons,
  testimonials as testimonialsSection,
  contact,
} from "../config.js";
import { Sidebar } from "../components/ui/Sidebar.js";
import { Button } from "../components/ui/Button.js";
import { Input } from "../components/ui/Input.js";
import { Select } from "../components/ui/Select.js";
import { Textarea } from "../components/ui/Textarea.js";

import { createServerFn } from "@tanstack/react-start";
import { runServerEffect } from "../lib/serverEffect.js";
import { Testimonials } from "../../server/services/testimonials.js";
import { Contact } from "../../server/services/contact.js";

const [logoBefore, logoAfter] = site.logo.split(site.logoDot);

export const getHomePageData = createServerFn({ method: "GET" }).handler(() =>
  runServerEffect(Testimonials.use((testimonialService) => testimonialService.homePageData())),
);

const ContactFormSchema = S.Struct({
  name: S.String.pipe(S.check(S.isNonEmpty())),
  email: S.String.pipe(S.check(S.isNonEmpty())),
  phone: S.optional(S.String),
  instrument: S.String.pipe(S.check(S.isNonEmpty())),
  format: S.String.pipe(S.check(S.isNonEmpty())),
  message: S.optional(S.String),
  website: S.optional(S.String),
});

export const submitContact = createServerFn({ method: "POST" })
  .validator((data) => {
    if (!(data instanceof FormData)) throw new Error("FormData expected");
    const obj: Record<string, unknown> = {};
    for (const [key, value] of data.entries()) {
      obj[key] = value;
    }
    return S.decodeUnknownSync(ContactFormSchema)(obj);
  })
  .handler(async ({ data }) => {
    if (data.website) throw new Error("Invalid submission");
    await runServerEffect(
      Contact.use((contactService) =>
        contactService.submitContact({
          name: data.name,
          email: data.email,
          phone: data.phone,
          instrument: data.instrument,
          format: data.format,
          message: data.message,
        }),
      ),
    );
    throw redirect({ to: "/", search: { sent: true as const } });
  });

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: `${site.business} | Drums, Guitar & More in ${site.city}` },
      {
        name: "description",
        content: `Private music lessons with ${site.name}. Drums, guitar, piano and more. In-person and online in ${site.city}.`,
      },
      {
        property: "og:title",
        content: `${site.business} | Music Lessons in ${site.city}, ${site.state}`,
      },
      {
        property: "og:description",
        content: "Private drum, guitar, piano & bass lessons for all ages. First lesson free.",
      },
      { property: "og:url", content: "https://dfg.rocks/" },
      { property: "og:type", content: "website" },
    ],
    links: [{ rel: "canonical", href: "https://dfg.rocks/" }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "LocalBusiness",
          name: site.business,
          description: "Private music lessons — drums, guitar, piano and more.",
          url: "https://dfg.rocks",
          telephone: site.phone,
          address: {
            "@type": "PostalAddress",
            addressLocality: site.city,
            addressRegion: site.state,
          },
          priceRange: "$$",
          openingHours: "Mo-Sa 09:00-20:00",
        }),
      },
    ],
  }),
  loader: () => getHomePageData(),
  validateSearch: (search: Record<string, unknown>) => ({
    ...(search.sent === "true" ? { sent: true as const } : {}),
  }),
  component: HomePage,
});

function HomePage() {
  return (
    <>
      <SiteNav />
      <Hero />
      <About />
      <LessonsSection />
      <TestimonialSection />
      <ContactSection />
      <Footer />
    </>
  );
}

function SiteNav() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <nav className="fixed top-0 z-100 flex w-full items-center justify-between border-b border-overlay/5 bg-surface/90 px-6 py-3 backdrop-blur-md md:px-8 md:py-4 dark:border-overlay-dark/5 dark:bg-surface-dark/90">
        <div className="text-xl font-bold tracking-tight">
          {logoBefore}
          <span className="text-accent">{site.logoDot}</span>
          {logoAfter}
        </div>

        <ul className="hidden list-none items-center gap-8 md:flex">
          {nav.links.map((link) => (
            <li key={link.href}>
              <a
                className="text-[0.95rem] text-muted no-underline transition-colors hover:text-primary dark:text-muted-dark dark:hover:text-primary-dark"
                href={link.href}
              >
                {link.label}
              </a>
            </li>
          ))}
          <li>
            <Link
              to="/login"
              search={{ redirect: undefined }}
              className="rounded-lg border border-overlay/10 bg-overlay/5 px-4 py-1.5 text-sm font-medium text-muted no-underline transition-all hover:border-accent/40 hover:text-accent dark:border-overlay-dark/10 dark:bg-overlay-dark/5 dark:text-muted-dark"
            >
              Student Portal
            </Link>
          </li>
        </ul>

        <Button
          variant="ghost"
          onClick={() => setOpen(!open)}
          className="p-2 md:hidden"
          aria-label="Toggle menu"
        >
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <line x1="4" y1="7" x2="20" y2="7" />
            <line x1="4" y1="12" x2="20" y2="12" />
            <line x1="4" y1="17" x2="20" y2="17" />
          </svg>
        </Button>
      </nav>

      <Sidebar open={open} onClose={() => setOpen(false)} title="Menu">
        <div className="flex flex-col px-6 py-2">
          {nav.links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              onClick={() => setOpen(false)}
              className="text-base text-muted no-underline transition-colors hover:text-primary dark:text-muted-dark dark:hover:text-primary-dark"
            >
              <div className="border-b border-overlay/5 py-3 dark:border-overlay-dark/5">
                {link.label}
              </div>
            </a>
          ))}
          <Link
            to="/login"
            search={{ redirect: undefined }}
            onClick={() => setOpen(false)}
            className="text-base font-medium text-accent no-underline transition-colors hover:text-accent-hover"
          >
            <div className="py-3">Student Portal</div>
          </Link>
        </div>
      </Sidebar>
    </>
  );
}

function Hero() {
  return (
    <section className="mx-auto flex min-h-[85vh] max-w-275 flex-col justify-center px-5 pt-20 pb-16 md:min-h-screen md:px-8 md:pb-24">
      <div className="mb-4 text-[0.85rem] font-semibold tracking-[0.15em] text-accent uppercase">
        {hero.eyebrow}
      </div>
      <h1 className="mb-6 text-[clamp(2.5rem,6vw,4.5rem)] leading-[1.1] font-bold tracking-tight">
        {hero.headline}
      </h1>
      <p className="mb-10 max-w-135 text-[1.2rem] text-muted dark:text-muted-dark">
        {hero.subtitle}
      </p>
      <div className="flex flex-col items-start gap-3 md:flex-row md:items-center md:gap-4">
        {hero.cta.map((c) => (
          <a
            key={c.label}
            href={c.href}
            className={[
              "inline-block rounded-xl no-underline font-semibold text-base transition-all cursor-pointer px-9 py-4 w-full text-center md:w-auto",
              c.outline
                ? "bg-transparent border-2 border-overlay/15 dark:border-overlay-dark/15 hover:border-overlay/40 dark:hover:border-overlay-dark/40 hover:bg-overlay/5 dark:hover:bg-overlay-dark/5"
                : "bg-accent text-white hover:bg-accent-hover hover:-translate-y-px",
            ].join(" ")}
          >
            {c.label}
          </a>
        ))}
      </div>
    </section>
  );
}

function About() {
  return (
    <section id="about" className="mx-auto max-w-275 px-5 py-16 md:px-8 md:py-24">
      <div className="grid grid-cols-1 items-center gap-10 md:grid-cols-2 md:gap-16">
        <div className="max-h-[50vh] w-full overflow-hidden rounded-xl">
          <img className="block h-full w-full object-cover" src={site.gravatar} alt={site.name} />
        </div>
        <div>
          <div className="mb-3 text-[0.8rem] font-semibold tracking-[0.15em] text-accent uppercase">
            {about.sectionLabel}
          </div>
          <h2 className="mb-5 text-4xl leading-[1.15] font-bold tracking-tight">{about.heading}</h2>
          {about.paragraphs.map((p, i) => (
            <p key={i} className="mb-4 text-muted dark:text-muted-dark">
              {p}
            </p>
          ))}
        </div>
      </div>
    </section>
  );
}

function LessonsSection() {
  return (
    <section id="lessons" className="mx-auto max-w-275 px-5 py-16 md:px-8 md:py-24">
      <div className="mb-3 text-[0.8rem] font-semibold tracking-[0.15em] text-accent uppercase">
        {lessons.sectionLabel}
      </div>
      <h2 className="mb-5 text-4xl leading-[1.15] font-bold tracking-tight">{lessons.heading}</h2>
      <div className="mt-10 grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-6">
        {lessons.items.map((lesson) => (
          <div
            key={lesson.title}
            className="rounded-xl border border-overlay/6 bg-card p-8 transition-all duration-200 hover:-translate-y-0.5 hover:border-accent/30 dark:border-overlay-dark/6 dark:bg-card-dark"
          >
            <div className="mb-4 text-[2rem]">{lesson.icon}</div>
            <h3 className="mb-2 text-xl font-semibold">{lesson.title}</h3>
            <p className="text-[0.95rem] text-muted dark:text-muted-dark">{lesson.description}</p>
            <div className="mt-4 flex gap-2">
              {lesson.formats.map((f) => (
                <span
                  key={f}
                  className="rounded-full bg-accent/12 px-3 py-1 text-xs font-semibold text-accent"
                >
                  {f}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function TestimonialSection() {
  const { testimonials } = Route.useLoaderData();
  return testimonials.length > 0 ? (
    <section
      id="testimonials"
      data-testid="testimonial-section"
      className="mx-auto max-w-275 px-5 py-16 md:px-8 md:py-24"
    >
      <div className="mb-3 text-[0.8rem] font-semibold tracking-[0.15em] text-accent uppercase">
        {testimonialsSection.sectionLabel}
      </div>
      <h2 className="mb-5 text-4xl leading-[1.15] font-bold tracking-tight">
        {testimonialsSection.heading}
      </h2>
      <div className="mt-10 grid grid-cols-1 gap-6 md:grid-cols-3">
        {testimonials.map((t) => (
          <div
            key={t.id}
            data-testid="testimonial-card"
            className="rounded-xl border border-overlay/6 bg-card p-8 dark:border-overlay-dark/6 dark:bg-card-dark"
          >
            <p className="mb-6 text-muted italic dark:text-muted-dark">&ldquo;{t.body}&rdquo;</p>
            <div>
              <div className="font-semibold">{t.display_name}</div>
              <div className="text-sm text-muted dark:text-muted-dark">{t.role_label}</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  ) : null;
}

function ContactSection() {
  const { sent } = Route.useSearch();
  const contactFn = useServerFn(submitContact);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [instrument, setInstrument] = useState("");
  const [format, setFormat] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (sent) {
    return (
      <section id="contact" className="mx-auto max-w-275 px-5 py-16 md:px-8 md:py-24">
        <div className="mx-auto max-w-2xl text-center">
          <div className="mb-10 rounded-xl border border-green-500/30 bg-green-500/5 p-8 text-center dark:border-green-500/20 dark:bg-green-500/5">
            <div className="mb-3 text-3xl">&#x2714;</div>
            <h3 className="mb-2 text-xl font-semibold text-primary dark:text-primary-dark">
              Message Sent!
            </h3>
            <p className="text-sm text-muted dark:text-muted-dark">
              Thanks for reaching out. I'll get back to you within 24 hours.
            </p>
          </div>
          <div className="mb-10 flex flex-col justify-center gap-4 sm:flex-row">
            <a
              href={site.calendar}
              className="inline-flex items-center justify-center gap-3 rounded-xl bg-accent px-9 py-4 text-base font-semibold text-white no-underline transition-all hover:-translate-y-px hover:bg-accent-hover"
            >
              <svg
                className="h-5 w-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                />
              </svg>
              Book Online
            </a>
            <a
              href={`tel:${site.phone}`}
              className="inline-flex items-center justify-center gap-3 rounded-xl border border-overlay/20 bg-transparent px-9 py-4 text-base font-semibold text-primary no-underline transition-all hover:-translate-y-px hover:border-accent hover:text-accent dark:border-overlay-dark/20 dark:text-primary-dark"
            >
              <svg
                className="h-5 w-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"
                />
              </svg>
              Call Me
            </a>
            <a
              href={`mailto:${site.email}`}
              className="inline-flex items-center justify-center gap-3 rounded-xl border border-overlay/20 bg-transparent px-9 py-4 text-base font-semibold text-primary no-underline transition-all hover:-translate-y-px hover:border-accent hover:text-accent dark:border-overlay-dark/20 dark:text-primary-dark"
            >
              <svg
                className="h-5 w-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                />
              </svg>
              Email Me
            </a>
          </div>
          <div className="flex flex-wrap justify-center gap-x-8 gap-y-3 text-sm text-muted dark:text-muted-dark">
            <span>
              <strong className="text-primary dark:text-primary-dark">Location:</strong> {site.city}
              , {site.state}
            </span>
            <span>
              <strong className="text-primary dark:text-primary-dark">Hours:</strong> {site.hours}
            </span>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section id="contact" className="mx-auto max-w-275 px-5 py-16 md:px-8 md:py-24">
      <div className="mx-auto max-w-2xl text-center">
        <div className="mb-3 text-[0.8rem] font-semibold tracking-[0.15em] text-accent uppercase">
          {contact.sectionLabel}
        </div>
        <h2 className="mb-5 text-4xl leading-[1.15] font-bold tracking-tight">{contact.heading}</h2>
        <p className="mb-10 text-muted dark:text-muted-dark">{contact.description}</p>

        <form
          method="post"
          action={submitContact.url}
          onSubmit={(event) => {
            event.preventDefault();
            setPending(true);
            setError(null);
            const formData = new FormData(event.currentTarget);
            contactFn({ data: formData }).catch((err) => {
              setError(err instanceof Error ? err.message : "Failed to send message");
              setPending(false);
            });
          }}
          className="mb-10"
          data-testid="contact-form"
        >
          <div className="flex flex-col gap-5 text-left">
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
              <Input
                id="contact-name"
                name="name"
                label="Name *"
                value={name}
                onChange={setName}
                placeholder="Your name"
                required
              />
              <Input
                id="contact-email"
                name="email"
                label="Email *"
                type="email"
                value={email}
                onChange={setEmail}
                placeholder="you@example.com"
                required
              />
            </div>

            <Input
              id="contact-phone"
              name="phone"
              label="Phone"
              type="tel"
              value={phone}
              onChange={setPhone}
              placeholder="(optional)"
            />

            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
              <Select
                id="contact-instrument"
                name="instrument"
                label="Instrument *"
                options={[{ value: "", label: "Select an instrument..." }, ...contact.instruments]}
                value={instrument}
                onChange={setInstrument}
                required
              />
              <Select
                id="contact-format"
                name="format"
                label="Format *"
                options={[{ value: "", label: "Select format..." }, ...contact.formats]}
                value={format}
                onChange={setFormat}
                required
              />
            </div>

            <Textarea
              id="contact-message"
              name="message"
              label="Message"
              value={message}
              onChange={setMessage}
              placeholder="Tell me about yourself, your goals, or any questions you have..."
              rows={4}
            />

            <input
              type="text"
              name="website"
              style={{ display: "none" }}
              tabIndex={-1}
              autoComplete="off"
            />

            {error ? (
              <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-600 dark:text-red-400">
                {error}
              </div>
            ) : null}

            <Button type="submit" disabled={pending} className="w-full py-4 text-base">
              {pending ? "Sending..." : "Send Message"}
            </Button>
          </div>
        </form>

        <div className="mb-10 flex flex-col justify-center gap-4 sm:flex-row">
          <a
            href={site.calendar}
            className="inline-flex items-center justify-center gap-3 rounded-xl bg-accent px-9 py-4 text-base font-semibold text-white no-underline transition-all hover:-translate-y-px hover:bg-accent-hover"
          >
            <svg
              className="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
              />
            </svg>
            Book Online
          </a>
          <a
            href={`tel:${site.phone}`}
            className="inline-flex items-center justify-center gap-3 rounded-xl border border-overlay/20 bg-transparent px-9 py-4 text-base font-semibold text-primary no-underline transition-all hover:-translate-y-px hover:border-accent hover:text-accent dark:border-overlay-dark/20 dark:text-primary-dark"
          >
            <svg
              className="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"
              />
            </svg>
            Call Me
          </a>
          <a
            href={`mailto:${site.email}`}
            className="inline-flex items-center justify-center gap-3 rounded-xl border border-overlay/20 bg-transparent px-9 py-4 text-base font-semibold text-primary no-underline transition-all hover:-translate-y-px hover:border-accent hover:text-accent dark:border-overlay-dark/20 dark:text-primary-dark"
          >
            <svg
              className="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
              />
            </svg>
            Email Me
          </a>
        </div>

        <div className="flex flex-wrap justify-center gap-x-8 gap-y-3 text-sm text-muted dark:text-muted-dark">
          <span>
            <strong className="text-primary dark:text-primary-dark">Location:</strong> {site.city},{" "}
            {site.state}
          </span>
          <span>
            <strong className="text-primary dark:text-primary-dark">Hours:</strong> {site.hours}
          </span>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-overlay/5 px-8 py-12 text-center text-[0.85rem] text-muted dark:border-overlay-dark/5 dark:text-muted-dark">
      <p>
        &copy; {site.year} {site.business}. All rights reserved.
      </p>
    </footer>
  );
}
