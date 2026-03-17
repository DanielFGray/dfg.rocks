import { site, nav } from "../config.js";

const [logoBefore, logoAfter] = site.logo.split(site.logoDot);

export const SiteNav = () => (
  <nav class="fixed top-0 w-full px-8 py-4 flex justify-between items-center bg-surface/90 backdrop-blur-md z-[100] border-b border-white/5">
    <div class="font-bold text-xl tracking-tight">
      {logoBefore}<span class="text-accent">{site.logoDot}</span>{logoAfter}
    </div>
    <ul class="hidden md:flex list-none gap-8 items-center">
      {nav.links.map((link) => (
        <li>
          <a class="text-muted no-underline text-[0.95rem] transition-colors hover:text-primary" href={link.href}>
            {link.label}
          </a>
        </li>
      ))}
      <li>
        <a
          href="/login"
          class="rounded-lg bg-white/5 border border-white/10 px-4 py-1.5 text-sm font-medium text-muted no-underline transition-all hover:border-accent/40 hover:text-accent"
        >
          Student Portal
        </a>
      </li>
    </ul>
  </nav>
);
