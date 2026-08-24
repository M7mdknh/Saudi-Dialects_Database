// Minimal hand-maintained database types. Regenerate with the Supabase CLI
// (`supabase gen types typescript`) once a live project exists, then replace
// this file. Kept intentionally narrow to the columns/functions the app
// reads/writes; embedded relational selects (e.g. `dialects(name_ar)`) are
// cast at the call site since foreign-key `Relationships` metadata isn't
// modeled here.

export type ReviewStatus =
  "new" | "pending" | "approved" | "rejected" | "duplicate" | "merged";

export type EditorialStatus = "draft" | "approved" | "retired";

export type SourceRelation = "primary" | "merged" | "supporting";

export type ExportFormat = "json" | "jsonl";

type Table<Row, Insert = Partial<Row>, Update = Partial<Row>> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

export interface Database {
  public: {
    Tables: {
      submission_batches: Table<{
        id: string;
        idempotency_key: string;
        consent_version: string;
        submitted_at: string;
        moderation_state: string;
        abuse_hash: string | null;
        abuse_hash_expires_at: string | null;
      }>;
      raw_word_submissions: Table<{
        id: string;
        batch_id: string;
        submitted_word: string;
        submitted_dialect: string;
        submitted_msa_synonym: string;
        submitted_explanation: string | null;
        word_search_key: string;
        dialect_search_key: string;
        review_status: ReviewStatus;
        position: number;
        created_at: string;
        updated_at: string;
      }>;
      raw_examples: Table<{
        id: string;
        raw_submission_id: string;
        sentence: string;
        sentence_search_key: string;
        position: number;
        created_at: string;
      }>;
      dialects: Table<{
        id: string;
        name_ar: string;
        slug: string;
        parent_id: string | null;
        is_active: boolean;
        created_at: string;
        updated_at: string;
      }>;
      dialect_aliases: Table<{
        id: string;
        alias_ar: string;
        alias_search_key: string;
        dialect_id: string;
        created_by: string | null;
        created_at: string;
        updated_at: string;
      }>;
      canonical_entries: Table<{
        id: string;
        canonical_word: string;
        canonical_word_search_key: string;
        canonical_dialect_id: string;
        canonical_msa_synonyms: string[];
        canonical_explanation: string | null;
        editorial_status: EditorialStatus;
        version: number;
        approved_by: string | null;
        approved_at: string | null;
        created_at: string;
        updated_at: string;
      }>;
      canonical_examples: Table<{
        id: string;
        canonical_entry_id: string;
        sentence: string;
        sentence_search_key: string;
        source_raw_example_id: string | null;
        position: number;
        created_at: string;
        updated_at: string;
      }>;
      entry_sources: Table<{
        canonical_entry_id: string;
        raw_submission_id: string;
        relation: SourceRelation;
        linked_at: string;
        linked_by: string | null;
      }>;
      review_events: Table<{
        id: string;
        raw_submission_id: string | null;
        canonical_entry_id: string | null;
        actor_id: string | null;
        action: string;
        before_state: unknown;
        after_state: unknown;
        created_at: string;
      }>;
      admin_submission_views: Table<{
        admin_id: string;
        raw_submission_id: string;
        first_seen_at: string;
        last_seen_at: string;
      }>;
      admins: Table<{
        user_id: string;
        is_active: boolean;
        created_at: string;
      }>;
      exports: Table<{
        id: string;
        created_by: string | null;
        format: ExportFormat;
        schema_version: number;
        filters: unknown;
        record_count: number;
        checksum: string | null;
        status: string;
        created_at: string;
        completed_at: string | null;
      }>;
    };
    Views: Record<string, never>;
    Functions: {
      is_active_admin: { Args: { p_user: string }; Returns: boolean };
      submit_batch: {
        Args: {
          p_idempotency_key: string;
          p_consent_version: string;
          p_words: unknown;
          p_abuse_hash: string | null;
          p_abuse_hash_expires_at: string | null;
        };
        Returns: { batch_id: string; created: boolean }[];
      };
      mark_submission_seen: {
        Args: { p_admin: string; p_submission: string };
        Returns: undefined;
      };
      review_raw_submission: {
        Args: {
          p_actor: string;
          p_submission_id: string;
          p_new_status: string;
          p_expected_updated_at: string | null;
        };
        Returns: {
          id: string;
          review_status: string;
          updated_at: string;
          stale: boolean;
        }[];
      };
      upsert_canonical_entry: {
        Args: {
          p_actor: string;
          p_entry_id: string | null;
          p_expected_version: number | null;
          p_canonical_word: string;
          p_canonical_word_search_key: string;
          p_canonical_dialect_id: string;
          p_canonical_msa_synonyms: string[];
          p_canonical_explanation: string;
          p_editorial_status: string;
        };
        Returns: { id: string; version: number; stale: boolean }[];
      };
      merge_submissions: {
        Args: {
          p_actor: string;
          p_raw_submission_ids: string[];
          p_target_entry_id: string | null;
          p_canonical_word: string;
          p_canonical_word_search_key: string;
          p_canonical_dialect_id: string;
          p_canonical_msa_synonyms: string[];
          p_canonical_explanation: string;
          p_examples: unknown;
        };
        Returns: string;
      };
      undo_review_event: {
        Args: { p_actor: string; p_event_id: string };
        Returns: undefined;
      };
      admin_dashboard_counts: {
        Args: { p_admin: string };
        Returns: unknown;
      };
      duplicate_candidates: {
        Args: { p_submission_id: string };
        Returns: {
          id: string;
          submitted_word: string;
          submitted_dialect: string;
          review_status: ReviewStatus;
          created_at: string;
          same_dialect: boolean;
        }[];
      };
      create_dialect: {
        Args: {
          p_actor: string;
          p_name_ar: string;
          p_slug: string;
          p_parent_id: string | null;
        };
        Returns: Database["public"]["Tables"]["dialects"]["Row"];
      };
      create_dialect_alias: {
        Args: { p_actor: string; p_alias_ar: string; p_dialect_id: string };
        Returns: Database["public"]["Tables"]["dialect_aliases"]["Row"];
      };
      classify_submission: {
        Args: {
          p_actor: string;
          p_submission_id: string;
          p_dialect_id: string;
        };
        Returns: string;
      };
      record_export: {
        Args: {
          p_actor: string;
          p_format: string;
          p_schema_version: number;
          p_filters: unknown;
          p_record_count: number;
          p_checksum: string;
        };
        Returns: Database["public"]["Tables"]["exports"]["Row"];
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
