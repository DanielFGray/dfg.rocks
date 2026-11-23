import { Effect } from "effect";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useRouter } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../lib/hooks/useAuth.js";
import { useSwitchActiveStudent } from "../lib/queries.js";
import { api } from "../lib/api.js";
import { resetAuthClientState } from "../lib/authClientState.js";
import { Button } from "./ui/Button.js";
import { Select } from "./ui/Select.js";
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
  staffOnly?: boolean;
  nonAdminOnly?: boolean;
  parentOnly?: boolean;
}> = [
  { to: "/dashboard", id: "nav-dashboard", label: "Dashboard" },
  { to: "/lessons", id: "nav-lessons", label: "Lessons", adminOnly: true },
  { to: "/messages", id: "nav-messages", label: "Messages" },
  { to: "/courses", id: "nav-courses", label: "Courses" },
  { to: "/library", id: "nav-library", label: "Library", adminOnly: true },
  { to: "/assignments", id: "nav-assignments", label: "Assignments" },
  {
    to: "/my-lessons",
    id: "nav-my-lessons",
    label: "My Lessons",
    nonAdminOnly: true,
  },
  { to: "/people", id: "nav-people", label: "People", staffOnly: true },
  { to: "/billing/monthly", id: "nav-payments", label: "Payments", adminOnly: true },
  { to: "/billing", id: "nav-billing", label: "Billing", adminOnly: true },
  {
    to: "/submissions",
    id: "nav-submissions",
    label: "Submissions",
    adminOnly: true,
  },
  { to: "/family", id: "nav-family", label: "Family", parentOnly: true },
  { to: "/settings", id: "nav-settings", label: "Settings" },
];

// --- PortalNav ---

export function PortalNav() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [navVisible, setNavVisible] = useState(true);
  const { isAdmin, isStaff, user, isParent, familyStudents, activeStudentId } = useAuth();
  const switchStudent = useSwitchActiveStudent();
  const navigate = useNavigate();
  const router = useRouter();
  const location = useLocation();
  const queryClient = useQueryClient();
  const navRef = useRef<HTMLElement | null>(null);

  const toggle = () => setMenuOpen((prev) => !prev);
  const close = () => setMenuOpen(false);

  const onLogout = async () => {
    await Effect.runPromise(api.auth.logout());
    await resetAuthClientState({ queryClient });
    await navigate({ to: "/login", search: { redirect: undefined } });
  };

  const visibleItems = navItems.filter(
    (it) =>
      (it.adminOnly ? isAdmin : true) &&
      (it.staffOnly ? isStaff : true) &&
      (it.nonAdminOnly ? !isAdmin : true) &&
      (it.parentOnly ? isParent : true),
  );

  const studentOptions = familyStudents.map((s) => ({
    value: s.id,
    label: s.name || s.username,
  }));

  const handleSwitchStudent = (value: string) => {
    switchStudent.mutate(value, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["dashboard"] });
        queryClient.invalidateQueries({ queryKey: ["assignments"] });
        queryClient.invalidateQueries({ queryKey: ["courses"] });
        queryClient.invalidateQueries({ queryKey: ["my-lessons"] });
        queryClient.invalidateQueries({ queryKey: ["messages"] });
        router.invalidate();
      },
    });
  };

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
        className={`fixed top-0 z-100 flex w-full items-center justify-between border-b border-overlay/5 bg-surface/90 px-6 py-3 backdrop-blur-md transition-transform duration-300 will-change-transform md:px-8 dark:border-overlay-dark/5 dark:bg-surface-dark/90 print:hidden ${menuOpen || navVisible ? "translate-y-0" : "-translate-y-full"}`}
      >
        <div className="text-lg font-bold tracking-tight">
          dfg<span className="text-accent">.</span>rocks
          <span className="ml-2 text-sm font-normal text-muted dark:text-muted-dark">portal</span>
        </div>

        {/* Desktop nav */}
        <div className="hidden items-center gap-6 lg:flex">
          {visibleItems.map((it) => (
            <Link key={it.id} to={it.to} className={navLinkClass} data-testid={it.id}>
              {it.label}
            </Link>
          ))}
          {isParent && familyStudents.length > 0 && (
            <Select
              id="student-switcher-desktop"
              name="student-switcher"
              label="Student"
              options={studentOptions}
              value={activeStudentId ?? ""}
              disabled={switchStudent.isPending}
              onChange={handleSwitchStudent}
              data-testid="student-switcher"
            />
          )}
          <Button variant="ghost" onClick={onLogout} data-testid="logout">
            Log Out
          </Button>
        </div>

        {/* Mobile hamburger */}
        <Button
          variant="ghost"
          onClick={toggle}
          className="p-2 lg:hidden"
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
        </Button>
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
        <div className="flex flex-col px-6 py-2">
          {visibleItems.map((it) => (
            <Link
              key={it.id}
              to={it.to}
              onClick={close}
              className={mobileLinkClass}
              data-testid={it.id}
            >
              <div className="border-b border-overlay/5 py-3 dark:border-overlay-dark/5">
                {it.mobileLabel ?? it.label}
              </div>
            </Link>
          ))}
          {isParent && familyStudents.length > 0 && (
            <div className="border-b border-overlay/5 py-3 dark:border-overlay-dark/5">
              <Select
                id="student-switcher-mobile"
                name="student-switcher"
                label="Switch Student"
                options={studentOptions}
                value={activeStudentId ?? ""}
                disabled={switchStudent.isPending}
                onChange={handleSwitchStudent}
                data-testid="student-switcher-mobile"
              />
            </div>
          )}
        </div>
      </Sidebar>
    </>
  );
}
