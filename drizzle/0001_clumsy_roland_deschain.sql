CREATE TABLE "eigenai_signatures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"iteration_number" integer NOT NULL,
	"diary_id" uuid,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL,
	"signature" text NOT NULL,
	"model_id" text NOT NULL,
	"request_hash" text NOT NULL,
	"response_hash" text NOT NULL,
	"local_verification_status" text DEFAULT 'pending' NOT NULL,
	"recovered_signer" text,
	"expected_signer" text,
	"verification_error" text,
	"submitted_to_recall" boolean DEFAULT false NOT NULL,
	"recall_submission_id" text,
	"recall_submitted_at" timestamp with time zone,
	"recall_verification_status" text,
	"recall_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "eigenai_signatures" ADD CONSTRAINT "eigenai_signatures_diary_id_trading_diary_id_fk" FOREIGN KEY ("diary_id") REFERENCES "public"."trading_diary"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_eigenai_iteration" ON "eigenai_signatures" USING btree ("iteration_number");--> statement-breakpoint
CREATE INDEX "idx_eigenai_timestamp" ON "eigenai_signatures" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "idx_eigenai_local_status" ON "eigenai_signatures" USING btree ("local_verification_status");--> statement-breakpoint
CREATE INDEX "idx_eigenai_recall_status" ON "eigenai_signatures" USING btree ("submitted_to_recall");