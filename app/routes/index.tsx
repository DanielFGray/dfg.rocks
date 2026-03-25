import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { site, nav, hero, about, lessons, testimonials, contact } from "../config.js";
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
      { property: "og:title", content: `${site.business} | Music Lessons in ${site.city}, ${site.state}` },
      { property: "og:description", content: "Private drum, guitar, piano & bass lessons for all ages. First lesson free." },
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
          address: { "@type": "PostalAddress", addressLocality: site.city, addressRegion: site.state },
          priceRange: "$$",
          openingHours: "Mo-Sa 09:00-20:00",
        }),
      },
    ],
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
      <nav className="fixed top-0 w-full px-6 md:px-8 py-3 md:py-4 flex justify-between items-center bg-surface/90 backdrop-blur-md z-[100] border-b border-white/5">
        <div className="font-bold text-xl tracking-tight">
          {logoBefore}<span className="text-accent">{site.logoDot}</span>{logoAfter}
        </div>

        <ul className="hidden md:flex list-none gap-8 items-center">
          {nav.links.map((link) => (
            <li key={link.href}>
              <a className="text-muted no-underline text-[0.95rem] transition-colors hover:text-primary" href={link.href}>
                {link.label}
              </a>
            </li>
          ))}
          <li>
            <Link
              to="/login"
              className="rounded-lg bg-white/5 border border-white/10 px-4 py-1.5 text-sm font-medium text-muted no-underline transition-all hover:border-accent/40 hover:text-accent"
            >
              Student Portal
            </Link>
          </li>
        </ul>

        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="md:hidden p-2 text-muted hover:text-primary transition-colors cursor-pointer"
          aria-label="Toggle menu"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="4" y1="7" x2="20" y2="7" />
            <line x1="4" y1="12" x2="20" y2="12" />
            <line x1="4" y1="17" x2="20" y2="17" />
          </svg>
        </button>
      </nav>

      <Sidebar open={open} onClose={() => setOpen(false)} title="Menu">
        <div className="flex flex-col px-6 py-2">
          {nav.links.map((link) => (
            <a key={link.href} href={link.href} onClick={() => setOpen(false)} className="text-muted no-underline text-base transition-colors hover:text-primary">
              <div className="py-3 border-b border-white/5">{link.label}</div>
            </a>
          ))}
          <Link to="/login" onClick={() => setOpen(false)} className="text-accent no-underline text-base font-medium transition-colors hover:text-accent-hover">
            <div className="py-3">Student Portal</div>
          </Link>
        </div>
      </Sidebar>
    </>
  );
}

