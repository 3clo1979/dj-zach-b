-- Additive only. Existing customers keep unknown referral/amounts and no invented history.
-- Apply via the approved deployment migration command, never manual production DDL.
ALTER TABLE inquiries ADD referral_source text CONSTRAINT inquiry_referral_source CHECK (referral_source IS NULL OR referral_source IN ('Google','Social media','Friend / family','Venue / vendor','Returning client','Other'));
--> statement-breakpoint
ALTER TABLE inquiries ADD referral_other text CONSTRAINT inquiry_referral_other CHECK (referral_other IS NULL OR (referral_source IS NOT NULL AND referral_source = 'Other' AND length(referral_other) <= 160));
--> statement-breakpoint
ALTER TABLE inquiries ADD quoted_amount_cents integer CONSTRAINT inquiry_quoted_amount CHECK (quoted_amount_cents IS NULL OR (typeof(quoted_amount_cents) = 'integer' AND quoted_amount_cents BETWEEN 0 AND 99999999));
--> statement-breakpoint
ALTER TABLE inquiries ADD booked_amount_cents integer CONSTRAINT inquiry_booked_amount CHECK (booked_amount_cents IS NULL OR (typeof(booked_amount_cents) = 'integer' AND booked_amount_cents BETWEEN 0 AND 99999999));
--> statement-breakpoint
ALTER TABLE inquiries ADD revision text NOT NULL DEFAULT 'legacy';
--> statement-breakpoint
ALTER TABLE inquiries ADD changed_at text;
--> statement-breakpoint
ALTER TABLE inquiries ADD changed_by text;
--> statement-breakpoint
CREATE TABLE financial_records (
 id text PRIMARY KEY NOT NULL,
 inquiry_id text NOT NULL REFERENCES inquiries(id) ON DELETE NO ACTION,
 kind text NOT NULL CONSTRAINT financial_record_kind CHECK (kind IN ('payment','refund')),
 amount_cents integer NOT NULL CONSTRAINT financial_record_amount CHECK (typeof(amount_cents) = 'integer' AND amount_cents BETWEEN 1 AND 99999999),
 paid_on text NOT NULL,
 method text NOT NULL CONSTRAINT financial_record_method CHECK (method IN ('Venmo','PayPal','Cash','Stripe','Other')),
 created_at text NOT NULL,
 created_by text NOT NULL,
 voided_at text,
 voided_by text,
 void_reason text,
 CONSTRAINT financial_record_void CHECK ((voided_at IS NULL AND voided_by IS NULL AND void_reason IS NULL) OR (voided_at IS NOT NULL AND voided_by IS NOT NULL AND void_reason IS NOT NULL AND length(void_reason) BETWEEN 1 AND 300))
);
--> statement-breakpoint
CREATE INDEX financial_records_inquiry_idx ON financial_records(inquiry_id, created_at);
--> statement-breakpoint
CREATE TABLE inquiry_status_history (
 id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
 inquiry_id text NOT NULL REFERENCES inquiries(id) ON DELETE NO ACTION,
 from_status text,
 to_status text NOT NULL,
 created_at text NOT NULL,
 actor text
);
--> statement-breakpoint
CREATE INDEX inquiry_status_history_item_idx ON inquiry_status_history(inquiry_id, created_at);
--> statement-breakpoint
CREATE TABLE inquiry_amount_history (
 id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
 inquiry_id text NOT NULL REFERENCES inquiries(id) ON DELETE NO ACTION,
 from_quoted_cents integer,
 to_quoted_cents integer,
 from_booked_cents integer,
 to_booked_cents integer,
 created_at text NOT NULL,
 actor text NOT NULL
);
--> statement-breakpoint
CREATE INDEX inquiry_amount_history_item_idx ON inquiry_amount_history(inquiry_id, created_at);
--> statement-breakpoint
CREATE TABLE finance_rate_limits (
 key text PRIMARY KEY NOT NULL,
 count integer NOT NULL,
 expires_at integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX finance_rate_expiry_idx ON finance_rate_limits(expires_at);
--> statement-breakpoint
-- New submissions get a true creation transition; existing inquiries are not backfilled.
CREATE TRIGGER inquiry_created_history AFTER INSERT ON inquiries BEGIN
 INSERT INTO inquiry_status_history(inquiry_id,from_status,to_status,created_at,actor)
 VALUES(NEW.id,NULL,NEW.status,NEW.created_at,NULL);
END;
--> statement-breakpoint
CREATE TRIGGER inquiry_status_changed_history AFTER UPDATE OF status ON inquiries
WHEN OLD.status != NEW.status BEGIN
 INSERT INTO inquiry_status_history(inquiry_id,from_status,to_status,created_at,actor)
 VALUES(NEW.id,OLD.status,NEW.status,NEW.changed_at,NEW.changed_by);
END;
--> statement-breakpoint
CREATE TRIGGER inquiry_amount_changed_history AFTER UPDATE OF quoted_amount_cents,booked_amount_cents ON inquiries
WHEN OLD.quoted_amount_cents IS NOT NEW.quoted_amount_cents OR OLD.booked_amount_cents IS NOT NEW.booked_amount_cents BEGIN
 INSERT INTO inquiry_amount_history(inquiry_id,from_quoted_cents,to_quoted_cents,from_booked_cents,to_booked_cents,created_at,actor)
 VALUES(NEW.id,OLD.quoted_amount_cents,NEW.quoted_amount_cents,OLD.booked_amount_cents,NEW.booked_amount_cents,NEW.changed_at,NEW.changed_by);
END;
--> statement-breakpoint
-- Core entry fields never change; corrections void the original and create a new entry.
CREATE TRIGGER financial_record_immutable BEFORE UPDATE ON financial_records
WHEN OLD.id IS NOT NEW.id OR OLD.inquiry_id IS NOT NEW.inquiry_id OR OLD.kind IS NOT NEW.kind
 OR OLD.amount_cents IS NOT NEW.amount_cents OR OLD.paid_on IS NOT NEW.paid_on OR OLD.method IS NOT NEW.method
 OR OLD.created_at IS NOT NEW.created_at OR OLD.created_by IS NOT NEW.created_by
 OR OLD.voided_at IS NOT NULL BEGIN
 SELECT RAISE(ABORT, 'Financial records are immutable; use an audited void.');
END;
--> statement-breakpoint
CREATE TRIGGER financial_record_no_delete BEFORE DELETE ON financial_records BEGIN
 SELECT RAISE(ABORT, 'Financial records cannot be deleted.');
END;
--> statement-breakpoint
-- Defense in depth: even a future writer cannot over-refund or void funds backing a refund.
CREATE TRIGGER financial_refund_limit BEFORE INSERT ON financial_records
WHEN NEW.kind = 'refund' AND NEW.voided_at IS NULL AND NEW.amount_cents > (
 SELECT COALESCE(SUM(CASE WHEN kind = 'payment' THEN amount_cents ELSE -amount_cents END),0)
 FROM financial_records WHERE inquiry_id = NEW.inquiry_id AND voided_at IS NULL
) BEGIN
 SELECT RAISE(ABORT, 'Refund exceeds recorded funds.');
END;
--> statement-breakpoint
CREATE TRIGGER financial_void_limit BEFORE UPDATE OF voided_at ON financial_records
WHEN OLD.kind = 'payment' AND OLD.voided_at IS NULL AND NEW.voided_at IS NOT NULL AND OLD.amount_cents > (
 SELECT COALESCE(SUM(CASE WHEN kind = 'payment' THEN amount_cents ELSE -amount_cents END),0)
 FROM financial_records WHERE inquiry_id = OLD.inquiry_id AND voided_at IS NULL
) BEGIN
 SELECT RAISE(ABORT, 'Void would leave refunds without recorded funds.');
END;

--> statement-breakpoint
-- Older Worker code must not make unversioned status/amount writes after migration.
CREATE TRIGGER inquiry_change_requires_revision BEFORE UPDATE OF status,quoted_amount_cents,booked_amount_cents ON inquiries
WHEN (OLD.status IS NOT NEW.status OR OLD.quoted_amount_cents IS NOT NEW.quoted_amount_cents OR OLD.booked_amount_cents IS NOT NEW.booked_amount_cents)
 AND (OLD.revision IS NEW.revision OR NEW.changed_at IS NULL OR NEW.changed_by IS NULL) BEGIN
 SELECT RAISE(ABORT, 'Inquiry change requires revision and verified audit actor.');
END;
--> statement-breakpoint
CREATE TRIGGER inquiry_status_history_immutable BEFORE UPDATE ON inquiry_status_history BEGIN
 SELECT RAISE(ABORT, 'Status history is append-only.');
END;
--> statement-breakpoint
CREATE TRIGGER inquiry_status_history_no_delete BEFORE DELETE ON inquiry_status_history BEGIN
 SELECT RAISE(ABORT, 'Status history cannot be deleted.');
END;
--> statement-breakpoint
CREATE TRIGGER inquiry_amount_history_immutable BEFORE UPDATE ON inquiry_amount_history BEGIN
 SELECT RAISE(ABORT, 'Amount history is append-only.');
END;
--> statement-breakpoint
CREATE TRIGGER inquiry_amount_history_no_delete BEFORE DELETE ON inquiry_amount_history BEGIN
 SELECT RAISE(ABORT, 'Amount history cannot be deleted.');
END;
