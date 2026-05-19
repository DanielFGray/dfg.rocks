import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { getHomePageData } from "../lib/routeData.js";
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

const [logoBefore, logoAfter] = site.logo.split(site.logoDot);

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
  component: HomePage,
});

function HomePage() {
  return (
    <>
      <SiteNav />
      <Hero />
      <About />
      <LessonsSection />
      <Testimonials />
      <Contact />
      <Footer />
    </>
  );
}

function SiteNav() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <nav className="top-0 px-6 md:px-8 py-3 md:py-4 bg-surface/90 dark:bg-surface-dark/90 backdrop-blur-md border-overlay/5 dark:border-overlay-dark/5 fixed z-100 flex w-full items-center justify-between border-b">
        <div className="font-bold text-xl tracking-tight">
          {logoBefore}
          <span className="text-accent">{site.logoDot}</span>
          {logoAfter}
        </div>

        <ul className="md:flex gap-8 hidden list-none items-center">
          {nav.links.map((link) => (
            <li key={link.href}>
              <a
                className="text-muted dark:text-muted-dark hover:text-primary dark:hover:text-primary-dark text-[0.95rem] no-underline transition-colors"
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
              className="rounded-lg bg-overlay/5 dark:bg-overlay-dark/5 border-overlay/10 dark:border-overlay-dark/10 px-4 py-1.5 text-sm font-medium text-muted dark:text-muted-dark hover:border-accent/40 hover:text-accent border no-underline transition-all"
            >
              Student Portal
            </Link>
          </li>
        </ul>

        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="md:hidden p-2 text-muted dark:text-muted-dark hover:text-primary dark:hover:text-primary-dark cursor-pointer transition-colors"
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
        </button>
      </nav>

      <Sidebar open={open} onClose={() => setOpen(false)} title="Menu">
        <div className="px-6 py-2 flex flex-col">
          {nav.links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              onClick={() => setOpen(false)}
              className="text-muted dark:text-muted-dark text-base hover:text-primary dark:hover:text-primary-dark no-underline transition-colors"
            >
              <div className="py-3 border-overlay/5 dark:border-overlay-dark/5 border-b">
                {link.label}
              </div>
            </a>
          ))}
          <Link
            to="/login"
            search={{ redirect: undefined }}
            onClick={() => setOpen(false)}
            className="text-accent text-base font-medium hover:text-accent-hover no-underline transition-colors"
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
    <section className="px-5 md:px-8 pb-16 md:pb-24 pt-20 md:min-h-screen mx-auto flex min-h-[85vh] max-w-[1100px] flex-col justify-center">
      <div className="text-accent mb-4 font-semibold text-[0.85rem] tracking-[0.15em] uppercase">
        {hero.eyebrow}
      </div>
      <h1 className="font-bold tracking-tight mb-6 text-[clamp(2.5rem,6vw,4.5rem)] leading-[1.1]">
        {hero.headline}
      </h1>
      <p className="text-muted dark:text-muted-dark mb-10 max-w-[540px] text-[1.2rem]">
        {hero.subtitle}
      </p>
      <div className="gap-3 md:flex-row md:items-center md:gap-4 flex flex-col items-start">
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
    <section id="about" className="px-5 md:px-8 py-16 md:py-24 mx-auto max-w-[1100px]">
      <div className="md:grid-cols-2 gap-10 md:gap-16 grid grid-cols-1 items-center">
        <div className="rounded-xl max-h-[50vh] w-full overflow-hidden">
          <img className="block h-full w-full object-cover" src={site.gravatar} alt={site.name} />
        </div>
        <div>
          <div className="text-accent mb-3 font-semibold text-[0.8rem] tracking-[0.15em] uppercase">
            {about.sectionLabel}
          </div>
          <h2 className="text-4xl font-bold tracking-tight mb-5 leading-[1.15]">{about.heading}</h2>
          {about.paragraphs.map((p, i) => (
            <p key={i} className="text-muted dark:text-muted-dark mb-4">
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
    <section id="lessons" className="px-5 py-16 md:px-8 md:py-24 mx-auto max-w-[1100px]">
      <div className="mb-3 font-semibold text-accent text-[0.8rem] tracking-[0.15em] uppercase">
        {lessons.sectionLabel}
      </div>
      <h2 className="mb-5 text-4xl font-bold tracking-tight leading-[1.15]">{lessons.heading}</h2>
      <div className="mt-10 gap-6 grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))]">
        {lessons.items.map((lesson) => (
          <div
            key={lesson.title}
            className="rounded-xl border-overlay/6 dark:border-overlay-dark/6 bg-card dark:bg-card-dark p-8 hover:-translate-y-0.5 hover:border-accent/30 border transition-all duration-200"
          >
            <div className="mb-4 text-[2rem]">{lesson.icon}</div>
            <h3 className="mb-2 text-xl font-semibold">{lesson.title}</h3>
            <p className="text-muted dark:text-muted-dark text-[0.95rem]">{lesson.description}</p>
            <div className="mt-4 gap-2 flex">
              {lesson.formats.map((f) => (
                <span
                  key={f}
                  className="bg-accent/12 px-3 py-1 text-xs font-semibold text-accent rounded-full"
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

function Testimonials() {
  const { testimonials } = Route.useLoaderData();
  return testimonials.length > 0 ? (
    <section id="testimonials" className="px-5 py-16 md:px-8 md:py-24 mx-auto max-w-[1100px]">
      <div className="mb-3 font-semibold text-accent text-[0.8rem] tracking-[0.15em] uppercase">
        {testimonialsSection.sectionLabel}
      </div>
      <h2 className="mb-5 text-4xl font-bold tracking-tight leading-[1.15]">
        {testimonialsSection.heading}
      </h2>
      <div className="mt-10 gap-6 md:grid-cols-3 grid grid-cols-1">
        {testimonials.map((t) => (
          <div
            key={t.id}
            className="rounded-xl border-overlay/6 dark:border-overlay-dark/6 bg-card dark:bg-card-dark p-8 border"
          >
            <p className="mb-6 text-muted dark:text-muted-dark italic">&ldquo;{t.body}&rdquo;</p>
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

function Contact() {
  return (
    <section id="contact" className="px-5 py-16 md:px-8 md:py-24 mx-auto max-w-[1100px]">
      <div className="max-w-2xl mx-auto text-center">
        <div className="mb-3 font-semibold text-accent text-[0.8rem] tracking-[0.15em] uppercase">
          {contact.sectionLabel}
        </div>
        <h2 className="mb-5 text-4xl font-bold tracking-tight leading-[1.15]">{contact.heading}</h2>
        <p className="mb-10 text-muted dark:text-muted-dark">{contact.description}</p>

        <div className="mb-10 gap-4 sm:flex-row flex flex-col justify-center">
          <a
            href={site.calendar}
            className="gap-3 rounded-xl bg-accent px-9 py-4 text-base font-semibold text-white hover:bg-accent-hover inline-flex items-center justify-center no-underline transition-all hover:-translate-y-px"
          >
            <svg
              className="w-5 h-5"
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
            className="gap-3 rounded-xl border-overlay/20 dark:border-overlay-dark/20 px-9 py-4 text-base font-semibold text-primary dark:text-primary-dark hover:border-accent hover:text-accent inline-flex items-center justify-center border bg-transparent no-underline transition-all hover:-translate-y-px"
          >
            <svg
              className="w-5 h-5"
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
            className="gap-3 rounded-xl border-overlay/20 dark:border-overlay-dark/20 px-9 py-4 text-base font-semibold text-primary dark:text-primary-dark hover:border-accent hover:text-accent inline-flex items-center justify-center border bg-transparent no-underline transition-all hover:-translate-y-px"
          >
            <svg
              className="w-5 h-5"
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

        <div className="gap-x-8 gap-y-3 text-sm text-muted dark:text-muted-dark flex flex-wrap justify-center">
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
    <footer className="px-8 py-12 text-muted dark:text-muted-dark border-overlay/5 dark:border-overlay-dark/5 border-t text-center text-[0.85rem]">
      <p>
        &copy; {site.year} {site.business}. All rights reserved.
      </p>
    </footer>
  );
}
