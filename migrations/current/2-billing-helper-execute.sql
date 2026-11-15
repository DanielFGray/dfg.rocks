/*
 * Internal billing helpers are not callable by the visitor. They are SECURITY DEFINER, so a
 * visitor who calls one reads billing data past RLS: a payer's discount and tax rate, which
 * students bill this month, any student's payer. Only other SECURITY DEFINER functions call them.
 *
 * Default privileges grant EXECUTE on every new app_public function to the visitor, so a drop and
 * create in a later migration grants it again. 000001 revoked four of these; 000004 re-created
 * them, and created payer_id_for_student with the default grant. accessPolicy.test.ts lists the
 * definer functions the visitor may execute and fails on any other.
 */
revoke execute on function app_public.create_monthly_bill_line_items(uuid, uuid, date, date)
  from public, :DATABASE_VISITOR;
revoke execute on function app_public.get_effective_discount(uuid, date)
  from public, :DATABASE_VISITOR;
revoke execute on function app_public.get_effective_tax_rate(uuid, date)
  from public, :DATABASE_VISITOR;
revoke execute on function app_public.monthly_billing_eligible(date)
  from public, :DATABASE_VISITOR;
revoke execute on function app_public.payer_id_for_student(uuid)
  from public, :DATABASE_VISITOR;
