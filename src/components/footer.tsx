import { site } from "../config.js";

export const Footer = () => (
  <footer class="text-center px-8 py-12 text-muted text-[0.85rem] border-t border-white/5">
    <p>&copy; {site.year} {site.business}. All rights reserved.</p>
  </footer>
);
