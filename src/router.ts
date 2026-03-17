import * as Schema from "effect/Schema";
import { Route, Router } from "fibrae/router";

const idParam = Route.param("id", Schema.String);

export const pages = Router.group("pages")
  .add(Route.get("home", "/"))
  .add(Route.get("login", "/login"))
  .add(Route.get("magicLogin", "/magic-login"))
  .add(Route.get("setPassword", "/set-password"))
  .add(Route.get("forgotPassword", "/forgot-password"))
  .add(Route.get("resetPassword", "/reset-password"))
  .add(Route.get("dashboard", "/dashboard"))
  .add(Route.get("courseDetail")`/courses/${idParam}`)
  .add(Route.get("library", "/library"))
  .add(Route.get("assignments", "/assignments"))
  .add(Route.get("students", "/students"))
  .add(Route.get("studentDetail")`/students/${idParam}`)
  .add(Route.get("submissions", "/submissions"))
  .add(Route.get("messages", "/messages"));

export const router = Router.make("dfg").add(pages);
