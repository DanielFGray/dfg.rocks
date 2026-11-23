import * as HttpApi from "effect/http-api/HttpApi";
import { healthGroup } from "./api/health.js";
import { publicGroup } from "./api/public.js";
import { authGroup } from "./api/auth.js";
import { realtimeGroup } from "./api/realtime.js";
import { coursesGroup, coursesAdminGroup } from "./api/courses.js";
import { materialsGroup, materialsAdminGroup } from "./api/materials.js";
import { practiceGroup, practiceAdminGroup } from "./api/practice.js";
import { messagesGroup } from "./api/messages.js";
import { lessonsGroup, lessonsAdminGroup } from "./api/lessons.js";
import { accountsGroup } from "./api/accounts.js";
import { testimonialsGroup, testimonialsAdminGroup } from "./api/testimonials.js";
import { familiesGroup, familiesAdminGroup } from "./api/families.js";
import { calendarConnectAdminGroup, calendarAdminGroup } from "./api/calendar.js";
import { studentsAdminGroup } from "./api/students.js";
import { peopleStaffGroup, peopleAdminGroup } from "./api/people.js";
import { invitationsStaffGroup, invitationsPublicGroup } from "./api/invitations.js";
import { monthlyBillingAdminGroup } from "./api/monthlyBilling.js";
import { payersAdminGroup } from "./api/payers.js";
import { billsAdminGroup } from "./api/bills.js";
import { paymentsAdminGroup } from "./api/payments.js";
import { creditsAdminGroup } from "./api/credits.js";
import { billingRatesAdminGroup } from "./api/billingRates.js";
import { familyBillingGroup } from "./api/familyBilling.js";
import { subscriptionsGroup } from "./api/subscriptions.js";

/** Every endpoint the server serves, except the testing routes. The browser client uses it too. */
export const Contract = HttpApi.make("dfg")
  .add(healthGroup)
  .add(publicGroup)
  .add(authGroup)
  .add(realtimeGroup)
  .add(coursesGroup)
  .add(materialsGroup)
  .add(practiceGroup)
  .add(messagesGroup)
  .add(lessonsGroup)
  .add(accountsGroup)
  .add(testimonialsGroup)
  .add(familiesGroup)
  .add(calendarConnectAdminGroup)
  .add(calendarAdminGroup)
  .add(practiceAdminGroup)
  .add(peopleStaffGroup)
  .add(peopleAdminGroup)
  .add(invitationsStaffGroup)
  .add(invitationsPublicGroup)
  .add(studentsAdminGroup)
  .add(coursesAdminGroup)
  .add(materialsAdminGroup)
  .add(familiesAdminGroup)
  .add(monthlyBillingAdminGroup)
  .add(lessonsAdminGroup)
  .add(testimonialsAdminGroup)
  .add(payersAdminGroup)
  .add(billsAdminGroup)
  .add(paymentsAdminGroup)
  .add(creditsAdminGroup)
  .add(billingRatesAdminGroup)
  .add(familyBillingGroup)
  .add(subscriptionsGroup);
