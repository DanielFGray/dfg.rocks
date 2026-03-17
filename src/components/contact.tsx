import { site, contact } from "../config.js";

const CalendarIcon = () => (
  <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
    <path stroke-linecap="round" stroke-linejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
  </svg>
);

const PhoneIcon = () => (
  <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
    <path stroke-linecap="round" stroke-linejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
  </svg>
);

const EmailIcon = () => (
  <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
    <path stroke-linecap="round" stroke-linejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
  </svg>
);

export const Contact = () => (
  <section id="contact" class="mx-auto max-w-[1100px] px-5 py-16 md:px-8 md:py-24">
    <div class="mx-auto max-w-2xl text-center">
      <div class="mb-3 text-[0.8rem] font-semibold uppercase tracking-[0.15em] text-accent">
        {contact.sectionLabel}
      </div>
      <h2 class="mb-5 text-4xl font-bold leading-[1.15] tracking-tight">{contact.heading}</h2>
      <p class="mb-10 text-muted">{contact.description}</p>

      <div class="mb-10 flex flex-col justify-center gap-4 sm:flex-row">
        <a
          href={site.calendar}
          class="inline-flex items-center justify-center gap-3 rounded-xl bg-accent px-9 py-4 text-base font-semibold text-white no-underline transition-all hover:-translate-y-px hover:bg-accent-hover"
        >
          <CalendarIcon />
          Book Online
        </a>
        <a
          href={`tel:${site.phone}`}
          class="inline-flex items-center justify-center gap-3 rounded-xl border border-white/20 bg-transparent px-9 py-4 text-base font-semibold text-primary no-underline transition-all hover:-translate-y-px hover:border-accent hover:text-accent"
        >
          <PhoneIcon />
          Call Me
        </a>
        <a
          href={`mailto:${site.email}`}
          class="inline-flex items-center justify-center gap-3 rounded-xl border border-white/20 bg-transparent px-9 py-4 text-base font-semibold text-primary no-underline transition-all hover:-translate-y-px hover:border-accent hover:text-accent"
        >
          <EmailIcon />
          Email Me
        </a>
      </div>

      <div class="flex flex-wrap justify-center gap-x-8 gap-y-3 text-sm text-muted">
        <span>
          <strong class="text-primary">Location:</strong> {site.city}, {site.state}
        </span>
        <span>
          <strong class="text-primary">Hours:</strong> {site.hours}
        </span>
      </div>
    </div>
  </section>
);
