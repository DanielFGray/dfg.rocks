export const site = {
  name: "Daniel",
  business: "DanielFGray",
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
    { label: "Reviews", href: "#testimonials" },
    { label: "Contact", href: "#contact" },
  ],
};

export const hero = {
  eyebrow: "Drums \u00B7 Guitar \u00B7 Piano \u00B7 More",
  headline: "Music lessons that rock.",
  subtitle: `Private lessons for all ages and levels. In-person in ${site.city} or online from anywhere. First lesson is on me.`,
  cta: [
    { label: "Book a Free Trial", href: "#contact" },
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
        "Kit, snare, hand drums, rudiments, grooves, reading, and playing in a band context. All styles.",
      formats: ["In-Person", "Online"],
    },
    {
      icon: "🎸",
      title: "Guitar",
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
  ],
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
  heading: "Book your free trial lesson",
  description:
    "Send me a message and I'll get back to you within 24 hours. No commitment, no pressure — just come play.",
  instruments: [
    { value: "drums", label: "Drums / Percussion" },
    { value: "guitar", label: "Guitar" },
    { value: "piano", label: "Piano / Keys" },
    { value: "other", label: "Something else" },
  ],
  formats: [
    { value: "in-person", label: "In-Person" },
    { value: "online", label: "Online" },
    { value: "not-sure", label: "Not sure yet" },
  ],
};
