import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../lib/hooks/useAuth.js";
import { api } from "../lib/api.js";
import { Button } from "./ui/Button.js";
import { Sidebar } from "./ui/Sidebar.js";

const navLinkClass =
  "text-muted no-underline text-sm transition-colors hover:text-primary";
const mobileLinkClass =
  "text-muted no-underline text-base transition-colors hover:text-primary";

const navItems: Array<{
  to: string;
  id: string;
  label: string;
  mobileLabel?: string;
  adminOnly?: boolean;
  nonAdminOnly?: boolean;
}> = [
    {
      to: "/dashboard",
      id: "nav-courses",
      label: "Dashboard",
      mobileLabel: "Courses",
    },
    { to: "/library", id: "nav-library", label: "Library" },
    { to: "/assignments", id: "nav-assignments", label: "Assignments" },
    { to: "/messages", id: "nav-messages", label: "Messages" },
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
    { to: "/settings", id: "nav-settings", label: "Settings" },
    { to: "/students", id: "nav-students", label: "Students", adminOnly: true },
    {
      to: "/submissions",
      id: "nav-submissions",
      label: "Submissions",
      adminOnly: true,
    },
    { to: "/lessons", id: "nav-lessons", label: "Lessons", adminOnly: true },
  ];

// --- PortalNav ---

export function PortalNav() {
  const [menuOpen, setMenuOpen] = useState(false);
  const { isAdmin } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const toggle = () => setMenuOpen((prev) => !prev);
  const close = () => setMenuOpen(false);

  const onLogout = async () => {
    const { error } = await api.logout.post();
    if (error) throw error;
    queryClient.clear();
    navigate({ to: "/login" });
  };

  const visibleItems = navItems.filter(
    (it) =>
      (it.adminOnly ? isAdmin : true) && (it.nonAdminOnly ? !isAdmin : true),
  );

  return (
    <>
      <nav
        data-pwid="portal-nav"
        className="fixed top-0 z-[100] flex w-full items-center justify-between border-b border-white/5 bg-surface/90 px-6 py-3 backdrop-blur-md md:px-8"
      >
        <div className="text-lg font-bold tracking-tight">
          dfg<span className="text-accent">.</span>rocks
          <span className="ml-2 text-sm font-normal text-muted">portal</span>
        </div>

        {/* Desktop nav */}
        <div className="hidden items-center gap-6 lg:flex">
          {visibleItems.map((it) => (
            <Link
              key={it.id}
              to={it.to}
              className={navLinkClass}
              data-pwid={it.id}
            >
              {it.label}
            </Link>
          ))}
          <Button variant="ghost" onClick={onLogout} data-pwid="logout">
            Log Out
          </Button>
        </div>

        {/* Mobile hamburger */}
        <button
          type="button"
          onClick={toggle}
          className="cursor-pointer p-2 text-muted transition-colors hover:text-primary lg:hidden"
          data-pwid="nav-menu-toggle"
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
              data-pwid="logout"
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
              data-pwid={it.id}
            >
              <div className="border-b border-white/5 py-3">
                {it.mobileLabel ?? it.label}
              </div>
            </Link>
          ))}
        </div>
      </Sidebar>
    </>
  );
}
