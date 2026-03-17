import { lessons } from "../config.js";

export const Lessons = () => (
  <section id="lessons" class="mx-auto max-w-[1100px] px-5 py-16 md:px-8 md:py-24">
    <div class="mb-3 text-[0.8rem] font-semibold uppercase tracking-[0.15em] text-accent">
      {lessons.sectionLabel}
    </div>
    <h2 class="mb-5 text-4xl font-bold leading-[1.15] tracking-tight">{lessons.heading}</h2>
    <div class="mt-10 grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-6">
      {lessons.items.map((lesson) => (
        <div class="rounded-xl border border-white/[0.06] bg-card p-8 transition-all duration-200 hover:-translate-y-0.5 hover:border-accent/30">
          <div class="mb-4 text-[2rem]">{lesson.icon}</div>
          <h3 class="mb-2 text-xl font-semibold">{lesson.title}</h3>
          <p class="text-[0.95rem] text-muted">{lesson.description}</p>
          <div class="mt-4 flex gap-2">
            {lesson.formats.map((f) => (
              <span class="rounded-full bg-accent/[0.12] px-3 py-1 text-xs font-semibold text-accent">
                {f}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  </section>
);
