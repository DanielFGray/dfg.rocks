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
 * The gallery shows no text: no heading, no caption, no alt text. The photos are listed with
 * their width and height so the browser can reserve the right space before the file arrives,
 * which keeps the page from jumping as the photos load.
 *
 * The first photo leads: on a wide screen it spans the full width, with the rest in a grid
 * below it. On a narrow screen every photo stacks.
 */
export const gallery = {
  photos: [
    { src: "/gallery/teaching-at-board.webp", width: 1600, height: 1200 },
    { src: "/gallery/ensemble.webp", width: 1205, height: 1600 },
    { src: "/gallery/teaching-guitar.webp", width: 1200, height: 1600 },
  ],
} as const;

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
