/// <reference types="vite/client" />

import { useEffect, type ReactNode } from "react";
import { Outlet, createRootRouteWithContext, HeadContent, Scripts } from "@tanstack/react-router";
import { QueryClientProvider } from "@tanstack/react-query";

import type { RouterContext } from "../router.js";

import "../styles.css";

export const Route = createRootRouteWithContext<RouterContext>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
    ],
    links: [
      { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      {
        rel: "preconnect",
        href: "https://fonts.gstatic.com",
        crossOrigin: "anonymous",
      },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,600;0,9..40,700;1,9..40,400&display=swap",
      },
    ],
  }),
  component: RootComponent,
  notFoundComponent: () => <div>Not Found</div>,
});

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  return (
    <QueryClientProvider client={queryClient}>
      <RootDocument>
        <Outlet />
      </RootDocument>
    </QueryClientProvider>
  );
}

function RootDocument({ children }: { children: ReactNode }) {
  useEffect(() => {
    const root = document.documentElement;
    const updateViewportWidth = () => {
      root.style.setProperty(
        "--viewport-client-width",
        `${document.documentElement.clientWidth}px`,
      );
    };

    updateViewportWidth();

    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            updateViewportWidth();
          });

    resizeObserver?.observe(root);
    window.addEventListener("resize", updateViewportWidth);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", updateViewportWidth);
    };
  }, []);

  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body className="bg-surface font-sans text-lg leading-relaxed text-primary">
        <div id="root">{children}</div>
        <Scripts />
      </body>
    </html>
  );
}
