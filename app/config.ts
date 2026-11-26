import type { ContactFormat, ContactInstrument } from "../shared/contactOptions.js";

export const site = {
  name: "Daniel",
  business: "Daniel Gray",
  logo: "dfg.rocks",
  logoDot: ".",
  city: "Galveston",
  state: "Texas",
  email: "danielfgray@gmail.com",
  phone: "409-233-3260",
  calendar: "https://calendar.app.google/H23aNfyKcHuu6TkAA",
  hours: "Mon–Sat, 9am–8pm",
  gravatar: "https://www.gravatar.com/avatar/be9906326e4b79af7ab66a157acced4c?s=800",
  year: new Date().getFullYear().toString(),
};

export const nav = {
  links: [
    { label: "About", href: "#about" },
    { label: "Lessons", href: "#lessons" },
    { label: "Gallery", href: "#gallery" },
    { label: "Reviews", href: "#testimonials" },
    { label: "Contact", href: "#contact" },
  ],
};

export const hero = {
  eyebrow: "Drums \u00B7 Guitar \u00B7 Piano \u00B7 More",
  headline: "Music lessons that rock.",
  subtitle: `Private lessons for all ages and levels. In-person in ${site.city} or online from anywhere. First lesson is on me.`,
  cta: [
    { label: "Book a Free Lesson", href: "#contact" },
    { label: "See What I Teach", href: "#lessons", outline: true },
  ],
};

export const about = {
  sectionLabel: "About",
  heading: `Hey, I'm ${site.name}.`,
  paragraphs: [
    "I've been playing drums for over 25 years and teaching for over 15. Music changed my life, and I want to help it change yours - or your kid's.",
    "I keep lessons fun, practical, and tailored to what you actually want to play.",
    "Whether you're picking up sticks for the first time or you've been playing for years and want to level up, I'll meet you where you are.",
  ],
};

export const lessons = {
  sectionLabel: "Lessons",
  heading: "What I teach",
  items: [
    {
      icon: "🥁",
      title: "Drums & Percussion",
      description:
        "Drum kit, snare, rudiments, polyrhythms, playing in a band context. All styles.",
      formats: ["In-Person"],
    },
    {
      icon: "🎸",
      title: "Guitar and Bass",
      description:
        "Acoustic and electric. Chords, strumming, fingerpicking, lead playing, and songs you actually want to learn.",
      formats: ["In-Person", "Online"],
    },
    {
      icon: "🎹",
      title: "Piano / Keys",
      description:
        "Beginner to intermediate. Reading, chords, improvisation, and classical or contemporary — your call.",
      formats: ["In-Person", "Online"],
    },
    {
      icon: "🎼🎵🎶",
      title: "Music Theory",
      description:
        "Learn the theory behind the music you play so you can understand, create, and improvise with confidence.",
      formats: ["In-Person", "Online"],
    },
  ],
};

/**
 * Photos of students playing. Each entry names a file in `public/gallery/`.
 *
 * The `consent` field records who agreed to the photo being public. A photo with no consent
 * is not published, so keep the field honest rather than optimistic.
 */
export const gallery = {
  sectionLabel: "In the Room",
  heading: "Lessons in action",
  photos: [
    {
      src: "/gallery/lesson-drums.jpg",
      alt: "A student playing a drum kit during a lesson",
      caption: "Working through rudiments, one bar at a time.",
      consent: "parent" as const,
    },
    {
      src: "/gallery/lesson-guitar.jpg",
      alt: "A student playing acoustic guitar during a lesson",
      caption: "First chords, first song.",
      consent: "parent" as const,
    },
    {
      src: "/gallery/ensemble.jpg",
      alt: "An ensemble performing together",
      caption: "The ensemble, rehearsing.",
      consent: "teacher" as const,
    },
  ] satisfies ReadonlyArray<{
    src: string;
    alt: string;
    caption: string;
    consent: "parent" | "teacher";
  }>,
};

export const testimonials = {
  sectionLabel: "What People Say",
  heading: "Don't take my word for it",
  items: [
    {
      quote: `My son has been taking drum lessons with ${site.name} for six months and his confidence has skyrocketed. He actually practices without being asked.`,
      name: "Sarah M.",
      role: "Parent",
    },
    {
      quote: `I picked up guitar at 40 thinking it was too late. ${site.name} made it feel totally doable. I'm playing songs I love after just a few months.`,
      name: "Chris R.",
      role: "Adult Student",
    },
    {
      quote: `Best music teacher in ${site.city}. Patient, fun, and actually listens to what you want to learn. Can't recommend enough.`,
      name: "Jamie L.",
      role: "Google Review",
    },
  ],
};

export const contact = {
  sectionLabel: "Get Started",
  heading: "Let's make some music together!",
  description:
    "Send me a message and I'll get back to you within 24 hours. No commitment, no pressure.",
  // Each list is checked against shared/contactOptions.ts: the server accepts only these values.
  instruments: [
    { value: "drums", label: "Drums / Percussion" },
    { value: "guitar", label: "Guitar" },
    { value: "piano", label: "Piano / Keys" },
    { value: "other", label: "Something else" },
  ] satisfies ReadonlyArray<{ value: typeof ContactInstrument.Type; label: string }>,
  formats: [
    { value: "in-person", label: "In-Person" },
    { value: "online", label: "Online" },
    { value: "not-sure", label: "Not sure yet" },
  ] satisfies ReadonlyArray<{ value: typeof ContactFormat.Type; label: string }>,
};
