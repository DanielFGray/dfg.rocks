import type { VElement } from "fibrae/shared";
import { RouterBuilder, RouterOutlet } from "fibrae/router";
import { Suspense, ErrorBoundary } from "fibrae";

import { site } from "./config.js";
import { SiteNav } from "./components/site_nav.js";
import { Footer } from "./components/footer.js";
import { Hero } from "./components/hero.js";
import { About } from "./components/about.js";
import { Lessons } from "./components/lessons.js";
import { Contact } from "./components/contact.js";

// Portal components
import { LoginPage } from "./portal/login.js";
import { DashboardPage } from "./portal/dashboard.js";
import { CourseDetailPage } from "./portal/course_detail.js";
import { StudentsPage } from "./portal/students.js";
import { StudentDetailPage } from "./portal/student_detail.js";
import { SubmissionsPage } from "./portal/submissions.js";
import { LibraryPage } from "./portal/library.js";
import { AssignmentsPage } from "./portal/assignments.js";
import { MessagesPage } from "./portal/messages.js";
import { PortalNav } from "./portal/nav.js";
import { AuthGuard } from "./portal/auth_guard.js";
import { SetPasswordPage } from "./portal/set_password.js";
import { ForgotPasswordPage } from "./portal/forgot_password.js";
import { ResetPasswordPage } from "./portal/reset_password.js";
import { MagicLoginPage } from "./portal/magic_login.js";

import { router, pages } from "./router.js";
export { router };

// === Handlers ===

export const handlersLayer = RouterBuilder.group(router, pages, (h) =>
  h
    .handle("home", {
      prerender: true,
      head: () => ({
        title: `${site.business} | Drums, Guitar & More in ${site.city}`,
        meta: [
          { name: "description", content: `Private music lessons with ${site.name}. Drums, guitar, piano and more. In-person and online in ${site.city}.` },
          { property: "og:title", content: `${site.business} | Music Lessons in ${site.city}, ${site.state}` },
          { property: "og:description", content: `Private drum, guitar, piano & bass lessons for all ages. First lesson free.` },
          { property: "og:url", content: "https://dfg.rocks/" },
          { property: "og:type", content: "website" },
          { "script:ld+json": {
            "@context": "https://schema.org",
            "@type": "LocalBusiness",
            name: site.business,
            description: "Private music lessons — drums, guitar, piano and more.",
            url: "https://dfg.rocks",
            telephone: site.phone,
            address: { "@type": "PostalAddress", addressLocality: site.city, addressRegion: site.state },
            priceRange: "$$",
            openingHours: "Mo-Sa 09:00-20:00",
          }},
        ],
        links: [
          { rel: "preconnect", href: "https://fonts.googleapis.com" },
          { rel: "preconnect", href: "https://fonts.gstatic.com", crossorigin: "anonymous" },
          { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,600;0,9..40,700;1,9..40,400&display=swap" },
          { rel: "canonical", href: "https://dfg.rocks/" },
        ] as Record<string, string>[],
      }),
      component: () => (
        <div>
          <SiteNav />
          <Hero />
          <About />
          <Lessons />
          <Contact />
          <Footer />
        </div>
      ),
    })
    .handle("login", {
      head: () => ({ title: "Log In | DFG Portal" }),
      component: () => <LoginPage />,
    })
    .handle("magicLogin", {
      head: () => ({ title: "Magic Link Login | DFG Portal" }),
      component: () => <MagicLoginPage />,
    })
    .handle("setPassword", {
      head: () => ({ title: "Set Password | DFG Portal" }),
      component: () => <SetPasswordPage />,
    })
    .handle("forgotPassword", {
      head: () => ({ title: "Forgot Password | DFG Portal" }),
      component: () => <ForgotPasswordPage />,
    })
    .handle("resetPassword", {
      head: () => ({ title: "Reset Password | DFG Portal" }),
      component: () => <ResetPasswordPage />,
    })
    .handle("dashboard", {
      head: () => ({ title: "My Courses | DFG Portal" }),
      component: () => (
        <AuthGuard>
          <PortalNav />
          <DashboardPage />
        </AuthGuard>
      ),
    })
    .handle("courseDetail", {
      component: (props) => (
        <AuthGuard>
          <PortalNav />
          <CourseDetailPage id={props.path.id as string} />
        </AuthGuard>
      ),
    })
    .handle("library", {
      head: () => ({ title: "Library | DFG Portal" }),
      component: () => (
        <AuthGuard>
          <PortalNav />
          <LibraryPage />
        </AuthGuard>
      ),
    })
    .handle("assignments", {
      head: () => ({ title: "My Assignments | DFG Portal" }),
      component: () => (
        <AuthGuard>
          <PortalNav />
          <AssignmentsPage />
        </AuthGuard>
      ),
    })
    .handle("students", {
      head: () => ({ title: "Students | DFG Portal" }),
      component: () => (
        <AuthGuard>
          <PortalNav />
          <StudentsPage />
        </AuthGuard>
      ),
    })
    .handle("studentDetail", {
      component: (props) => (
        <AuthGuard>
          <PortalNav />
          <StudentDetailPage id={props.path.id as string} />
        </AuthGuard>
      ),
    })
    .handle("submissions", {
      head: () => ({ title: "Submissions | DFG Portal" }),
      component: () => (
        <AuthGuard>
          <PortalNav />
          <SubmissionsPage />
        </AuthGuard>
      ),
    })
    .handle("messages", {
      head: () => ({ title: "Messages | DFG Portal" }),
      component: () => (
        <AuthGuard>
          <PortalNav />
          <MessagesPage />
        </AuthGuard>
      ),
    }),
);

// === App Component (shared between SSR and client) ===

const RouteContent = () => (
  <ErrorBoundary fallback={(error) => {
    console.error("Route error:", error);
    const message = error instanceof Error ? error.message : String(error);
    return <div>Error: {message}</div>;
  }}>
    <Suspense fallback={<div>Loading...</div>} threshold={50}>
      <RouterOutlet />
    </Suspense>
  </ErrorBoundary>
);

export const App = () => (
  <div id="app">
    <RouteContent />
  </div>
);

// appShell wraps the route element for SSG pre-rendering
export const appShell = (element: VElement) => element;
