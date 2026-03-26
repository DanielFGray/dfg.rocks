import {
  createStartHandler,
  defaultStreamHandler,
  type RequestOptions,
} from "@tanstack/react-start/server";

const startHandler = createStartHandler(defaultStreamHandler);

export default {
  async fetch(request: Request, opts?: RequestOptions<unknown>) {
    return startHandler(request, opts);
  },
};