function Hero() {
  return (
    <section className="max-w-[1100px] mx-auto px-5 md:px-8 pb-16 md:pb-24 pt-20 min-h-[85vh] md:min-h-screen flex flex-col justify-center">
      <div className="uppercase tracking-[0.15em] text-[0.85rem] text-accent mb-4 font-semibold">{hero.eyebrow}</div>
      <h1 className="text-[clamp(2.5rem,6vw,4.5rem)] font-bold leading-[1.1] tracking-tight mb-6">{hero.headline}</h1>
      <p className="text-[1.2rem] text-muted max-w-[540px] mb-10">{hero.subtitle}</p>
      <div className="flex flex-col items-start gap-3 md:flex-row md:items-center md:gap-4">
        {hero.cta.map((c) => (
          <a
            key={c.label}
            href={c.href}
            className={[
              "inline-block rounded-xl no-underline font-semibold text-base transition-all cursor-pointer px-9 py-4 w-full text-center md:w-auto",
              c.outline
                ? "bg-transparent border-2 border-white/15 hover:border-white/40 hover:bg-white/5"
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
    <section id="about" className="max-w-[1100px] mx-auto px-5 md:px-8 py-16 md:py-24">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-10 md:gap-16 items-center">
        <div className="w-full max-h-[50vh] rounded-xl overflow-hidden">
          <img className="w-full h-full object-cover block" src={site.gravatar} alt={site.name} />
        </div>
        <div>
          <div className="uppercase tracking-[0.15em] text-[0.8rem] text-accent mb-3 font-semibold">{about.sectionLabel}</div>
          <h2 className="text-4xl font-bold tracking-tight mb-5 leading-[1.15]">{about.heading}</h2>
          {about.paragraphs.map((p, i) => (
            <p key={i} className="text-muted mb-4">{p}</p>
          ))}
        </div>
      </div>
    </section>
  );
}

function LessonsSection() {
  return (
    <section id="lessons" className="mx-auto max-w-[1100px] px-5 py-16 md:px-8 md:py-24">
      <div className="mb-3 text-[0.8rem] font-semibold uppercase tracking-[0.15em] text-accent">{lessons.sectionLabel}</div>
      <h2 className="mb-5 text-4xl font-bold leading-[1.15] tracking-tight">{lessons.heading}</h2>
      <div className="mt-10 grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-6">
        {lessons.items.map((lesson) => (
          <div key={lesson.title} className="rounded-xl border border-white/[0.06] bg-card p-8 transition-all duration-200 hover:-translate-y-0.5 hover:border-accent/30">
            <div className="mb-4 text-[2rem]">{lesson.icon}</div>
            <h3 className="mb-2 text-xl font-semibold">{lesson.title}</h3>
            <p className="text-[0.95rem] text-muted">{lesson.description}</p>
            <div className="mt-4 flex gap-2">
              {lesson.formats.map((f) => (
                <span key={f} className="rounded-full bg-accent/[0.12] px-3 py-1 text-xs font-semibold text-accent">{f}</span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Testimonials() {
  return (
    <section id="testimonials" className="mx-auto max-w-[1100px] px-5 py-16 md:px-8 md:py-24">
      <div className="mb-3 text-[0.8rem] font-semibold uppercase tracking-[0.15em] text-accent">{testimonials.sectionLabel}</div>
      <h2 className="mb-5 text-4xl font-bold leading-[1.15] tracking-tight">{testimonials.heading}</h2>
      <div className="mt-10 grid grid-cols-1 md:grid-cols-3 gap-6">
        {testimonials.items.map((t) => (
          <div key={t.name} className="rounded-xl border border-white/[0.06] bg-card p-8">
            <p className="text-muted mb-6 italic">&ldquo;{t.quote}&rdquo;</p>
            <div>
              <div className="font-semibold">{t.name}</div>
              <div className="text-sm text-muted">{t.role}</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Contact() {
  return (
    <section id="contact" className="mx-auto max-w-[1100px] px-5 py-16 md:px-8 md:py-24">
      <div className="mx-auto max-w-2xl text-center">
        <div className="mb-3 text-[0.8rem] font-semibold uppercase tracking-[0.15em] text-accent">{contact.sectionLabel}</div>
        <h2 className="mb-5 text-4xl font-bold leading-[1.15] tracking-tight">{contact.heading}</h2>
        <p className="mb-10 text-muted">{contact.description}</p>

        <div className="mb-10 flex flex-col justify-center gap-4 sm:flex-row">
          <a
            href={site.calendar}
            className="inline-flex items-center justify-center gap-3 rounded-xl bg-accent px-9 py-4 text-base font-semibold text-white no-underline transition-all hover:-translate-y-px hover:bg-accent-hover"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            Book Online
          </a>
          <a
            href={`tel:${site.phone}`}
            className="inline-flex items-center justify-center gap-3 rounded-xl border border-white/20 bg-transparent px-9 py-4 text-base font-semibold text-primary no-underline transition-all hover:-translate-y-px hover:border-accent hover:text-accent"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
            </svg>
            Call Me
          </a>
          <a
            href={`mailto:${site.email}`}
            className="inline-flex items-center justify-center gap-3 rounded-xl border border-white/20 bg-transparent px-9 py-4 text-base font-semibold text-primary no-underline transition-all hover:-translate-y-px hover:border-accent hover:text-accent"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            Email Me
          </a>
        </div>

        <div className="flex flex-wrap justify-center gap-x-8 gap-y-3 text-sm text-muted">
          <span><strong className="text-primary">Location:</strong> {site.city}, {site.state}</span>
          <span><strong className="text-primary">Hours:</strong> {site.hours}</span>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="text-center px-8 py-12 text-muted text-[0.85rem] border-t border-white/5">
      <p>&copy; {site.year} {site.business}. All rights reserved.</p>
    </footer>
  );
}
