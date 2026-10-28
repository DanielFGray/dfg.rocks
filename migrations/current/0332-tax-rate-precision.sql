-- Tax rate precision: support two decimal places, range 0.00-30.00
alter table app_public.tax_rates
  alter column rate_percent type numeric(5,2),
  drop constraint if exists tax_rates_rate_percent_check,
  add constraint tax_rates_rate_percent_check
    check (rate_percent >= 0.00 and rate_percent <= 30.00);

comment on column app_public.tax_rates.rate_percent is 'Tax rate as a percentage with two decimal precision (e.g., 8.25 = 8.25%). Range 0.00-30.00.';
