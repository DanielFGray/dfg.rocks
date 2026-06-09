import { Layer, ManagedRuntime } from "effect";
import { PgAuthDB, PgRootDB } from "./db.js";
import { GoogleCalendarService } from "./services/googleCalendarService.js";
import { RealtimeService } from "./services/realtimeService.js";
import { SessionService } from "./services/sessionService.js";

const infrastructureLayer = Layer.mergeAll(PgRootDB.Live, PgAuthDB.Live);

const servicesLayer = Layer.mergeAll(
  RealtimeService.Default,
  GoogleCalendarService.Default,
  SessionService.Default,
).pipe(
  Layer.provide(PgRootDB.Conn),
  Layer.provideMerge(infrastructureLayer),
);

export const serverRuntime = ManagedRuntime.make(servicesLayer);
