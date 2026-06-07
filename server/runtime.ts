import { Layer, ManagedRuntime } from "effect";
import { PgAuthDB, PgRootDB } from "./db.js";
import { GoogleCalendarService } from "./services/googleCalendarService.js";
import { SessionService } from "./services/sessionService.js";

const infrastructureLayer = Layer.mergeAll(PgRootDB.Live, PgAuthDB.Live);

const servicesLayer = Layer.mergeAll(
  GoogleCalendarService.Default,
  SessionService.Default,
).pipe(Layer.provideMerge(infrastructureLayer));

export const serverRuntimeLayer = Layer.mergeAll(infrastructureLayer, servicesLayer);

export const serverRuntime = ManagedRuntime.make(serverRuntimeLayer);

export const disposeServerRuntime = () => serverRuntime.dispose();
