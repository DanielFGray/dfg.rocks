import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useRouter } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../lib/hooks/useAuth.js";
import { api } from "../lib/api.js";
import { resetAuthClientState } from "../lib/authClientState.js";
import { Button } from "./ui/Button.js";
import { Sidebar } from "./ui/Sidebar.js";

const navLinkClass =
  "text-muted dark:text-muted-dark no-underline text-sm transition-colors hover:text-primary dark:hover:text-primary-dark";
const mobileLinkClass =
  "text-muted dark:text-muted-dark no-underline text-base transition-colors hover:text-primary dark:hover:text-primary-dark";

const navItems: Array<{
  to: string;
  id: string;
  label: string;
  mobileLabel?: string;
  adminOnly?: boolean;
  nonAdminOnly?: boolean;
}> = [
  { to: "/dashboard", id: "nav-dashboard", label: "Dashboard" },
  { to: "/lessons", id: "nav-lessons", label: "Lessons", adminOnly: true },
  { to: "/messages", id: "nav-messages", label: "Messages" },
  { to: "/courses", id: "nav-courses", label: "Courses" },
  { to: "/library", id: "nav-library", label: "Library" },
  { to: "/assignments", id: "nav-assignments", label: "Assignments" },
  {
    to: "/book-lesson",
    id: "nav-book-lesson",
    label: "Book Lesson",
    nonAdminOnly: true,
  },
  {
    to: "/my-lessons",
    id: "nav-my-lessons",
    label: "My Lessons",
    nonAdminOnly: true,
  },
  { to: "/students", id: "nav-students", label: "Students", adminOnly: true },
  {
    to: "/submissions",
    id: "nav-submissions",
    label: "Submissions",
    adminOnly: true,
  },
  { to: "/settings", id: "nav-settings", label: "Settings" },
];

// --- PortalNav ---

export function PortalNav() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [navVisible, setNavVisible] = useState(true);
  const { isAdmin, user } = useAuth();
  const navigate = useNavigate();
  const router = useRouter();
  const location = useLocation();
  const queryClient = useQueryClient();
  const navRef = useRef<HTMLElement | null>(null);

  const toggle = () => setMenuOpen((prev) => !prev);
  const close = () => setMenuOpen(false);

  const onLogout = async () => {
    const { error } = await api.logout.post();
    if (error) throw error;
    await resetAuthClientState({ queryClient, router });
    router.invalidate();
    navigate({ to: "/login", search: { redirect: undefined } });
  };

  const visibleItems = navItems.filter(
    (it) => (it.adminOnly ? isAdmin : true) && (it.nonAdminOnly ? !isAdmin : true),
  );

  useEffect(() => {
    setNavVisible(true);
  }, [location.pathname]);

  useEffect(() => {
    if (menuOpen) {
      setNavVisible(true);
    }
  }, [menuOpen]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    let lastY = window.scrollY;
    let frameId: number | null = null;

    const updateVisibility = () => {
      frameId = null;

      if (menuOpen) {
        lastY = window.scrollY;
        setNavVisible(true);
        return;
      }

      const currentY = window.scrollY;
      const delta = currentY - lastY;

      if (currentY <= 24 || delta < -6) {
        setNavVisible(true);
      } else if (delta > 6) {
        setNavVisible(false);
      }

      lastY = currentY;
    };

    const onScroll = () => {
      if (frameId !== null) {
        return;
      }

      frameId = window.requestAnimationFrame(updateVisibility);
    };

    window.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, [menuOpen]);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    const root = document.documentElement;
    const nav = navRef.current;
    if (!nav) {
      return;
    }

    const updateNavHeight = () => {
      const height = nav.offsetHeight;
      root.style.setProperty("--portal-nav-height", `${height}px`);
      root.style.setProperty(
        "--portal-nav-visible-height",
        menuOpen || navVisible ? `${height}px` : "0px",
      );
    };

    updateNavHeight();

    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            updateNavHeight();
          });

    resizeObserver?.observe(nav);
    window.addEventListener("resize", updateNavHeight);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", updateNavHeight);
    };
  }, [menuOpen, navVisible]);

  if (!user) {
    return null;
  }

  return (
    <>
      <nav
        ref={navRef}
        data-testid="portal-nav"
        className={`top-0 border-overlay/5 bg-surface/90 px-6 py-3 backdrop-blur-md md:px-8 dark:border-overlay-dark/5 dark:bg-surface-dark/90 fixed z-100 flex w-full items-center justify-between border-b transition-transform duration-300 will-change-transform ${menuOpen || navVisible ? "translate-y-0" : "-translate-y-full"}`}
      >
        <div className="text-lg font-bold tracking-tight">
          dfg<span className="text-accent">.</span>rocks
          <span className="ml-2 text-sm font-normal text-muted dark:text-muted-dark">portal</span>
        </div>

        {/* Desktop nav */}
        <div className="gap-6 lg:flex hidden items-center">
          {visibleItems.map((it) => (
            <Link key={it.id} to={it.to} className={navLinkClass} data-testid={it.id}>
              {it.label}
            </Link>
          ))}
          <Button variant="ghost" onClick={onLogout} data-testid="logout">
            Log Out
          </Button>
        </div>

        {/* Mobile hamburger */}
        <button
          type="button"
          onClick={toggle}
          className="p-2 text-muted dark:text-muted-dark hover:text-primary dark:hover:text-primary-dark lg:hidden cursor-pointer transition-colors"
          data-testid="nav-menu-toggle"
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

      {/* Mobile slideout */}
      <Sidebar
        open={menuOpen}
        onClose={close}
        title="Menu"
        footer={
          <div className="px-6 py-4">
            <Button
              variant="ghost"
              onClick={onLogout}
              className="w-full justify-start"
              data-testid="logout"
            >
              Log Out
            </Button>
          </div>
        }
      >
        <div className="px-6 py-2 flex flex-col">
          {visibleItems.map((it) => (
            <Link
              key={it.id}
              to={it.to}
              onClick={close}
              className={mobileLinkClass}
              data-testid={it.id}
            >
              <div className="border-overlay/5 dark:border-overlay-dark/5 py-3 border-b">
                {it.mobileLabel ?? it.label}
              </div>
            </Link>
          ))}
        </div>
      </Sidebar>
    </>
  );
}
