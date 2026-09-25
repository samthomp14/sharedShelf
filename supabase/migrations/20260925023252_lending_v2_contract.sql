-- ============================================================
-- Lending v2 — CONTRACT step
-- ============================================================
-- Production switched to the v2 lending model on 2026-09-24 (see
-- *_lending_v2_expand.sql). Every old request and loan was copied into
-- loan_requests_v2 / loans_v2 by backfill_lending_v2(), checked with nothing
-- missing, and no client reads or writes the old model any more. This drops it.
--
-- The _v2 table names stay: lib/loans.ts and the step functions use them, and
-- renaming buys nothing. loan_request_status is kept (loan_requests_v2 uses it).
-- ============================================================

drop trigger if exists on_loan_request_change on public.loan_requests;
drop trigger if exists on_loan_returned on public.loans;
drop function if exists public.handle_loan_request_change();
drop function if exists public.handle_loan_returned();

-- loans references loan_requests, so it goes first.
drop table public.loans;
drop table public.loan_requests;

alter table public.shelf_items drop column status;
drop type public.shelf_item_status;

-- Only needed to copy the old tables across.
drop function public.backfill_lending_v2();
alter table public.loan_requests_v2 drop column legacy_request_id;
alter table public.loans_v2 drop column legacy_loan_id;
