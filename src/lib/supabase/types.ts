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

export type ExportFormat = "json" | "jsonl" | "allam-jsonl";

export type MainDialectGroupCode =
  "hijazi" | "najdi" | "eastern" | "northern" | "southern";

export type ParticipationExclusionReason =
  "spam" | "abuse" | "test" | "duplicate" | "invalid_submission";

export type PublicVisibility = "public" | "private";

export type DuplicateCandidateType = "exact" | "conflict" | "fuzzy";

export type DuplicateGroupStatus =
  "unresolved" | "not_duplicate" | "ignored" | "merged" | "split";

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
        submitted_msa_synonym: string | null;
        submitted_explanation: string | null;
        word_search_key: string;
        dialect_search_key: string;
        review_status: ReviewStatus;
        position: number;
        reference_prompt_id: string | null;
        reference_prompt_snapshot: unknown;
        selected_dialect_id: string | null;
        provisional_main_group_code: MainDialectGroupCode | null;
        admin_confirmed_main_group_code: MainDialectGroupCode | null;
        participation_exclusion_reason: ParticipationExclusionReason | null;
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
        main_group_code: MainDialectGroupCode | null;
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
        public_visibility: PublicVisibility;
        version: number;
        approved_by: string | null;
        approved_at: string | null;
        reference_prompt_id: string | null;
        concept_id: string | null;
        register: string | null;
        related_words: string[];
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
      reference_prompts: Table<{
        id: string;
        category: string;
        category_label_ar: string;
        msa_lemma: string;
        definition_ar: string;
        scenario_ar: string;
        part_of_speech: string;
        answer_form: string;
        priority: number;
        prompt_version: number;
        is_active: boolean;
        dataset_schema_version: number;
        display_order: number;
        created_at: string;
        updated_at: string;
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
      duplicate_group_resolutions: Table<{
        group_key: string;
        status: DuplicateGroupStatus;
        member_signature: string | null;
        canonical_entry_id: string | null;
        resolved_by: string | null;
        resolved_at: string | null;
        created_at: string;
        updated_at: string;
      }>;
      canonical_entry_dialects: Table<{
        canonical_entry_id: string;
        dialect_id: string;
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
        Returns: {
          batch_id: string;
          created: boolean;
          affected_groups: {
            main_group_code: string;
            submission_count: number;
          }[];
        }[];
      };
      set_submission_participation_exclusion: {
        Args: {
          p_actor: string;
          p_submission_id: string;
          p_reason: ParticipationExclusionReason | null;
        };
        Returns: Database["public"]["Tables"]["raw_word_submissions"]["Row"];
      };
      set_submission_main_group: {
        Args: {
          p_actor: string;
          p_submission_id: string;
          p_main_group_code: MainDialectGroupCode | null;
        };
        Returns: Database["public"]["Tables"]["raw_word_submissions"]["Row"];
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
      approve_raw_submission: {
        Args: {
          p_actor: string;
          p_submission_id: string;
          p_dialect_id: string;
          p_expected_updated_at: string | null;
          p_use_raw_defaults?: boolean;
          p_canonical_word?: string | null;
          p_canonical_word_search_key?: string | null;
          p_canonical_msa_synonyms?: string[] | null;
          p_canonical_explanation?: string | null;
          p_visibility?: PublicVisibility;
        };
        Returns: {
          entry_id: string | null;
          review_status: string;
          updated_at: string;
          stale: boolean;
          public_visibility: PublicVisibility | null;
        }[];
      };
      set_canonical_visibility: {
        Args: {
          p_actor: string;
          p_entry_id: string;
          p_visibility: PublicVisibility;
          p_expected_version: number | null;
        };
        Returns: {
          id: string;
          public_visibility: PublicVisibility;
          version: number;
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
          p_reference_prompt_id?: string | null;
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
          p_reference_prompt_id?: string | null;
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
      bulk_approve_submissions: {
        Args: {
          p_actor: string;
          p_items: unknown;
          p_visibility: string;
        };
        Returns: {
          submission_id: string;
          status: "approved" | "conflict" | "failed";
          entry_id: string | null;
          error_code: string | null;
        }[];
      };
      bulk_classify_submissions: {
        Args: {
          p_actor: string;
          p_items: unknown;
        };
        Returns: {
          submission_id: string;
          status: "approved" | "failed";
          entry_id: string | null;
          error_code: string | null;
        }[];
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
      duplicate_group_candidates: {
        Args: {
          p_search: string | null;
          p_candidate_type: string | null;
          p_main_group_code: string | null;
          p_local_dialect_label: string | null;
          p_min_candidates: number | null;
          p_resolution_status: string | null;
          p_sort: string | null;
          p_limit: number;
          p_offset: number;
        };
        Returns: {
          group_key: string;
          candidate_type: DuplicateCandidateType;
          word: string;
          word_search_key: string;
          candidate_count: number;
          main_group_codes: MainDialectGroupCode[] | null;
          local_dialect_labels: string[] | null;
          meanings: string[] | null;
          example_count: number;
          has_canonical: boolean;
          canonical_entry_id: string | null;
          canonical_status: string | null;
          public_visibility: PublicVisibility | null;
          resolution_status: DuplicateGroupStatus;
          newest_candidate_at: string;
          match_strength: number;
          total_count: number;
          member_ids: string[];
          auto_mergeable: boolean;
        }[];
      };
      count_auto_mergeable_duplicate_groups: {
        Args: Record<string, never>;
        Returns: number;
      };
      auto_merge_duplicate_group: {
        Args: { p_actor: string; p_group_key: string };
        Returns: { entry_id: string | null; merged: boolean; reason: string }[];
      };
      claim_auto_mergeable_duplicate_groups: {
        Args: {
          p_actor: string;
          p_limit?: number;
          p_lease_seconds?: number;
          p_max_failures?: number;
        };
        Returns: string[];
      };
      release_duplicate_group_claim: {
        Args: {
          p_actor: string;
          p_group_key: string;
          p_failed?: boolean;
          p_failure_reason?: string | null;
        };
        Returns: undefined;
      };
      duplicate_group_summary: {
        Args: Record<string, never>;
        Returns: {
          unresolved_groups: number;
          exact_match_groups: number;
          possible_match_groups: number;
          total_source_records: number;
        }[];
      };
      duplicate_group_members: {
        Args: { p_group_key: string };
        Returns: {
          member_type: "raw" | "canonical";
          member_id: string;
          word: string;
          dialect_id: string | null;
          dialect_ids: string[] | null;
          main_group_code: MainDialectGroupCode | null;
          local_dialect_label: string | null;
          meaning: string | null;
          msa_synonyms: string[] | null;
          examples: { id: string; sentence: string }[];
          related_words: string[] | null;
          concept_id: string | null;
          register: string | null;
          public_visibility: PublicVisibility | null;
          reference_prompt_id: string | null;
          version: number | null;
        }[];
      };
      resolve_duplicate_group: {
        Args: {
          p_actor: string;
          p_group_key: string;
          p_status: string;
          p_member_signature: string;
        };
        Returns: undefined;
      };
      reopen_duplicate_group: {
        Args: { p_actor: string; p_group_key: string };
        Returns: undefined;
      };
      merge_duplicate_group: {
        Args: {
          p_actor: string;
          p_group_key: string;
          p_member_signature: string;
          p_raw_submission_ids: string[];
          p_target_entry_id: string | null;
          p_expected_version: number | null;
          p_canonical_word: string;
          p_canonical_word_search_key: string;
          p_dialect_ids: string[];
          p_canonical_msa_synonyms: string[];
          p_canonical_explanation: string;
          p_examples: unknown;
          p_removed_canonical_example_ids?: string[];
          p_related_words?: string[];
          p_concept_id?: string | null;
          p_register?: string | null;
          p_visibility?: string;
          p_reference_prompt_id?: string | null;
        };
        Returns: string;
      };
      split_duplicate_group_words: {
        Args: {
          p_actor: string;
          p_group_key: string;
          p_member_signature: string;
          p_words: unknown;
          p_concept_id?: string | null;
        };
        Returns: string[];
      };
      update_canonical_entry_full: {
        Args: {
          p_actor: string;
          p_entry_id: string;
          p_expected_version: number | null;
          p_canonical_word: string;
          p_canonical_word_search_key: string;
          p_canonical_explanation: string;
          p_canonical_msa_synonyms: string[];
          p_dialect_ids: string[];
          p_examples: unknown;
          p_related_words: string[];
          p_concept_id: string | null;
          p_register: string | null;
          p_visibility: string | null;
        };
        Returns: { id: string; version: number; stale: boolean }[];
      };
      undo_canonical_entry_edit: {
        Args: {
          p_actor: string;
          p_event_id: string;
          p_expected_version: number | null;
        };
        Returns: { id: string; version: number; stale: boolean }[];
      };
      dictionary_entries_list: {
        Args: {
          p_search: string | null;
          p_main_group_code: string | null;
          p_local_dialect_label: string | null;
          p_visibility: string | null;
          p_register: string | null;
          p_missing_meaning: boolean | null;
          p_missing_examples: boolean | null;
          p_missing_concept: boolean | null;
          p_sort: string | null;
          p_limit: number;
          p_offset: number;
        };
        Returns: {
          id: string;
          canonical_word: string;
          canonical_word_search_key: string;
          concept_id: string | null;
          canonical_explanation: string | null;
          canonical_msa_synonyms: string[];
          register: string | null;
          public_visibility: PublicVisibility;
          main_group_codes: MainDialectGroupCode[];
          local_dialect_labels: string[];
          example_count: number;
          related_words: string[];
          updated_at: string;
          version: number;
          total_count: number;
        }[];
      };
      dictionary_entry_detail: {
        Args: { p_entry_id: string };
        Returns: {
          id: string;
          canonical_word: string;
          canonical_word_search_key: string;
          concept_id: string | null;
          canonical_explanation: string | null;
          canonical_msa_synonyms: string[];
          register: string | null;
          public_visibility: PublicVisibility;
          related_words: string[];
          version: number;
          dialect_ids: string[];
          examples: { id: string; sentence: string; position: number }[];
        }[];
      };
      bulk_set_dictionary_visibility: {
        Args: { p_actor: string; p_entry_ids: string[]; p_visibility: string };
        Returns: number;
      };
      bulk_add_dictionary_dialect: {
        Args: { p_actor: string; p_entry_ids: string[]; p_dialect_id: string };
        Returns: number;
      };
      list_active_reference_prompts: {
        Args: Record<string, never>;
        Returns: {
          id: string;
          category: string;
          category_label_ar: string;
          msa_lemma: string;
          definition_ar: string;
          scenario_ar: string;
          part_of_speech: string;
          answer_form: string;
          priority: number;
          prompt_version: number;
        }[];
      };
      public_dialect_leaderboard: {
        Args: Record<string, never>;
        Returns: {
          main_group_code: MainDialectGroupCode;
          main_group_label_ar: string;
          submission_count: number;
          approved_word_count: number;
          rank: number;
        }[];
      };
      public_dialect_words: {
        Args: {
          p_main_group_code?: MainDialectGroupCode | null;
          p_search?: string | null;
          p_category?: string | null;
          p_sort?: string | null;
          p_limit?: number | null;
          p_offset?: number | null;
        };
        Returns: {
          id: string;
          canonical_word: string;
          canonical_msa_synonyms: string[];
          canonical_explanation: string | null;
          local_dialect_label: string;
          main_group_code: MainDialectGroupCode | null;
          main_group_label_ar: string | null;
          category: string | null;
          category_label_ar: string | null;
          examples: { sentence: string }[];
          updated_at: string;
          total_count: number;
        }[];
      };
      upsert_reference_prompt: {
        Args: {
          p_actor: string;
          p_id: string;
          p_expected_prompt_version: number | null;
          p_category: string;
          p_category_label_ar: string;
          p_msa_lemma: string;
          p_definition_ar: string;
          p_scenario_ar: string;
          p_part_of_speech: string;
          p_answer_form: string;
          p_priority: number;
          p_is_active: boolean;
        };
        Returns: { id: string; prompt_version: number; stale: boolean }[];
      };
      reference_prompt_submission_counts: {
        Args: { p_actor: string };
        Returns: { reference_prompt_id: string; submission_count: number }[];
      };
      list_reference_prompts_page: {
        Args: {
          p_offset?: number | null;
          p_limit?: number | null;
          p_category?: string | null;
          p_search?: string | null;
        };
        Returns: {
          id: string;
          category: string;
          category_label_ar: string;
          msa_lemma: string;
          definition_ar: string;
          scenario_ar: string;
          part_of_speech: string;
          answer_form: string;
          priority: number;
          prompt_version: number;
          display_order: number;
          total_count: number;
        }[];
      };
      list_reference_prompt_category_counts: {
        Args: Record<string, never>;
        Returns: {
          category: string;
          category_label_ar: string;
          prompt_count: number;
        }[];
      };
      list_public_dialects: {
        Args: Record<string, never>;
        Returns: {
          id: string;
          name_ar: string;
          slug: string;
          parent_id: string | null;
          main_group_code: MainDialectGroupCode | null;
        }[];
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
