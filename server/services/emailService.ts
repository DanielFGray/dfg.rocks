import { Resend } from "resend";
import { env } from "../assertEnv.js";

const resend = env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null;

export async function sendEmail(opts: { to: string; subject: string; html: string }) {
  if (!resend) {
    console.log(`[email-stub] To: ${opts.to}, Subject: ${opts.subject}`);
    return;
  }
  await resend.emails.send({ from: "DFG Portal <noreply@dfg.rocks>", ...opts });
}
