/** The values the contact form's selects offer. The server decodes a submission against them. */
import { Schema as S } from "effect";

export const contactInstrumentValues = ["drums", "guitar", "piano", "other"] as const;
export const contactFormatValues = ["in-person", "online", "not-sure"] as const;

export const ContactInstrument = S.Literals(contactInstrumentValues);
export const ContactFormat = S.Literals(contactFormatValues);
