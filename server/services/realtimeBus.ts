import { EventEmitter } from "node:events";

export type RealtimeMessage = {
  userId: string;
  event: string;
  subject: string;
  queryKeys: readonly (readonly string[])[];
};

class RealtimeBus extends EventEmitter {
  publish(msg: RealtimeMessage): void {
    this.emit("message", msg);
  }
}

export const realtimeBus = new RealtimeBus();
