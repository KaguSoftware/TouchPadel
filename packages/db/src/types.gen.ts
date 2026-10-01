export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  app: {
    Tables: {
      assistant_readable_columns: {
        Row: {
          column_name: string
          data_type: string | null
          is_default: boolean
          kind: string
          note: string | null
          ordinal: number | null
          table_name: string
        }
        Insert: {
          column_name: string
          data_type?: string | null
          is_default?: boolean
          kind: string
          note?: string | null
          ordinal?: number | null
          table_name: string
        }
        Update: {
          column_name?: string
          data_type?: string | null
          is_default?: boolean
          kind?: string
          note?: string | null
          ordinal?: number | null
          table_name?: string
        }
        Relationships: []
      }
      pin_attempts: {
        Row: {
          attempted_at: string
          device_id: string
          success: boolean
        }
        Insert: {
          attempted_at?: string
          device_id: string
          success: boolean
        }
        Update: {
          attempted_at?: string
          device_id?: string
          success?: boolean
        }
        Relationships: []
      }
      pin_grants: {
        Row: {
          authorizer_id: string
          caller_id: string
          consumed_at: string | null
          created_at: string
          device_id: string | null
          id: number
        }
        Insert: {
          authorizer_id: string
          caller_id: string
          consumed_at?: string | null
          created_at?: string
          device_id?: string | null
          id?: never
        }
        Update: {
          authorizer_id?: string
          caller_id?: string
          consumed_at?: string | null
          created_at?: string
          device_id?: string | null
          id?: never
        }
        Relationships: []
      }
      rpc_replays: {
        Row: {
          at: string
          caller: string
          fn: string
          idempotency_key: string
          result: Json | null
        }
        Insert: {
          at?: string
          caller: string
          fn: string
          idempotency_key: string
          result?: Json | null
        }
        Update: {
          at?: string
          caller?: string
          fn?: string
          idempotency_key?: string
          result?: Json | null
        }
        Relationships: []
      }
      secrets: {
        Row: {
          name: string
          value: string
        }
        Insert: {
          name: string
          value: string
        }
        Update: {
          name?: string
          value?: string
        }
        Relationships: []
      }
      sms_limits: {
        Row: {
          allowed_prefixes: string[]
          daily_total: number
          enabled: boolean
          id: boolean
          per_phone_per_day: number
          updated_at: string
        }
        Insert: {
          allowed_prefixes?: string[]
          daily_total?: number
          enabled?: boolean
          id?: boolean
          per_phone_per_day?: number
          updated_at?: string
        }
        Update: {
          allowed_prefixes?: string[]
          daily_total?: number
          enabled?: boolean
          id?: boolean
          per_phone_per_day?: number
          updated_at?: string
        }
        Relationships: []
      }
      sms_sends: {
        Row: {
          channel: string
          cost_iqd: number | null
          created_at: string
          id: number
          phone_canon: string
          phone_e164: string
          provider: string | null
          provider_msg_id: string | null
          purpose: string
          reason: string | null
          status: string
          user_id: string | null
        }
        Insert: {
          channel?: string
          cost_iqd?: number | null
          created_at?: string
          id?: never
          phone_canon: string
          phone_e164: string
          provider?: string | null
          provider_msg_id?: string | null
          purpose?: string
          reason?: string | null
          status?: string
          user_id?: string | null
        }
        Update: {
          channel?: string
          cost_iqd?: number | null
          created_at?: string
          id?: never
          phone_canon?: string
          phone_e164?: string
          provider?: string | null
          provider_msg_id?: string | null
          purpose?: string
          reason?: string | null
          status?: string
          user_id?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      // PROVISIONAL coaching RPC types — replaced by the regenerated file at integration
      // (docs/design/coaching/build-contracts-2026-10-01.md §1.6, §1.7, §1.12–§1.14; R17, R44,
      // R61): the union of what the website, the guest's lessons and coach mode call. R17:
      // p_venue_id may be NULL on coaching_public and coach_profile.
      add_my_time_off: {
        Args: { p_ends_at: string; p_reason: string; p_starts_at: string }
        Returns: Json
      }
      cancel_my_time_off: { Args: { p_id: string }; Returns: Json }
      coach_accept_public: { Args: never; Returns: Json }
      coach_add_student: {
        Args: {
          p_course_id: string
          p_idempotency_key: string
          p_lesson_id: string
          p_name: string
          p_phone: string
        }
        Returns: Json
      }
      coach_book_private: {
        Args: {
          p_idempotency_key: string
          p_lesson_type_id: string
          p_party_size: number
          p_start_at: string
          p_student_name: string
          p_student_phone: string
          p_venue_id: string
        }
        Returns: Json
      }
      coach_cancel_course: {
        Args: { p_course_id: string; p_reason: string }
        Returns: Json
      }
      coach_cancel_lesson: {
        Args: { p_lesson_id: string; p_reason: string }
        Returns: Json
      }
      coach_create_course: {
        Args: {
          p_idempotency_key: string
          p_lesson_type_id: string
          p_starts: string[]
          p_title_ar: string
          p_title_en: string
          p_venue_id: string
        }
        Returns: Json
      }
      coach_create_group: {
        Args: {
          p_idempotency_key: string
          p_lesson_type_id: string
          p_start_at: string
          p_venue_id: string
        }
        Returns: Json
      }
      coach_hours_mine: { Args: never; Returns: Json }
      coach_lesson: { Args: { p_lesson_id: string }; Returns: Json }
      coach_mark_attendance: {
        Args: { p_enrolment_id: string; p_lesson_id: string; p_status: string }
        Returns: Json
      }
      coach_me: { Args: never; Returns: Json }
      coach_profile: {
        Args: { p_coach_id: string; p_venue_id?: string | null }
        Returns: Json
      }
      coach_remove_student: {
        Args: { p_enrolment_id: string; p_reason: string }
        Returns: Json
      }
      coach_reschedule_session: {
        Args: { p_lesson_id: string; p_start_at: string }
        Returns: Json
      }
      coach_schedule: { Args: { p_from: string; p_to: string }; Returns: Json }
      coach_slots: {
        Args: {
          p_coach_id: string
          p_from: string
          p_lesson_type_id: string
          p_to: string
        }
        Returns: Json
      }
      coaching_public: { Args: { p_venue_id?: string | null }; Returns: Json }
      course_join: {
        Args: {
          p_course_id: string
          p_expected_price_iqd: number
          p_idempotency_key: string
          p_payment_mode: string
        }
        Returns: Json
      }
      lesson_book_private: {
        Args: {
          p_coach_id: string
          p_expected_price_iqd: number
          p_friend_names: string[]
          p_idempotency_key: string
          p_lesson_type_id: string
          p_party_size: number
          p_payment_mode: string
          p_start_at: string
        }
        Returns: Json
      }
      lesson_cancel_mine: { Args: { p_enrolment_id: string }; Returns: Json }
      lesson_join: {
        Args: {
          p_expected_price_iqd: number
          p_idempotency_key: string
          p_lesson_id: string
          p_payment_mode: string
        }
        Returns: Json
      }
      lesson_link_confirm: {
        Args: { p_enrolment_id: string; p_yes: boolean }
        Returns: Json
      }
      lesson_offer: {
        Args: { p_course_id?: string; p_lesson_id?: string }
        Returns: Json
      }
      my_coach_statements: { Args: { p_month?: string }; Returns: Json }
      my_lesson: { Args: { p_enrolment_id: string }; Returns: Json }
      my_lessons: { Args: { p_scope?: string }; Returns: Json }
      set_my_coach_hours: {
        Args: { p_venue_id: string; p_windows: Json }
        Returns: Json
      }
      // END PROVISIONAL coaching RPC types
      accept_terms: { Args: { p_version?: string }; Returns: Json }
      ack_waiter_call: { Args: { p_call_id: string }; Returns: Json }
      acknowledge_alert: { Args: { p_alert_id: string }; Returns: undefined }
      acknowledge_purchase_line: {
        Args: { p_line_id: string }
        Returns: undefined
      }
      add_coach_time_off: {
        Args: {
          p_coach_id: string
          p_ends_at: string
          p_reason: string
          p_starts_at: string
        }
        Returns: Json
      }
      add_customer_note: {
        Args: { p_body: string; p_customer_id: string }
        Returns: string
      }
      add_marketing_note: {
        Args: {
          p_body: string
          p_idempotency_key?: string
          p_photos?: string[]
          p_subject_id: string
          p_subject_kind: string
          p_venue_id: string
        }
        Returns: Json
      }
      add_marketing_request: {
        Args: {
          p_body: string
          p_idempotency_key?: string
          p_menu_item_id?: string
          p_photos?: string[]
          p_title: string
          p_venue_id?: string
          p_want_by?: string
        }
        Returns: Json
      }
      add_my_time_off: {
        Args: { p_ends_at: string; p_reason: string; p_starts_at: string }
        Returns: Json
      }
      add_order_items: {
        Args: { p_items: Json; p_order_id: string }
        Returns: number
      }
      add_release_note: {
        Args: {
          p_body: string
          p_idempotency_key?: string
          p_menu_item_id: string
        }
        Returns: Json
      }
      add_run_step: {
        Args: { p_after_run_step_id: string; p_run_id: string; p_step: Json }
        Returns: Json
      }
      add_shopping_item: {
        Args: {
          p_idempotency_key?: string
          p_ingredient_id: string
          p_label: string
          p_note?: string
          p_qty: number
          p_unit: string
          p_venue_id: string
        }
        Returns: Json
      }
      add_suggestion: {
        Args: {
          p_body: string
          p_idempotency_key?: string
          p_venue_id?: string
        }
        Returns: Json
      }
      addon_group_floor: { Args: { p_group_id: string }; Returns: number }
      addon_item_prices: { Args: { p_item_id: string }; Returns: Json }
      addon_items_of: { Args: { p_group_ids: string[] }; Returns: string[] }
      addon_prices_guard: { Args: { p_before: Json }; Returns: undefined }
      addon_prices_snapshot: { Args: { p_item_ids: string[] }; Returns: Json }
      analysis_venue: { Args: never; Returns: string }
      analytics_assert_basis: { Args: { p_basis: string }; Returns: undefined }
      analytics_best_sellers: {
        Args: {
          p_basis?: string
          p_from: string
          p_limit?: number
          p_to: string
        }
        Returns: Json
      }
      analytics_bought_together: {
        Args: {
          p_from: string
          p_limit?: number
          p_min_support?: number
          p_scope?: string
          p_to: string
        }
        Returns: Json
      }
      analytics_bounds: {
        Args: { p_from: string; p_to: string }
        Returns: Record<string, unknown>
      }
      analytics_component: {
        Args: { p_key: string; p_params?: Json }
        Returns: Json
      }
      analytics_courts_cafe: {
        Args: { p_court_id?: string; p_from: string; p_to: string }
        Returns: Json
      }
      analytics_courts_demand: {
        Args: { p_court_id?: string; p_from: string; p_to: string }
        Returns: Json
      }
      analytics_courts_endings: {
        Args: { p_court_id?: string; p_from: string; p_to: string }
        Returns: Json
      }
      analytics_courts_guests: {
        Args: { p_court_id?: string; p_from: string; p_to: string }
        Returns: Json
      }
      analytics_courts_summary: {
        Args: { p_court_id?: string; p_from: string; p_to: string }
        Returns: Json
      }
      analytics_daily_sales: {
        Args: { p_from: string; p_to: string }
        Returns: Json
      }
      analytics_excluded: { Args: never; Returns: string[] }
      analytics_guard: { Args: never; Returns: undefined }
      analytics_guest_ident: {
        Args: { p_guest_id: string; p_guest_phone: string }
        Returns: string
      }
      analytics_hourly: {
        Args: { p_from: string; p_to: string }
        Returns: Json
      }
      analytics_item_margins: {
        Args: { p_basis?: string; p_from: string; p_to: string }
        Returns: Json
      }
      analytics_menu_snapshot: { Args: never; Returns: Json }
      analytics_open_minutes: {
        Args: {
          p_court_id?: string
          p_start_hour: number
          p_ts_from: string
          p_ts_to: string
          p_tz: string
        }
        Returns: {
          court_id: string
          dow: number
          event_minutes: number
          hour: number
          open_days: number
          open_minutes: number
        }[]
      }
      analytics_price_bands: {
        Args: { p_basis?: string; p_from: string; p_to: string }
        Returns: Json
      }
      analytics_promo: { Args: { p_from: string; p_to: string }; Returns: Json }
      analytics_sales_lines: {
        Args: {
          p_basis: string
          p_start_hour: number
          p_ts_from: string
          p_ts_to: string
          p_tz: string
        }
        Returns: {
          business_date: string
          cost_iqd: number
          cost_total_iqd: number
          discount_line_iqd: number
          discount_source: string
          guest_session_id: string
          line_adj_iqd: number
          line_total_iqd: number
          list_line_iqd: number
          list_price_iqd: number
          menu_item_id: string
          net_line_iqd: number
          net_qty: number
          order_id: string
          order_item_id: string
          placed_at: string
          qty: number
          refund_iqd: number
          refund_qty: number
          settled_at: string
          source: Database["public"]["Enums"]["order_source"]
          tab_adj_iqd: number
          tab_id: string
          unit_price_iqd: number
          variant_id: string
        }[]
      }
      analytics_sold_items: {
        Args: { p_basis?: string; p_from: string; p_to: string }
        Returns: Json
      }
      answer_marketing_request: {
        Args: { p_answer: string; p_id: string; p_outcome: string }
        Returns: Json
      }
      apply_best_promotion: {
        Args: {
          p_code?: string
          p_device_id?: string
          p_idempotency_key?: string
          p_tab_id: string
        }
        Returns: Json
      }
      apply_discount: {
        Args: {
          p_device_id?: string
          p_idempotency_key?: string
          p_kind: Database["public"]["Enums"]["adjustment_kind"]
          p_order_item_id?: string
          p_pin: string
          p_reason_code: string
          p_tab_id: string
          p_value: number
        }
        Returns: Json
      }
      apply_pct_discount: {
        Args: { p_list: number; p_pct: number }
        Returns: number
      }
      archive_teaching: { Args: { p_id: string }; Returns: undefined }
      assert_bookable: {
        Args: { p_court_id: string; p_end_at: string; p_start_at: string }
        Returns: undefined
      }
      assert_not_degraded_for: {
        Args: { p_start_at: string; p_venue?: string }
        Returns: undefined
      }
      assert_store_for_kind: {
        Args: {
          p_kind: Database["public"]["Enums"]["ingredient_kind"]
          p_location: Database["public"]["Enums"]["stock_location"]
        }
        Returns: undefined
      }
      assert_tab_kind_role: { Args: { p_kind: string }; Returns: undefined }
      assistant_archive_component: {
        Args: { p_key: string }
        Returns: Database["public"]["Tables"]["assistant_components"]["Row"]
        SetofOptions: {
          from: "*"
          to: "assistant_components"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      assistant_archive_conversation: { Args: { p_id: string }; Returns: Json }
      assistant_audit_page: {
        Args: {
          p_action_prefix?: string
          p_actor_id?: string
          p_count_only?: boolean
          p_from?: string
          p_limit?: number
          p_offset?: number
          p_text?: string
          p_to?: string
        }
        Returns: Json
      }
      assistant_bookings_list: {
        Args: {
          p_count_only?: boolean
          p_court_id?: string
          p_customer_id?: string
          p_from: string
          p_limit?: number
          p_offset?: number
          p_status?: string
          p_to: string
        }
        Returns: Json
      }
      assistant_break_history: {
        Args: {
          p_count_only?: boolean
          p_from: string
          p_limit?: number
          p_offset?: number
          p_staff_id?: string
          p_to: string
        }
        Returns: Json
      }
      assistant_chunk_source: {
        Args: { p_kind: string; p_ref: string }
        Returns: Json
      }
      assistant_component_lookup: {
        Args: { p_key: string; p_params: Json }
        Returns: Json
      }
      assistant_component_supersede: {
        Args: { p_key: string; p_params_hash: string }
        Returns: number
      }
      assistant_component_upsert: { Args: { p: Json }; Returns: Json }
      assistant_count: {
        Args: { p_args?: Json; p_tool: string }
        Returns: number
      }
      assistant_courts_and_rates: { Args: never; Returns: Json }
      assistant_delete_chunk: {
        Args: { p_kind: string; p_ref: string }
        Returns: number
      }
      assistant_in_list: {
        Args: { p_col: string; p_values: Json }
        Returns: string
      }
      assistant_index_done: { Args: { p_ids: number[] }; Returns: number }
      assistant_index_fail: {
        Args: { p_error: string; p_id: number }
        Returns: undefined
      }
      assistant_index_nudge: { Args: never; Returns: undefined }
      assistant_job_allowed: {
        Args: { p_from: string; p_to: string }
        Returns: boolean
      }
      assistant_job_cancel: {
        Args: { p_id: string }
        Returns: Database["public"]["Tables"]["assistant_jobs"]["Row"]
        SetofOptions: {
          from: "*"
          to: "assistant_jobs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      assistant_job_tick_nudge: { Args: never; Returns: undefined }
      assistant_job_transition: {
        Args: { p_id: string; p_patch?: Json; p_status: string }
        Returns: Database["public"]["Tables"]["assistant_jobs"]["Row"]
        SetofOptions: {
          from: "*"
          to: "assistant_jobs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      assistant_model_allowed: { Args: { p_model: string }; Returns: boolean }
      assistant_models: { Args: never; Returns: Json }
      assistant_page: {
        Args: { p_limit: number; p_offset: number }
        Returns: Record<string, unknown>
      }
      assistant_params_hash: { Args: { p_params: Json }; Returns: string }
      assistant_payments_list: {
        Args: {
          p_count_only?: boolean
          p_from: string
          p_limit?: number
          p_method?: string
          p_offset?: number
          p_to: string
        }
        Returns: Json
      }
      assistant_pin_component: {
        Args: {
          p_default_params?: Json
          p_key: string
          p_output_schema: Json
          p_question: string
          p_tools: string[]
        }
        Returns: Database["public"]["Tables"]["assistant_components"]["Row"]
        SetofOptions: {
          from: "*"
          to: "assistant_components"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      assistant_prewarm_nudge: { Args: never; Returns: undefined }
      assistant_run_tool: {
        Args: { p_args?: Json; p_tool: string }
        Returns: Json
      }
      assistant_run_tool_prewarm: {
        Args: { p_args?: Json; p_tool: string }
        Returns: Json
      }
      assistant_search: {
        Args: {
          p_embedding?: string
          p_kinds?: string[]
          p_limit?: number
          p_query: string
        }
        Returns: Json
      }
      assistant_set_default_model: {
        Args: { p_model: string }
        Returns: undefined
      }
      assistant_set_model: {
        Args: { p_id: string; p_model: string }
        Returns: Database["public"]["Tables"]["assistant_conversations"]["Row"]
        SetofOptions: {
          from: "*"
          to: "assistant_conversations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      assistant_set_monthly_cap: {
        Args: { p_cap_micros: number }
        Returns: Json
      }
      assistant_set_scopes: {
        Args: { p_id: string; p_range?: Json; p_scopes: string[] }
        Returns: Database["public"]["Tables"]["assistant_conversations"]["Row"]
        SetofOptions: {
          from: "*"
          to: "assistant_conversations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      assistant_settings_read: { Args: never; Returns: Json }
      assistant_stock_view: {
        Args: { p_limit?: number; p_offset?: number; p_view: string }
        Returns: Json
      }
      assistant_system_status: { Args: never; Returns: Json }
      assistant_table_read: {
        Args: {
          p_columns?: string[]
          p_count_only?: boolean
          p_filters?: Json
          p_limit?: number
          p_offset?: number
          p_order?: string
          p_table: string
        }
        Returns: Json
      }
      assistant_tabs_list: {
        Args: {
          p_count_only?: boolean
          p_from: string
          p_limit?: number
          p_offset?: number
          p_status?: string
          p_to: string
        }
        Returns: Json
      }
      assistant_upsert_chunk: { Args: { p: Json }; Returns: number }
      assistant_usage: {
        Args: { p_from?: string; p_to?: string }
        Returns: Json
      }
      attendance_month: {
        Args: { p_month?: string; p_venue_id?: string }
        Returns: Json
      }
      audit_log_page: {
        Args: {
          p_action_prefix?: string
          p_actor_id?: string
          p_from: string
          p_limit?: number
          p_offset?: number
          p_to: string
        }
        Returns: Json
      }
      audit_staff_password_reset: {
        Args: { p_actor_id: string; p_staff_id: string }
        Returns: undefined
      }
      b64url_decode: { Args: { p: string }; Returns: string }
      b64url_encode: { Args: { p: string }; Returns: string }
      block_courts_for_event: {
        Args: { p_blocks: Json; p_idempotency_key?: string; p_run_id: string }
        Returns: Json
      }
      booking_bill: { Args: { p_reservation_id: string }; Returns: Json }
      booking_bill_states: {
        Args: { p_reservation_ids: string[] }
        Returns: Json
      }
      branch_readiness: { Args: { p_venue: string }; Returns: Json }
      break_allowance_seconds: { Args: never; Returns: number }
      break_cover_candidates: {
        Args: { p_for: string; p_station_id: string }
        Returns: Json
      }
      break_row_json: {
        Args: { p_row: Database["public"]["Tables"]["staff_breaks"]["Row"] }
        Returns: Json
      }
      break_status: { Args: { p_device_id: string }; Returns: Json }
      break_used_seconds: {
        Args: { p_date: string; p_staff_id: string }
        Returns: number
      }
      business_date:
        | { Args: { p_at: string }; Returns: string }
        | {
            Args: { p_at: string; p_start_hour: number; p_tz: string }
            Returns: string
          }
      cafe_net_lines: {
        Args: { p_tab_ids: string[] }
        Returns: {
          cost_iqd: number
          cost_total_iqd: number
          gross_iqd: number
          line_discount_iqd: number
          menu_item_id: string
          net_iqd: number
          order_id: string
          order_item_id: string
          qty: number
          refund_iqd: number
          refund_qty: number
          tab_discount_iqd: number
          tab_id: string
          variant_id: string
        }[]
      }
      cafe_setting: { Args: { p_key: string; p_venue?: string }; Returns: Json }
      cafe_setting_bool: {
        Args: { p_key: string; p_venue?: string }
        Returns: boolean
      }
      cafe_setting_int: {
        Args: { p_key: string; p_venue?: string }
        Returns: number
      }
      cafe_setting_spec: {
        Args: { p_key: string }
        Returns: {
          default_value: Json
          is_public: boolean
          jtype: string
          key: string
          min_role: Database["public"]["Enums"]["staff_role"]
        }[]
      }
      cafe_setting_specs: {
        Args: never
        Returns: {
          default_value: Json
          is_public: boolean
          jtype: string
          key: string
          min_role: Database["public"]["Enums"]["staff_role"]
        }[]
      }
      cafe_setting_text: {
        Args: { p_key: string; p_venue?: string }
        Returns: string
      }
      cafe_settled_tabs: {
        Args: { p_ts_from?: string; p_ts_to?: string }
        Returns: {
          cafe_gross_iqd: number
          cafe_net_iqd: number
          court_iqd: number
          discount_iqd: number
          goods_iqd: number
          refunds_iqd: number
          reservation_id: string
          settled_at: string
          subtotal_iqd: number
          tab_id: string
          tax_iqd: number
          total_iqd: number
        }[]
      }
      cancel_coach_time_off: { Args: { p_id: string }; Returns: Json }
      cancel_deduction: {
        Args: { p_id: string; p_reason: string }
        Returns: Json
      }
      cancel_my_time_off: { Args: { p_id: string }; Returns: Json }
      cancel_reservation: {
        Args: { p_reason?: string; p_reservation_id: string }
        Returns: Json
      }
      cancel_schedule: { Args: { p_run_id: string }; Returns: Json }
      cancel_series: {
        Args: { p_reason_code: string; p_scope: string; p_series_id: string }
        Returns: Json
      }
      cancel_shopping_item: { Args: { p_id: string }; Returns: undefined }
      cancel_tab: {
        Args: {
          p_device_id?: string
          p_idempotency_key?: string
          p_reason_code?: string
          p_tab_id: string
        }
        Returns: Json
      }
      checklist_board: {
        Args: { p_business_date?: string; p_venue_id?: string }
        Returns: Json
      }
      checklist_day_state: {
        Args: { p_business_date?: string; p_venue_id?: string }
        Returns: Json
      }
      claim_due_index: {
        Args: { p_limit?: number }
        Returns: Database["public"]["Tables"]["assistant_index_queue"]["Row"][]
        SetofOptions: {
          from: "*"
          to: "assistant_index_queue"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_due_notifications: {
        Args: { p_limit?: number }
        Returns: Database["public"]["Tables"]["notification_outbox"]["Row"][]
        SetofOptions: {
          from: "*"
          to: "notification_outbox"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_due_telegram: {
        Args: { p_limit?: number }
        Returns: Database["public"]["Tables"]["telegram_outbox"]["Row"][]
        SetofOptions: {
          from: "*"
          to: "telegram_outbox"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_replay: { Args: { p_fn: string; p_key: string }; Returns: Json }
      claim_staff_media: {
        Args: {
          p_folders: string[]
          p_paths: string[]
          p_used_by: string
          p_venue: string
        }
        Returns: undefined
      }
      clear_attendance: { Args: { p_id: string }; Returns: Json }
      clear_pin_lockout: { Args: { p_staff_id: string }; Returns: Json }
      clear_staff_pin: { Args: { p_staff_id: string }; Returns: undefined }
      clear_table_token_secret_prev: { Args: never; Returns: Json }
      close_branch: {
        Args: { p_venue: string }
        Returns: Database["public"]["Tables"]["venues"]["Row"]
        SetofOptions: {
          from: "*"
          to: "venues"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      close_day: {
        Args: {
          p_card_batch_iqd?: number
          p_cash_counted_iqd: number
          p_device_id?: string
          p_notes?: string
          p_venue_id?: string
        }
        Returns: Json
      }
      close_till_shift: {
        Args: {
          p_counted_iqd: number
          p_device_id: string
          p_idempotency_key?: string
          p_note?: string
          p_pin: string
          p_till_shift_id: string
        }
        Returns: Json
      }
      close_till_shift_for: {
        Args: {
          p_counted_iqd: number
          p_device_id: string
          p_idempotency_key?: string
          p_note?: string
          p_till_shift_id: string
        }
        Returns: Json
      }
      close_till_shift_internal: {
        Args: {
          p_auth: string
          p_counted: number
          p_device_id: string
          p_note: string
          p_shift: Database["public"]["Tables"]["till_shifts"]["Row"]
          p_via: string
        }
        Returns: Json
      }
      coach_accept_public: { Args: never; Returns: Json }
      coach_add_student: {
        Args: {
          p_course_id: string
          p_idempotency_key: string
          p_lesson_id: string
          p_name: string
          p_phone: string
        }
        Returns: Json
      }
      coach_available: {
        Args: { p_coach_id: string; p_period: unknown; p_venue: string }
        Returns: boolean
      }
      coach_book_private: {
        Args: {
          p_idempotency_key: string
          p_lesson_type_id: string
          p_party_size: number
          p_start_at: string
          p_student_name: string
          p_student_phone: string
          p_venue_id: string
        }
        Returns: Json
      }
      coach_cancel_course: {
        Args: { p_course_id: string; p_reason: string }
        Returns: Json
      }
      coach_cancel_lesson: {
        Args: { p_lesson_id: string; p_reason: string }
        Returns: Json
      }
      coach_create_course: {
        Args: {
          p_idempotency_key: string
          p_lesson_type_id: string
          p_starts: string[]
          p_title_ar: string
          p_title_en: string
          p_venue_id: string
        }
        Returns: Json
      }
      coach_create_group: {
        Args: {
          p_idempotency_key: string
          p_lesson_type_id: string
          p_start_at: string
          p_venue_id: string
        }
        Returns: Json
      }
      coach_hours_mine: { Args: never; Returns: Json }
      coach_hours_write: {
        Args: {
          p_coach_id: string
          p_staff_id: string
          p_venue: string
          p_windows: Json
        }
        Returns: Json
      }
      coach_in_hours: {
        Args: { p_coach_id: string; p_period: unknown; p_venue: string }
        Returns: boolean
      }
      coach_lesson: { Args: { p_lesson_id: string }; Returns: Json }
      coach_mark_attendance: {
        Args: { p_enrolment_id: string; p_lesson_id: string; p_status: string }
        Returns: Json
      }
      coach_me: { Args: never; Returns: Json }
      coach_of_caller: {
        Args: never
        Returns: Database["public"]["Tables"]["coaches"]["Row"]
        SetofOptions: {
          from: "*"
          to: "coaches"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      coach_photo_path_ok: { Args: { p_path: string }; Returns: boolean }
      coach_photo_purge_due: { Args: { p_limit?: number }; Returns: Json }
      coach_photo_purged: { Args: { p_id: string }; Returns: undefined }
      coach_profile: {
        Args: { p_coach_id: string; p_venue_id?: string }
        Returns: Json
      }
      coach_promote: {
        Args: {
          p_bio_ar: string
          p_bio_en: string
          p_display_name_ar: string
          p_display_name_en: string
          p_photo_path: string
          p_profile_id: string
          p_venue_ids: string[]
        }
        Returns: Json
      }
      coach_remove_student: {
        Args: { p_enrolment_id: string; p_reason: string }
        Returns: Json
      }
      coach_reschedule_session: {
        Args: { p_lesson_id: string; p_start_at: string }
        Returns: Json
      }
      coach_schedule: { Args: { p_from: string; p_to: string }; Returns: Json }
      coach_self: {
        Args: { p_raise?: boolean }
        Returns: Database["public"]["Tables"]["coaches"]["Row"]
        SetofOptions: {
          from: "*"
          to: "coaches"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      coach_slots: {
        Args: {
          p_coach_id: string
          p_from: string
          p_lesson_type_id: string
          p_to: string
        }
        Returns: Json
      }
      coach_staff_scope: { Args: { p_coach_id: string }; Returns: boolean }
      coach_statement_approve: {
        Args: { p_statement_id: string }
        Returns: Json
      }
      coach_statement_build: {
        Args: { p_coach_id: string; p_month: string; p_venue_id: string }
        Returns: string
      }
      coach_statement_detail: {
        Args: { p_statement_id: string }
        Returns: Json
      }
      coach_statement_draft_one: {
        Args: { p_coach_id: string; p_month: string; p_venue_id: string }
        Returns: boolean
      }
      coach_statement_lessons: {
        Args: {
          p_coach_id?: string
          p_ts_from: string
          p_ts_to: string
          p_venues: string[]
        }
        Returns: {
          coach_id: string
          coach_iqd: number
          collected_iqd: number
          course_id: string
          court_share_iqd: number
          end_at: string
          kind: string
          lesson_id: string
          lesson_type_id: string
          max_places: number
          minutes: number
          session_no: number
          share_bp: number
          start_at: string
          status: string
          venue_id: string
        }[]
      }
      coach_statement_mark_paid: {
        Args: {
          p_device_id?: string
          p_pin: string
          p_reference: string
          p_statement_id: string
        }
        Returns: Json
      }
      coach_statement_plan: {
        Args: { p_coach_id: string; p_month: string; p_venue_id: string }
        Returns: Json
      }
      coach_statement_refresh: {
        Args: { p_statement_id: string }
        Returns: Json
      }
      coach_statement_void: {
        Args: {
          p_device_id?: string
          p_pin?: string
          p_reason: string
          p_statement_id: string
        }
        Returns: Json
      }
      coach_time_off_add: {
        Args: {
          p_coach_id: string
          p_ends_at: string
          p_reason: string
          p_staff_id: string
          p_starts_at: string
        }
        Returns: Json
      }
      coach_update: {
        Args: { p_coach_id: string; p_patch: Json }
        Returns: Json
      }
      coach_windows_parse: { Args: { p_windows: Json }; Returns: Json }
      coaches_admin: { Args: { p_venue_id?: string }; Returns: Json }
      coaching_public: { Args: { p_venue_id?: string }; Returns: Json }
      coaching_rules: { Args: { p_venue: string }; Returns: Json }
      coaching_settings: { Args: { p_venue_id?: string }; Returns: Json }
      compute_tab_totals: {
        Args: { p_tab_id: string }
        Returns: {
          court_iqd: number
          discount_iqd: number
          lesson_iqd: number
          subtotal_iqd: number
          tax_iqd: number
          total_iqd: number
        }[]
      }
      confirm_booking: {
        Args: {
          p_guest_name?: string
          p_guest_phone?: string
          p_hold_id: string
          p_players?: number
        }
        Returns: Json
      }
      confirm_purchase_delivery: {
        Args: { p_purchase_id: string }
        Returns: Json
      }
      confirm_receipt: {
        Args: {
          p_id: string
          p_idempotency_key?: string
          p_lines: Json
          p_location?: string
          p_supplier_id?: string
          p_supplier_name?: string
        }
        Returns: Json
      }
      consume_fefo: {
        Args: {
          p_device?: string
          p_ingredient: string
          p_order_item?: string
          p_qty: number
          p_reason_code?: string
          p_staff?: string
          p_ticket?: string
          p_type: Database["public"]["Enums"]["movement_type"]
        }
        Returns: undefined
      }
      consume_fefo_at: {
        Args: {
          p_device?: string
          p_ingredient: string
          p_location: Database["public"]["Enums"]["stock_location"]
          p_order_item?: string
          p_qty: number
          p_reason_code?: string
          p_staff?: string
          p_ticket?: string
          p_type: Database["public"]["Enums"]["movement_type"]
        }
        Returns: number
      }
      consume_for_order_item: {
        Args: { p_order_item_id: string; p_ticket_id?: string }
        Returns: undefined
      }
      consume_pin_grant: { Args: { p_device_id?: string }; Returns: string }
      content_detail: { Args: { p_id: string }; Returns: Json }
      content_page: {
        Args: {
          p_filter?: string
          p_limit?: number
          p_offset?: number
          p_venue_id?: string
        }
        Returns: Json
      }
      course_cancel_internal: {
        Args: {
          p_actor: string
          p_course_id: string
          p_profile_id: string
          p_reason: string
          p_staff_id: string
        }
        Returns: Json
      }
      course_join: {
        Args: {
          p_course_id: string
          p_expected_price_iqd: number
          p_idempotency_key: string
          p_payment_mode: string
        }
        Returns: Json
      }
      course_late_join_price: {
        Args: {
          p_course_price: number
          p_first_session_no: number
          p_sessions_count: number
        }
        Returns: number
      }
      course_places_taken: {
        Args: { p_course_id: string; p_exclude_enrolment?: string }
        Returns: number
      }
      course_ref_lesson: { Args: { p_course_id: string }; Returns: string }
      course_share_for: {
        Args: { p_enrolment_id: string; p_session_no: number }
        Returns: number
      }
      court_fee_paid: {
        Args: { p_exclude_tab_id?: string; p_reservation_id: string }
        Returns: number
      }
      court_fee_remaining: {
        Args: { p_exclude_tab_id?: string; p_reservation_id: string }
        Returns: number
      }
      court_fee_written_off: {
        Args: { p_exclude_tab_id?: string; p_reservation_id: string }
        Returns: number
      }
      cover_station: {
        Args: { p_device_id: string; p_pin: string; p_staff_id: string }
        Returns: Json
      }
      create_branch: {
        Args: {
          p_address_ar?: string
          p_address_en?: string
          p_name_ar: string
          p_name_en: string
          p_phone?: string
          p_slug: string
          p_source_venue: string
          p_timezone?: string
        }
        Returns: Json
      }
      create_guest_order: {
        Args: {
          p_device_id?: string
          p_idempotency_key?: string
          p_items: Json
        }
        Returns: Json
      }
      create_order_slip: {
        Args: {
          p_idempotency_key?: string
          p_storage_path: string
          p_venue_id: string
        }
        Returns: Json
      }
      create_receipt: {
        Args: {
          p_idempotency_key?: string
          p_source?: string
          p_storage_path: string
          p_venue_id: string
        }
        Returns: Json
      }
      create_series: {
        Args: {
          p_court_id: string
          p_device_id?: string
          p_duration_min: number
          p_ends_on: string
          p_guest_id?: string
          p_guest_name?: string
          p_guest_phone?: string
          p_idempotency_key?: string
          p_notes?: string
          p_pattern: string
          p_players?: number
          p_resolutions?: Json
          p_start_time: string
          p_starts_on: string
          p_weekdays: number[]
        }
        Returns: Json
      }
      current_open_day: { Args: { p_venue?: string }; Returns: string }
      current_open_day_locked: { Args: { p_venue?: string }; Returns: string }
      current_unit_cost: {
        Args: { p_item_id: string; p_variant_id: string }
        Returns: number
      }
      current_venue: { Args: { p_station_id?: string }; Returns: string }
      current_venue_or_default: { Args: never; Returns: string }
      customer_counts: { Args: { p_customer_id: string }; Returns: Json }
      customer_directory: { Args: { p_limit?: number }; Returns: Json }
      customer_flags_json: { Args: { p_customer_id: string }; Returns: Json }
      customer_lessons: { Args: { p_customer_id: string }; Returns: Json }
      customer_record: { Args: { p_customer_id: string }; Returns: Json }
      customer_reservation_json: {
        Args: {
          c: Database["public"]["Tables"]["courts"]["Row"]
          r: Database["public"]["Tables"]["reservations"]["Row"]
        }
        Returns: Json
      }
      customer_search: {
        Args: { p_limit?: number; p_query: string }
        Returns: Json[]
      }
      day_close_online: { Args: { p_day_session_id?: string }; Returns: Json }
      day_close_shop: { Args: { p_day_session_id?: string }; Returns: Json }
      decide_content: {
        Args: {
          p_decision: string
          p_id: string
          p_note?: string
          p_version: number
        }
        Returns: Json
      }
      decide_deduction: {
        Args: { p_approve: boolean; p_id: string; p_note?: string }
        Returns: Json
      }
      decide_recipe_change: {
        Args: { p_approve: boolean; p_id: string; p_reason?: string }
        Returns: Json
      }
      decide_shopping_item: {
        Args: { p_approve: boolean; p_id: string; p_reason?: string }
        Returns: Json
      }
      decide_staff_request: {
        Args: { p_approve: boolean; p_id: string; p_note?: string }
        Returns: Json
      }
      decide_step: {
        Args: {
          p_data?: Json
          p_decision: string
          p_note?: string
          p_send_back_to?: string
          p_submission_id: string
        }
        Returns: Json
      }
      decline_release_idea: {
        Args: { p_id: string; p_reason: string }
        Returns: Json
      }
      deduction_targets: { Args: { p_venue_id?: string }; Returns: Json }
      deductions_month: {
        Args: { p_month?: string; p_venue_id?: string }
        Returns: Json
      }
      deductions_page: {
        Args: {
          p_filter?: string
          p_limit?: number
          p_offset?: number
          p_venue_id?: string
        }
        Returns: Json
      }
      default_venue: { Args: never; Returns: string }
      delete_court: { Args: { p_id: string }; Returns: Json }
      delete_hiring_candidate: { Args: { p_id: string }; Returns: undefined }
      delete_my_account: { Args: { p_confirm?: string }; Returns: Json }
      deposit_amount: {
        Args: { p_price_iqd: number; p_venue_id: string }
        Returns: number
      }
      deposit_apply: {
        Args: {
          p_amount: number
          p_canceled: boolean
          p_currency: string
          p_provider_payment_id: string
          p_provider_status: string
          p_raw?: Json
          p_request_id: string
          p_signature_ok?: boolean
          p_source: string
        }
        Returns: Json
      }
      deposit_attention: { Args: { p_venue_id?: string }; Returns: Json }
      deposit_begin_refund: {
        Args: {
          p_amount_iqd?: number
          p_note?: string
          p_payment_id: string
          p_reason: string
        }
        Returns: Database["public"]["Tables"]["booking_payments"]["Row"]
        SetofOptions: {
          from: "*"
          to: "booking_payments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      deposit_event: {
        Args: {
          p_note?: string
          p_payment_id: string
          p_provider_status?: string
          p_raw?: Json
          p_signature_ok?: boolean
          p_source: string
        }
        Returns: undefined
      }
      deposit_log_event: {
        Args: {
          p_note: string
          p_provider_status: string
          p_raw: Json
          p_request_id: string
          p_signature_ok: boolean
          p_source: string
        }
        Returns: undefined
      }
      deposit_mark_created: {
        Args: {
          p_form_url: string
          p_provider_payment_id: string
          p_provider_status: string
          p_raw?: Json
          p_request_id: string
        }
        Returns: Json
      }
      deposit_mode_for: {
        Args: { p_guest_id: string; p_venue_id: string }
        Returns: string
      }
      deposit_net_paid: { Args: { p_reservation_id: string }; Returns: number }
      deposit_note_cancel_attempt: {
        Args: { p_payment_id: string }
        Returns: number
      }
      deposit_nudge: { Args: never; Returns: undefined }
      deposit_prepare: {
        Args: {
          p_guest_id: string
          p_hold_id: string
          p_locale: string
          p_provider: string
        }
        Returns: Json
      }
      deposit_quote: { Args: { p_hold_id: string }; Returns: Json }
      deposit_refund_apply: {
        Args: {
          p_outcome: string
          p_payment_id: string
          p_provider_status: string
          p_raw?: Json
          p_refund_provider_id: string
        }
        Returns: Json
      }
      deposit_refund_manual: {
        Args: {
          p_device_id?: string
          p_note: string
          p_payment_id: string
          p_pin: string
        }
        Returns: Json
      }
      deposit_refund_request: {
        Args: { p_amount_iqd?: number; p_payment_id: string }
        Returns: Json
      }
      deposit_refund_retry: { Args: { p_payment_id: string }; Returns: Json }
      deposit_settings: { Args: { p_venue_id?: string }; Returns: Json }
      deposit_settle_success: {
        Args: { p_payment_id: string }
        Returns: string
      }
      deposit_status: { Args: { p_request_id: string }; Returns: Json }
      deposits_due_for_reconcile: { Args: { p_limit?: number }; Returns: Json }
      desk_add_seat: {
        Args: {
          p_customer_id?: string
          p_gender?: string
          p_guest_name?: string
          p_guest_phone?: string
          p_idempotency_key?: string
          p_match_id: string
        }
        Returns: Json
      }
      desk_add_student: {
        Args: {
          p_course_id: string
          p_customer_id: string
          p_idempotency_key: string
          p_lesson_id: string
          p_name: string
          p_phone: string
        }
        Returns: Json
      }
      desk_book_lesson: {
        Args: {
          p_coach_id: string
          p_customer_id: string
          p_idempotency_key: string
          p_lesson_type_id: string
          p_name: string
          p_party_size: number
          p_phone: string
          p_start_at: string
        }
        Returns: Json
      }
      desk_call_off_short: { Args: { p_match_id: string }; Returns: Json }
      desk_cancel_course: {
        Args: { p_course_id: string; p_reason: string }
        Returns: Json
      }
      desk_cancel_enrolment: {
        Args: { p_enrolment_id: string; p_reason: string }
        Returns: Json
      }
      desk_cancel_lesson: {
        Args: { p_lesson_id: string; p_reason: string }
        Returns: Json
      }
      desk_cancel_match: {
        Args: { p_match_id: string; p_reason: string }
        Returns: Json
      }
      desk_create_course: {
        Args: {
          p_coach_id: string
          p_idempotency_key: string
          p_lesson_type_id: string
          p_starts: string[]
          p_title_ar: string
          p_title_en: string
        }
        Returns: Json
      }
      desk_create_group: {
        Args: {
          p_coach_id: string
          p_idempotency_key: string
          p_lesson_type_id: string
          p_start_at: string
        }
        Returns: Json
      }
      desk_lesson_detail: { Args: { p_lesson_id: string }; Returns: Json }
      desk_lessons: {
        Args: { p_from: string; p_to: string; p_venue_id: string }
        Returns: Json
      }
      desk_mark_attendance: {
        Args: { p_enrolment_id: string; p_lesson_id: string; p_status: string }
        Returns: Json
      }
      desk_match_detail: { Args: { p_match_id: string }; Returns: Json }
      desk_match_states: {
        Args: { p_reservation_ids: string[] }
        Returns: Json
      }
      desk_move_lesson_court: {
        Args: { p_court_id: string; p_lesson_id: string }
        Returns: Json
      }
      desk_open_matches: {
        Args: { p_from: string; p_to: string }
        Returns: Json
      }
      desk_register_customer: {
        Args: {
          p_actor_id: string
          p_customer_id: string
          p_full_name: string
          p_phone: string
          p_preferred_lang: string
        }
        Returns: Json
      }
      desk_remove_seat: {
        Args: { p_reason: string; p_seat_id: string }
        Returns: Json
      }
      desk_reschedule_session: {
        Args: { p_lesson_id: string; p_start_at: string }
        Returns: Json
      }
      desk_start_answer: {
        Args: {
          m: Database["public"]["Tables"]["matches"]["Row"]
          p_duplicate: boolean
        }
        Returns: Json
      }
      desk_start_match: {
        Args: {
          p_category: string
          p_court_id?: string
          p_customer_id?: string
          p_duration_min: number
          p_extra_seats?: number
          p_gender?: string
          p_guest_name?: string
          p_guest_phone?: string
          p_idempotency_key?: string
          p_join_policy: string
          p_start_at: string
          p_venue_id?: string
          p_visibility: string
        }
        Returns: Json
      }
      discard_count: { Args: { p_count_id: string }; Returns: Json }
      edit_customer_note: {
        Args: { p_body: string; p_note_id: string }
        Returns: Json
      }
      edit_run_items: {
        Args: { p_items: Json; p_run_step_id: string }
        Returns: Json
      }
      eligible_promotions: {
        Args: { p_code?: string; p_tab_id: string }
        Returns: Json
      }
      end_break: { Args: { p_device_id: string; p_pin: string }; Returns: Json }
      enqueue_telegram: {
        Args: {
          p_kind: string
          p_payload?: Json
          p_ref_id: string
          p_venue?: string
        }
        Returns: number
      }
      enrolment_cancel_internal: {
        Args: {
          p_actor: string
          p_enrolment_id: string
          p_kind: string
          p_profile_id: string
          p_staff_id: string
        }
        Returns: Json
      }
      expire_stale_holds: {
        Args: { p_court_id?: string; p_period?: unknown }
        Returns: number
      }
      extend_reservation: {
        Args: {
          p_new_end_at: string
          p_reason?: string
          p_reservation_id: string
        }
        Returns: Json
      }
      finalize_count: {
        Args: { p_count_id: string; p_device_id?: string; p_lines?: Json }
        Returns: Json
      }
      find_customer_by_phone: { Args: { p_phone: string }; Returns: string }
      finish_replay: {
        Args: { p_key: string; p_result: Json }
        Returns: undefined
      }
      flag_expired_batches: { Args: never; Returns: undefined }
      floor_menu: { Args: { p_venue_id?: string }; Returns: Json }
      floor_menu_group: {
        Args: { p_group_id: string; p_revealed: boolean }
        Returns: Json
      }
      floor_tables: { Args: { p_venue_id?: string }; Returns: Json }
      generate_promo_code: { Args: { p_id: string }; Returns: string }
      generate_table_token: { Args: { p_table_id: string }; Returns: string }
      guest_games_played: { Args: { p_guest_id: string }; Returns: number }
      guest_hold_standing: { Args: { p_customer_id: string }; Returns: Json }
      guest_match_no_shows: { Args: { p_guest_id: string }; Returns: number }
      guest_tickets: { Args: { p_customer_id: string }; Returns: Json }
      has_own_pin: { Args: never; Returns: boolean }
      header_station_venue: { Args: never; Returns: string }
      heartbeat: {
        Args: {
          p_app_version?: string
          p_device_id: string
          p_is_till?: boolean
          p_queue_depth?: number
        }
        Returns: Json
      }
      hiring_candidates: { Args: { p_run_id: string }; Returns: Json }
      hiring_iqd: { Args: { p_hint: string; p_value: Json }; Returns: number }
      hiring_only_keys: {
        Args: { p_allowed: string[]; p_record: Json }
        Returns: undefined
      }
      hiring_position_role: { Args: { p_run_id: string }; Returns: string }
      hiring_purge_due: { Args: never; Returns: Json }
      hiring_text: {
        Args: {
          p_cap: number
          p_hint: string
          p_required: boolean
          p_value: Json
        }
        Returns: string
      }
      hold_key_guests: { Args: { p_key: string }; Returns: string[] }
      hold_reviews: { Args: { p_venue_id?: string }; Returns: Json }
      hold_slot: {
        Args: {
          p_client_ref?: string
          p_court_id: string
          p_device_id?: string
          p_duration_min: number
          p_idempotency_key?: string
          p_start_at: string
        }
        Returns: Json
      }
      hold_standing_decide: {
        Args: { p_decision: string; p_standing_id: string }
        Returns: Json
      }
      hold_standing_json: {
        Args: { s: Database["public"]["Tables"]["hold_standing"]["Row"] }
        Returns: Json
      }
      hold_standing_key: { Args: { p_guest_id: string }; Returns: string }
      hold_strike_apply: {
        Args: {
          p_at: string
          p_guest_id: string
          p_key: string
          p_venue_id: string
        }
        Returns: undefined
      }
      hold_strikes_settle: { Args: { p_guests?: string[] }; Returns: number }
      incident_kind_label: { Args: { p_kind: string }; Returns: Json }
      incident_photo_purge_due: { Args: { p_limit?: number }; Returns: Json }
      incident_photos_purged: { Args: { p_id: string }; Returns: undefined }
      incident_purge_due: { Args: never; Returns: Json }
      incidents_page: {
        Args: {
          p_filter?: string
          p_limit?: number
          p_offset?: number
          p_venue_id?: string
        }
        Returns: Json
      }
      ingredient_on_hand: { Args: { p_ingredient: string }; Returns: number }
      iqd_split: { Args: { p_n: number; p_total: number }; Returns: number[] }
      is_degraded:
        | { Args: never; Returns: boolean }
        | { Args: { p_venue: string }; Returns: boolean }
      is_media_path: { Args: { p: string }; Returns: boolean }
      is_own_session: { Args: { p_session_id: string }; Returns: boolean }
      is_staff: {
        Args: { roles: Database["public"]["Enums"]["staff_role"][] }
        Returns: boolean
      }
      is_staff_at: {
        Args: {
          p_venue: string
          roles: Database["public"]["Enums"]["staff_role"][]
        }
        Returns: boolean
      }
      is_staff_media_path: { Args: { p_name: string }; Returns: boolean }
      item_active_groups: {
        Args: { p_chosen_modifier_ids: string[]; p_item_id: string }
        Returns: string[]
      }
      item_required_ingredients: {
        Args: { p_id: string }
        Returns: {
          ingredient_id: string
          qty: number
        }[]
      }
      jsonb_top_keys_text: { Args: { p: Json }; Returns: string }
      kitchen_board: { Args: { p_venue_id?: string }; Returns: Json }
      lesson_blocked_refund_record: {
        Args: {
          p_amount_iqd: number
          p_device_id?: string
          p_enrolment_id: string
          p_pin: string
          p_reference: string
        }
        Returns: Json
      }
      lesson_book_private: {
        Args: {
          p_coach_id: string
          p_expected_price_iqd: number
          p_friend_names: string[]
          p_idempotency_key: string
          p_lesson_type_id: string
          p_party_size: number
          p_payment_mode: string
          p_start_at: string
        }
        Returns: Json
      }
      lesson_bookable: {
        Args: { p_end_at: string; p_start_at: string; p_venue: string }
        Returns: string
      }
      lesson_booked_places: {
        Args: { p_course_id: string; p_lesson_id: string }
        Returns: number
      }
      lesson_booking_answer: {
        Args: { p_duplicate: boolean; p_enrolment_id: string }
        Returns: Json
      }
      lesson_cancel_internal: {
        Args: {
          p_actor: string
          p_lesson_id: string
          p_profile_id: string
          p_reason: string
          p_staff_id: string
        }
        Returns: Json
      }
      lesson_cancel_mine: { Args: { p_enrolment_id: string }; Returns: Json }
      lesson_check_start: {
        Args: {
          p_detail?: string
          p_end_at: string
          p_start_at: string
          p_venue: string
        }
        Returns: undefined
      }
      lesson_coach_free: {
        Args: {
          p_coach_id: string
          p_detail?: string
          p_except: string
          p_period: unknown
          p_venue: string
        }
        Returns: undefined
      }
      lesson_coach_share: {
        Args: { p_collected: number; p_court_share: number; p_share_bp: number }
        Returns: number
      }
      lesson_collected: { Args: { p_lesson_id: string }; Returns: number }
      lesson_course_answer: {
        Args: { p_course_id: string; p_duplicate: boolean }
        Returns: Json
      }
      lesson_course_create_internal: {
        Args: {
          p_by: string
          p_coach_id: string
          p_degraded: boolean
          p_key: string
          p_lesson_type_id: string
          p_profile_id: string
          p_staff_id: string
          p_starts: string[]
          p_title_ar: string
          p_title_en: string
        }
        Returns: Json
      }
      lesson_course_offer: { Args: { p_course_id: string }; Returns: Json }
      lesson_court_release: {
        Args: { p_lesson_id: string; p_status: string }
        Returns: undefined
      }
      lesson_create_internal: {
        Args: {
          p_booked_by_kind: string
          p_coach_id: string
          p_course_id: string
          p_held: boolean
          p_idempotency_key: string
          p_lesson_type_id: string
          p_locked: string[]
          p_price_iqd: number
          p_profile_id: string
          p_session_no: number
          p_staff_id: string
          p_start_at: string
        }
        Returns: Database["public"]["Tables"]["lessons"]["Row"]
        SetofOptions: {
          from: "*"
          to: "lessons"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      lesson_create_replay: {
        Args: {
          p_by: string
          p_key: string
          p_kind: string
          p_profile_id: string
          p_staff_id: string
        }
        Returns: Json
      }
      lesson_customer_label: { Args: { p_profile_id: string }; Returns: Json }
      lesson_enrolment_money: {
        Args: { p_enrolment_id: string }
        Returns: Json
      }
      lesson_event: {
        Args: {
          p_actor: string
          p_actor_profile_id?: string
          p_actor_staff_id?: string
          p_code?: string
          p_course_id: string
          p_data?: Json
          p_enrolment_id: string
          p_lesson_id: string
          p_type: string
          p_venue_id: string
        }
        Returns: number
      }
      lesson_fee_remaining: {
        Args: { p_enrolment_id: string; p_exclude_tab_id?: string }
        Returns: number
      }
      lesson_group_answer: {
        Args: { p_duplicate: boolean; p_lesson_id: string }
        Returns: Json
      }
      lesson_group_create_internal: {
        Args: {
          p_by: string
          p_coach_id: string
          p_degraded: boolean
          p_key: string
          p_lesson_type_id: string
          p_profile_id: string
          p_staff_id: string
          p_start_at: string
        }
        Returns: Json
      }
      lesson_guest: {
        Args: { p_act: boolean }
        Returns: Database["public"]["Tables"]["profiles"]["Row"]
        SetofOptions: {
          from: "*"
          to: "profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      lesson_guest_ladder: { Args: { p_guest_id: string }; Returns: undefined }
      lesson_guest_payment: {
        Args: {
          p_guest: Database["public"]["Tables"]["profiles"]["Row"]
          p_payment_mode: string
          p_venue: string
        }
        Returns: undefined
      }
      lesson_guest_replay: {
        Args: {
          p_course_id: string
          p_guest_id: string
          p_key: string
          p_lesson_id: string
        }
        Returns: Json
      }
      lesson_hold_expire: { Args: { p_enrolment_id: string }; Returns: boolean }
      lesson_join: {
        Args: {
          p_expected_price_iqd: number
          p_idempotency_key: string
          p_lesson_id: string
          p_payment_mode: string
        }
        Returns: Json
      }
      lesson_link_by_phone: {
        Args: { p_exclude_profile: string; p_phone: string }
        Returns: string
      }
      lesson_link_confirm: {
        Args: { p_enrolment_id: string; p_yes: boolean }
        Returns: Json
      }
      lesson_lock_branch_courts: {
        Args: { p_venue: string }
        Returns: string[]
      }
      lesson_mark_internal: {
        Args: {
          p_actor: string
          p_enrolment_id: string
          p_lesson_id: string
          p_profile_id: string
          p_staff_id: string
          p_status: string
        }
        Returns: Json
      }
      lesson_money_figures: {
        Args: { p_ts_from: string; p_ts_to: string; p_venues: string[] }
        Returns: Json
      }
      lesson_money_open: { Args: { p_venue_id: string }; Returns: boolean }
      lesson_moved_answer: {
        Args: { p_duplicate: boolean; p_lesson_id: string }
        Returns: Json
      }
      lesson_notify: {
        Args: {
          p_dedupe?: string
          p_params?: Json
          p_ref: string
          p_title_key: string
        }
        Returns: number
      }
      lesson_offer: {
        Args: { p_course_id?: string; p_lesson_id?: string }
        Returns: Json
      }
      lesson_on_grid: {
        Args: { p_start_at: string; p_venue: string }
        Returns: boolean
      }
      lesson_payment_prepare: {
        Args: {
          p_enrolment_id: string
          p_guest_id: string
          p_locale: string
          p_provider: string
        }
        Returns: Json
      }
      lesson_pick_court: {
        Args: { p_locked: string[]; p_period: unknown; p_venue: string }
        Returns: string
      }
      lesson_places_data: {
        Args: { p_course_id: string; p_lesson_id: string }
        Returns: Json
      }
      lesson_places_taken: {
        Args: { p_exclude_enrolment?: string; p_lesson_id: string }
        Returns: number
      }
      lesson_price_for: {
        Args: { p_coach_id: string; p_lesson_type_id: string }
        Returns: number
      }
      lesson_private_answer: {
        Args: { p_duplicate: boolean; p_enrolment_id: string }
        Returns: Json
      }
      lesson_read_coach_card: { Args: { p_coach_id: string }; Returns: Json }
      lesson_read_course_ref: { Args: { p_course_id: string }; Returns: string }
      lesson_read_covered: {
        Args: { p_enrolment_id: string }
        Returns: Database["public"]["Tables"]["lessons"]["Row"][]
        SetofOptions: {
          from: "*"
          to: "lessons"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      lesson_read_covering: {
        Args: { p_lesson_id: string }
        Returns: Database["public"]["Tables"]["lesson_enrolments"]["Row"][]
        SetofOptions: {
          from: "*"
          to: "lesson_enrolments"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      lesson_read_enrolment_ref: {
        Args: { p_enrolment_id: string }
        Returns: string
      }
      lesson_read_my_row: { Args: { p_enrolment_id: string }; Returns: Json }
      lesson_read_push_coach: {
        Args: { p_lesson_id: string; p_places?: Json; p_title_key: string }
        Returns: number
      }
      lesson_read_push_guest: {
        Args: {
          p_enrolment_id: string
          p_lesson_id: string
          p_title_key: string
        }
        Returns: number
      }
      lesson_read_sessions: {
        Args: { p_coach_id?: string; p_venues: string[] }
        Returns: Json
      }
      lesson_read_sync_once: {
        Args: { p_lesson_id: string }
        Returns: undefined
      }
      lesson_reason_code: { Args: { p_reason: string }; Returns: string }
      lesson_refund_start: {
        Args: { p_enrolment_id: string; p_reason: string }
        Returns: number
      }
      lesson_refunds_due: { Args: { p_venue_id?: string }; Returns: Json }
      lesson_reschedule_internal: {
        Args: {
          p_actor: string
          p_degraded: boolean
          p_lesson_id: string
          p_profile_id: string
          p_staff_id: string
          p_start_at: string
        }
        Returns: Json
      }
      lesson_settle: {
        Args: {
          p_device_id?: string
          p_enrolment_id: string
          p_expected_owed_iqd: number
          p_idempotency_key?: string
          p_method: Database["public"]["Enums"]["payment_method"]
          p_tendered_iqd?: number
        }
        Returns: Json
      }
      lesson_settle_success: {
        Args: { p_locked: string[]; p_payment_id: string }
        Returns: string
      }
      lesson_strike_record: {
        Args: { p_enrolment_id: string; p_kind: string; p_lesson_id: string }
        Returns: undefined
      }
      lesson_student_add_internal: {
        Args: {
          p_by: string
          p_course_id: string
          p_guest_id: string
          p_key: string
          p_lesson_id: string
          p_link_confirmed: boolean
          p_name: string
          p_phone: string
          p_profile_id: string
          p_staff_id: string
        }
        Returns: Database["public"]["Tables"]["lesson_enrolments"]["Row"]
        SetofOptions: {
          from: "*"
          to: "lesson_enrolments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      lesson_sweep: { Args: never; Returns: Json }
      lesson_sync_reminders: {
        Args: { p_lesson_id: string }
        Returns: undefined
      }
      lesson_terms_ok: { Args: { p_version: string }; Returns: boolean }
      lesson_type_merge: {
        Args: {
          p_old: Database["public"]["Tables"]["lesson_types"]["Row"]
          p_patch: Json
          p_venue: string
        }
        Returns: Database["public"]["Tables"]["lesson_types"]["Row"]
        SetofOptions: {
          from: "*"
          to: "lesson_types"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      lesson_typed_purge: { Args: { p_limit?: number }; Returns: number }
      like_escape: { Args: { p_text: string }; Returns: string }
      link_item_modifier_group: {
        Args: {
          p_group_id: string
          p_item_id: string
          p_linked?: boolean
          p_sort_order?: number
        }
        Returns: undefined
      }
      list_staff: {
        Args: never
        Returns: {
          display_name: string
          has_pin: boolean
          id: string
          is_active: boolean
          role: Database["public"]["Enums"]["staff_role"]
        }[]
      }
      llm_begin_request: { Args: never; Returns: Json }
      llm_price_calc: {
        Args: {
          p_cache_read: number
          p_cache_write: number
          p_input: number
          p_model: string
          p_output: number
        }
        Returns: number
      }
      llm_price_micros: {
        Args: {
          p_cache_read: number
          p_cache_write: number
          p_input: number
          p_model: string
          p_output: number
        }
        Returns: number
      }
      llm_record_usage:
        | {
            Args: {
              p_cache_read: number
              p_cache_write: number
              p_input: number
              p_model: string
              p_model_calls: number
              p_output: number
              p_surface?: string
            }
            Returns: number
          }
        | {
            Args: {
              p_completion_tokens: number
              p_model_calls: number
              p_prompt_tokens: number
            }
            Returns: undefined
          }
      llm_usage_summary: { Args: never; Returns: Json }
      lock_coach: { Args: { p_coach_id: string }; Returns: undefined }
      lock_court: { Args: { p_court_id: string }; Returns: undefined }
      lock_match_money: { Args: { p_match_id: string }; Returns: undefined }
      lock_match_venue: { Args: { p_venue: string }; Returns: undefined }
      lock_principal: {
        Args: { p_id: string; p_kind: string }
        Returns: undefined
      }
      lock_stock_ingredients: {
        Args: { p_ingredients: string[] }
        Returns: undefined
      }
      lock_wage: {
        Args: { p_staff: string; p_venue: string }
        Returns: undefined
      }
      log_stock: {
        Args: {
          p_idempotency_key?: string
          p_lines?: Json
          p_location?: string
          p_note?: string
          p_venue_id?: string
        }
        Returns: Json
      }
      mark_checklist_item: {
        Args: {
          p_done: boolean
          p_item_id: string
          p_note?: string
          p_photo_path?: string
        }
        Returns: Json
      }
      mark_match_seats: {
        Args: { p_attendance: string; p_seat_ids: string[] }
        Returns: Json
      }
      mark_reservation: {
        Args: {
          p_reason?: string
          p_reservation_id: string
          p_status: Database["public"]["Enums"]["reservation_status"]
        }
        Returns: Json
      }
      mark_suggestion_seen: { Args: { p_id: string }; Returns: Json }
      mark_wage_paid: {
        Args: {
          p_expected_net_iqd?: number
          p_idempotency_key?: string
          p_month: string
          p_staff_id: string
          p_venue_id?: string
        }
        Returns: Json
      }
      marketing_audience_reach: { Args: { p_rule: Json }; Returns: number }
      marketing_campaign_performance: {
        Args: { p_campaign: string }
        Returns: Json
      }
      marketing_campaign_results: {
        Args: { p_limit?: number; p_venue_id?: string }
        Returns: Json
      }
      marketing_notes_for: {
        Args: { p_subject_id: string; p_subject_kind: string }
        Returns: Json
      }
      marketing_overview: { Args: never; Returns: Json }
      marketing_requests_page: {
        Args: {
          p_filter?: string
          p_limit?: number
          p_offset?: number
          p_venue_id?: string
        }
        Returns: Json
      }
      marketing_suggestions: { Args: { p_venue_id?: string }; Returns: Json }
      match_block: {
        Args: { p_match_id: string; p_request_id?: string; p_seat_id?: string }
        Returns: Json
      }
      match_cancel: {
        Args: { p_match_id: string; p_reason?: string }
        Returns: Json
      }
      match_carriers: {
        Args: { p_match_id: string }
        Returns: {
          seat_id: string
          seat_no: number
          status: string
        }[]
      }
      match_court_claimed: {
        Args: { p_court_id: string; p_period: unknown }
        Returns: boolean
      }
      match_court_free_firm: {
        Args: {
          p_duration_min: number
          p_need?: number
          p_period: unknown
          p_venue: string
        }
        Returns: boolean
      }
      match_decide: {
        Args: { p_approve: boolean; p_request_id: string }
        Returns: Json
      }
      match_desk_numbers: {
        Args: { m: Database["public"]["Tables"]["matches"]["Row"] }
        Returns: number[]
      }
      match_detail: {
        Args: { p_match_id?: string; p_token?: string }
        Returns: Json
      }
      match_display_name: { Args: { p_profile_id: string }; Returns: Json }
      match_drop_ineligible: { Args: { p_match_id: string }; Returns: number }
      match_eligibility: {
        Args: { p_act: boolean; p_profile_id: string }
        Returns: string
      }
      match_end: {
        Args: {
          p_actor: string
          p_match_id: string
          p_reason: string
          p_status: string
        }
        Returns: boolean
      }
      match_event: {
        Args: {
          p_actor: string
          p_code?: string
          p_data?: Json
          p_match_id: string
          p_request_id?: string
          p_seat_id?: string
          p_type: string
          p_venue_id: string
        }
        Returns: number
      }
      match_expire_holds: {
        Args: { p_period: unknown; p_venue: string }
        Returns: number
      }
      match_friends: { Args: { p_friends: Json }; Returns: string[] }
      match_guest: {
        Args: { p_act: boolean }
        Returns: Database["public"]["Tables"]["profiles"]["Row"]
        SetofOptions: {
          from: "*"
          to: "profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      match_guest_numbers: {
        Args: { m: Database["public"]["Tables"]["matches"]["Row"] }
        Returns: number[]
      }
      match_invite: { Args: { p_token: string }; Returns: Json }
      match_join: {
        Args: { p_friends?: Json; p_match_id: string; p_token?: string }
        Returns: Json
      }
      match_join_refusal: {
        Args: {
          m: Database["public"]["Tables"]["matches"]["Row"]
          p_friends: string[]
          p_guest: string
          p_mode: string
        }
        Returns: string
      }
      match_leave: {
        Args: { p_match_id: string; p_seat_ids?: string[] }
        Returns: Json
      }
      match_link_payment: {
        Args: {
          p_allocations: Json
          p_idempotency_key?: string
          p_payment_id: string
        }
        Returns: Json
      }
      match_lock: {
        Args: { p_match_id: string }
        Returns: Database["public"]["Tables"]["matches"]["Row"]
        SetofOptions: {
          from: "*"
          to: "matches"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      match_lock_courts: { Args: { p_venue: string }; Returns: undefined }
      match_marks_open: { Args: { p_match_id: string }; Returns: boolean }
      match_money: {
        Args: { p_exclude_tab_id: string; p_match_id: string }
        Returns: Json
      }
      match_my_seats: {
        Args: { p_guest: string; p_match_id: string }
        Returns: Json
      }
      match_notify: {
        Args: {
          p_actor?: string
          p_dedupe?: string
          p_match_id: string
          p_params?: Json
          p_recipients: string[]
          p_scheduled_for?: string
          p_title_key: string
        }
        Returns: number
      }
      match_pick_court: {
        Args: { m: Database["public"]["Tables"]["matches"]["Row"] }
        Returns: string
      }
      match_post_message: {
        Args: { p_code: string; p_match_id: string }
        Returns: Json
      }
      match_quote: {
        Args: {
          p_court_id: string
          p_duration_min: number
          p_start_at: string
          p_venue_id: string
        }
        Returns: Json
      }
      match_raise: { Args: { p_refusal: string }; Returns: undefined }
      match_reason_parts: { Args: { p_reason: string }; Returns: string[] }
      match_receipt_lines: { Args: { p_id: string }; Returns: number }
      match_recompute_organiser: {
        Args: { p_match_id: string }
        Returns: boolean
      }
      match_remove_player: {
        Args: { p_match_id: string; p_seat_id: string }
        Returns: Json
      }
      match_report: {
        Args: {
          p_block?: boolean
          p_match_id: string
          p_reason: string
          p_request_id?: string
          p_seat_id?: string
        }
        Returns: Json
      }
      match_report_target: {
        Args: {
          p_match_id: string
          p_request_id: string
          p_seat_id: string
          p_viewer: string
        }
        Returns: string
      }
      match_reports_open: { Args: { p_venue_id?: string }; Returns: Json }
      match_request: {
        Args: { p_friends?: Json; p_match_id: string; p_token?: string }
        Returns: Json
      }
      match_seat_label: {
        Args: { s: Database["public"]["Tables"]["match_seats"]["Row"] }
        Returns: Json
      }
      match_seat_money: {
        Args: { p_match_id: string }
        Returns: {
          carrying: boolean
          credit_iqd: number
          kind: string
          open_iqd: number
          owed_iqd: number
          paid_desk_iqd: number
          seat_id: string
          seat_no: number
          share_iqd: number
          status: string
          take_iqd: number
          write_off: string
          written_off_iqd: number
        }[]
      }
      match_seat_settle: {
        Args: {
          p_amount_iqd?: number
          p_device_id?: string
          p_expected_owed_iqd: number
          p_idempotency_key?: string
          p_method: Database["public"]["Enums"]["payment_method"]
          p_seat_ids: string[]
          p_tendered_iqd?: number
        }
        Returns: Json
      }
      match_seat_ticket: {
        Args: { s: Database["public"]["Tables"]["match_seats"]["Row"] }
        Returns: Json
      }
      match_seat_write_off: {
        Args: {
          p_device_id?: string
          p_pin: string
          p_reason: string
          p_seat_id: string
        }
        Returns: Json
      }
      match_settings: { Args: { p_venue_id?: string }; Returns: Json }
      match_shares: { Args: { p_price: number }; Returns: number[] }
      match_slip_lines: { Args: { p_id: string }; Returns: number }
      match_slots: {
        Args: { p_from: string; p_to: string; p_venue_id: string }
        Returns: Json
      }
      match_start: {
        Args: {
          p_category: string
          p_court_id: string
          p_duration_min: number
          p_friends?: Json
          p_idempotency_key?: string
          p_join_policy: string
          p_quoted_price_iqd?: number
          p_start_at: string
          p_venue_id: string
          p_visibility: string
        }
        Returns: Json
      }
      match_sweep: { Args: { p_venue_id?: string }; Returns: Json }
      match_sync_reminders: { Args: { p_match_id: string }; Returns: undefined }
      match_take_seats: {
        Args: {
          m: Database["public"]["Tables"]["matches"]["Row"]
          p_friends: string[]
          p_guest: string
          p_request_id?: string
          p_tickets: string[]
        }
        Returns: Json
      }
      match_terms_ok: { Args: { p_version: string }; Returns: boolean }
      match_time_clash: {
        Args: {
          p_except_key?: string
          p_except_match?: string
          p_guest: string
          p_period: unknown
        }
        Returns: boolean
      }
      match_try_book: { Args: { p_match_id: string }; Returns: string }
      match_unblock: { Args: { p_block_id: string }; Returns: Json }
      match_visibility: {
        Args: {
          m: Database["public"]["Tables"]["matches"]["Row"]
          p_gender: string
          p_token: string
          p_viewer: string
        }
        Returns: string
      }
      match_withdraw: { Args: { p_request_id: string }; Returns: Json }
      menu_availability: {
        Args: never
        Returns: {
          item_id: string
          orderable: boolean
        }[]
      }
      merge_tabs: {
        Args: { p_donor_tab_id: string; p_survivor_tab_id: string }
        Returns: Json
      }
      move_reservation: {
        Args: {
          p_court_id?: string
          p_end_at?: string
          p_reason?: string
          p_reservation_id: string
          p_start_at?: string
        }
        Returns: Json
      }
      my_campaign_drafts: { Args: { p_venue_id?: string }; Returns: Json }
      my_checklists_today: { Args: { p_venue_id?: string }; Returns: Json }
      my_coach_statements: { Args: { p_month?: string }; Returns: Json }
      my_deduction_proposals: {
        Args: { p_limit?: number; p_venue_id?: string }
        Returns: Json
      }
      my_deductions: {
        Args: { p_month?: string; p_venue_id?: string }
        Returns: Json
      }
      my_incidents: {
        Args: { p_limit?: number; p_venue_id?: string }
        Returns: Json
      }
      my_lesson: { Args: { p_enrolment_id: string }; Returns: Json }
      my_lessons: { Args: { p_scope?: string }; Returns: Json }
      my_marketing_notes: {
        Args: { p_limit?: number; p_venue_id?: string }
        Returns: Json
      }
      my_marketing_requests: {
        Args: { p_limit?: number; p_venue_id?: string }
        Returns: Json
      }
      my_match_blocks: { Args: never; Returns: Json }
      my_matches: { Args: { p_scope?: string }; Returns: Json }
      my_order_slips: { Args: { p_venue_id?: string }; Returns: Json }
      my_protocol_work: { Args: { p_venue_id?: string }; Returns: Json }
      my_purchases: {
        Args: { p_limit?: number; p_venue_id?: string }
        Returns: Json
      }
      my_receipts: { Args: { p_venue_id?: string }; Returns: Json }
      my_recipe_changes: {
        Args: { p_limit?: number; p_venue_id?: string }
        Returns: Json
      }
      my_release_ideas: { Args: { p_venue_id?: string }; Returns: Json }
      my_reservations: {
        Args: { p_reservation_id?: string }
        Returns: {
          cancelled_at: string
          cancelled_by: string
          court_id: string
          court_paid_iqd: number
          court_remaining_iqd: number
          end_at: string
          hold_expires_at: string
          id: string
          kind: string
          online_paid_iqd: number
          payment_ref: string
          payment_status: string
          price_iqd: number
          start_at: string
          status: string
          venue_id: string
        }[]
      }
      my_suggestions: {
        Args: { p_limit?: number; p_venue_id?: string }
        Returns: Json
      }
      my_tickets: { Args: never; Returns: Json }
      name_initial: { Args: { p_family: string }; Returns: string }
      normalize_finding: { Args: { p_text: string }; Returns: string }
      notify_staff: {
        Args: {
          p_dedupe?: string
          p_kind: string
          p_payload: Json
          p_staff_ids: string[]
        }
        Returns: number
      }
      open_branch: {
        Args: { p_venue: string }
        Returns: Database["public"]["Tables"]["venues"]["Row"]
        SetofOptions: {
          from: "*"
          to: "venues"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      open_day: {
        Args: {
          p_business_date?: string
          p_device_id?: string
          p_opening_float_iqd: number
          p_venue_id?: string
        }
        Returns: Json
      }
      open_matches: {
        Args: { p_from: string; p_to: string; p_venue_id: string }
        Returns: Json
      }
      open_tab: {
        Args: {
          p_device_id?: string
          p_idempotency_key?: string
          p_kind?: string
          p_label?: string
          p_reservation_id?: string
          p_table_id?: string
        }
        Returns: Json
      }
      open_table_session: { Args: { p_token: string }; Returns: Json }
      open_till_shift: {
        Args: {
          p_device_id: string
          p_idempotency_key?: string
          p_note?: string
          p_opening_float_iqd: number
        }
        Returns: Json
      }
      open_venue_ids: { Args: never; Returns: string[] }
      ops_overview: { Args: never; Returns: Json }
      order_is_callers: { Args: { p_order_id: string }; Returns: boolean }
      order_is_shop: { Args: { p_order_id: string }; Returns: boolean }
      order_item_bom: {
        Args: { p_order_item_id: string }
        Returns: {
          ingredient_id: string
          qty: number
        }[]
      }
      other_active_owners: { Args: { p_staff_id: string }; Returns: number }
      override_price: {
        Args: {
          p_device_id?: string
          p_idempotency_key?: string
          p_new_unit_price_iqd: number
          p_order_item_id: string
          p_pin: string
          p_reason_code: string
        }
        Returns: Json
      }
      panel_headline: {
        Args: { p_compare?: string; p_from: string; p_to: string }
        Returns: Json
      }
      parse_stock_location: {
        Args: {
          p_default: Database["public"]["Enums"]["stock_location"]
          p_value: string
        }
        Returns: Database["public"]["Enums"]["stock_location"]
      }
      phone_canon: { Args: { p_phone: string }; Returns: string }
      phone_digits: { Args: { p_phone: string }; Returns: string }
      pin_delay_floor: { Args: never; Returns: string }
      pin_grant_ttl: { Args: never; Returns: string }
      pin_is_weak: { Args: { p_pin: string }; Returns: boolean }
      pin_pad_to_floor: { Args: { p_started: string }; Returns: undefined }
      place_floor_order: {
        Args: {
          p_idempotency_key?: string
          p_items?: Json
          p_label?: string
          p_tab_id?: string
          p_table_id: string
        }
        Returns: Json
      }
      preview_series: {
        Args: {
          p_court_id: string
          p_duration_min: number
          p_ends_on: string
          p_pattern: string
          p_start_time: string
          p_starts_on: string
          p_weekdays: number[]
        }
        Returns: Json
      }
      price_logged_stock: {
        Args: { p_delivery_id: string; p_lines: Json }
        Returns: Json
      }
      price_promo_addon_renames: {
        Args: { p_value: Json; p_venue: string }
        Returns: Json
      }
      price_promo_addons: {
        Args: { p_value: Json; p_venue: string }
        Returns: Json
      }
      price_promo_apply_due: { Args: never; Returns: Json }
      price_promo_apply_internal: { Args: { p_run_id: string }; Returns: Json }
      price_promo_bool: {
        Args: { p_hint: string; p_required: boolean; p_value: Json }
        Returns: boolean
      }
      price_promo_check_targets: {
        Args: { p_run_id: string }
        Returns: undefined
      }
      price_promo_date: {
        Args: { p_hint: string; p_value: Json }
        Returns: string
      }
      price_promo_instant: {
        Args: { p_hint: string; p_required: boolean; p_value: Json }
        Returns: string
      }
      price_promo_int: {
        Args: {
          p_hint: string
          p_max: number
          p_min: number
          p_required: boolean
          p_value: Json
        }
        Returns: number
      }
      price_promo_line: {
        Args: { p_cap: number; p_hint: string; p_value: Json }
        Returns: Json
      }
      price_promo_new_sizes: { Args: { p_value: Json }; Returns: Json }
      price_promo_numbers: { Args: { p_run_id: string }; Returns: Json }
      price_promo_only_keys: {
        Args: {
          p_allowed: string[]
          p_hint: string
          p_prefix?: string
          p_record: Json
        }
        Returns: undefined
      }
      price_promo_price_map: {
        Args: { p_hint: string; p_value: Json }
        Returns: Json
      }
      price_promo_promotion: {
        Args: { p_own: string; p_value: Json }
        Returns: Json
      }
      price_promo_record: {
        Args: { p_run_id: string; p_step_key: string }
        Returns: Json
      }
      price_promo_rule: {
        Args: { p_value: Json; p_venue: string }
        Returns: Json
      }
      price_promo_size_renames: {
        Args: { p_item: string; p_value: Json }
        Returns: Json
      }
      price_promo_sizes: {
        Args: { p_hint: string; p_item: string; p_min: number; p_value: Json }
        Returns: Json
      }
      price_promo_targets: {
        Args: { p_change: string; p_venue_id?: string }
        Returns: Json
      }
      price_promo_text: {
        Args: {
          p_cap: number
          p_hint: string
          p_required: boolean
          p_value: Json
        }
        Returns: string
      }
      price_promo_time: {
        Args: { p_hint: string; p_required: boolean; p_value: Json }
        Returns: string
      }
      price_promo_uuid: {
        Args: { p_hint: string; p_required: boolean; p_value: Json }
        Returns: string
      }
      price_slot: {
        Args: { p_court_id: string; p_duration_min: number; p_start_at: string }
        Returns: {
          price_iqd: number
          rule_id: string
        }[]
      }
      production_log_today: { Args: { p_venue_id?: string }; Returns: Json }
      production_today: { Args: { p_venue_id?: string }; Returns: Json }
      promotion_amount_iqd: {
        Args: { p_base: number; p_type: string; p_value: number }
        Returns: number
      }
      promotion_base_iqd: {
        Args: { p_scope: Json; p_tab_id: string }
        Returns: number
      }
      propose_deduction: {
        Args: {
          p_amount_iqd: number
          p_date: string
          p_idempotency_key?: string
          p_reason: string
          p_staff_id: string
          p_venue_id?: string
        }
        Returns: Json
      }
      protocol_check_hiring_add_staff: {
        Args: { p_photos: string[]; p_record: Json; p_run_step_id: string }
        Returns: Json
      }
      protocol_check_hiring_interviews: {
        Args: { p_photos: string[]; p_record: Json; p_run_step_id: string }
        Returns: Json
      }
      protocol_check_hiring_open_position: {
        Args: { p_photos: string[]; p_record: Json; p_run_step_id: string }
        Returns: Json
      }
      protocol_check_price_promo_announce: {
        Args: { p_photos: string[]; p_record: Json; p_run_step_id: string }
        Returns: Json
      }
      protocol_check_price_promo_apply: {
        Args: { p_photos: string[]; p_record: Json; p_run_step_id: string }
        Returns: Json
      }
      protocol_check_price_promo_numbers: {
        Args: { p_photos: string[]; p_record: Json; p_run_step_id: string }
        Returns: Json
      }
      protocol_check_price_promo_propose: {
        Args: { p_photos: string[]; p_record: Json; p_run_step_id: string }
        Returns: Json
      }
      protocol_check_product_release_analysis: {
        Args: { p_photos: string[]; p_record: Json; p_run_step_id: string }
        Returns: Json
      }
      protocol_check_product_release_launch: {
        Args: { p_photos: string[]; p_record: Json; p_run_step_id: string }
        Returns: Json
      }
      protocol_check_product_release_marketing: {
        Args: { p_photos: string[]; p_record: Json; p_run_step_id: string }
        Returns: Json
      }
      protocol_check_product_release_propose: {
        Args: { p_photos: string[]; p_record: Json; p_run_step_id: string }
        Returns: Json
      }
      protocol_check_product_release_test: {
        Args: { p_photos: string[]; p_record: Json; p_run_step_id: string }
        Returns: Json
      }
      protocol_check_tournament_courts: {
        Args: { p_photos: string[]; p_record: Json; p_run_step_id: string }
        Returns: Json
      }
      protocol_check_tournament_feasibility: {
        Args: { p_photos: string[]; p_record: Json; p_run_step_id: string }
        Returns: Json
      }
      protocol_check_tournament_marketing: {
        Args: { p_photos: string[]; p_record: Json; p_run_step_id: string }
        Returns: Json
      }
      protocol_check_tournament_plan: {
        Args: { p_photos: string[]; p_record: Json; p_run_step_id: string }
        Returns: Json
      }
      protocol_check_tournament_ready: {
        Args: { p_photos: string[]; p_record: Json; p_run_step_id: string }
        Returns: Json
      }
      protocol_engine_actor: {
        Args: {
          p_actor_roles: Database["public"]["Enums"]["staff_role"][]
          p_assigned_to: string
          p_cover: boolean
          p_venue: string
        }
        Returns: boolean
      }
      protocol_engine_actor_ids: {
        Args: {
          p_actor_roles: Database["public"]["Enums"]["staff_role"][]
          p_assigned_to: string
          p_venue: string
        }
        Returns: string[]
      }
      protocol_engine_can: {
        Args: { p_run_id: string; p_step_id: string }
        Returns: Json
      }
      protocol_engine_decider: {
        Args: {
          p_expected: boolean
          p_needs_owner_ok: boolean
          p_venue: string
        }
        Returns: boolean
      }
      protocol_engine_decider_ids: {
        Args: { p_needs_owner_ok: boolean; p_venue: string }
        Returns: string[]
      }
      protocol_engine_involved: { Args: { p_run_id: string }; Returns: boolean }
      protocol_engine_items: { Args: { p_items: Json }; Returns: Json }
      protocol_engine_notify: {
        Args: {
          p_id: string
          p_ids: string[]
          p_kind: string
          p_route: string
          p_run_id: string
          p_step_id: string
          p_title_key: string
        }
        Returns: number
      }
      protocol_engine_open: { Args: { p_run_id: string }; Returns: string[] }
      protocol_engine_pass: {
        Args: {
          p_decision_data: Json
          p_run_id: string
          p_step_id: string
          p_submission_id: string
        }
        Returns: string[]
      }
      protocol_engine_roles: {
        Args: { p_roles: Json }
        Returns: Database["public"]["Enums"]["staff_role"][]
      }
      protocol_engine_run_row: { Args: { p_run_id: string }; Returns: Json }
      protocol_engine_step_row: {
        Args: { p_full: boolean; p_step_id: string }
        Returns: Json
      }
      protocol_engine_stop_hook: {
        Args: { p_run_id: string }
        Returns: undefined
      }
      protocol_engine_submit: {
        Args: {
          p_photos: string[]
          p_record: Json
          p_run_id: string
          p_step_id: string
        }
        Returns: Json
      }
      protocol_engine_text: {
        Args: { p_cap: number; p_hint: string; p_text: string }
        Returns: string
      }
      protocol_engine_waiting_on_me: {
        Args: { p_run_id: string }
        Returns: boolean
      }
      protocol_finish_price_promo: {
        Args: { p_run_id: string }
        Returns: string
      }
      protocol_finish_product_release: {
        Args: { p_run_id: string }
        Returns: string
      }
      protocol_pass_hiring_add_staff: {
        Args: {
          p_decision_data: Json
          p_run_step_id: string
          p_submission_id: string
        }
        Returns: undefined
      }
      protocol_pass_hiring_interviews: {
        Args: {
          p_decision_data: Json
          p_run_step_id: string
          p_submission_id: string
        }
        Returns: undefined
      }
      protocol_pass_price_promo_apply: {
        Args: {
          p_decision_data: Json
          p_run_step_id: string
          p_submission_id: string
        }
        Returns: undefined
      }
      protocol_pass_product_release_analysis: {
        Args: {
          p_decision_data: Json
          p_run_step_id: string
          p_submission_id: string
        }
        Returns: undefined
      }
      protocol_pass_product_release_launch: {
        Args: {
          p_decision_data: Json
          p_run_step_id: string
          p_submission_id: string
        }
        Returns: undefined
      }
      protocol_pass_product_release_propose: {
        Args: {
          p_decision_data: Json
          p_run_step_id: string
          p_submission_id: string
        }
        Returns: undefined
      }
      protocol_pass_tournament_plan: {
        Args: {
          p_decision_data: Json
          p_run_step_id: string
          p_submission_id: string
        }
        Returns: undefined
      }
      protocol_photo_purge_due: { Args: { p_limit?: number }; Returns: Json }
      protocol_photos_purged: { Args: { p_run_id: string }; Returns: undefined }
      protocol_run_allowed: {
        Args: { p_from: string; p_to: string }
        Returns: boolean
      }
      protocol_run_detail: { Args: { p_run_id: string }; Returns: Json }
      protocol_runs_page: {
        Args: {
          p_filter?: string
          p_kind?: string
          p_limit?: number
          p_offset?: number
          p_venue_id?: string
        }
        Returns: Json
      }
      protocol_seed_venue: { Args: { p_venue: string }; Returns: undefined }
      protocol_start_hiring: {
        Args: { p_data: Json; p_run_id: string }
        Returns: Json
      }
      protocol_start_price_promo: {
        Args: { p_data: Json; p_run_id: string }
        Returns: Json
      }
      protocol_start_product_release: {
        Args: { p_data: Json; p_run_id: string }
        Returns: Json
      }
      protocol_start_tournament: {
        Args: { p_data: Json; p_run_id: string }
        Returns: Json
      }
      protocol_step_allowed: {
        Args: { p_from: string; p_to: string }
        Returns: boolean
      }
      protocol_step_def: {
        Args: { p_kind: string; p_step_key: string; p_variant: string }
        Returns: Json
      }
      protocol_step_defs: {
        Args: { p_kind: string; p_variant: string }
        Returns: Json
      }
      protocol_step_detail: { Args: { p_run_step_id: string }; Returns: Json }
      protocol_stop_hiring: { Args: { p_run_id: string }; Returns: undefined }
      protocol_stop_product_release: {
        Args: { p_run_id: string }
        Returns: undefined
      }
      protocol_stop_tournament: {
        Args: { p_run_id: string }
        Returns: undefined
      }
      protocol_submit_price_promo_propose: {
        Args: { p_submission_id: string }
        Returns: undefined
      }
      protocol_submit_product_release_test: {
        Args: { p_submission_id: string }
        Returns: undefined
      }
      protocol_template_detail: {
        Args: { p_template_id: string }
        Returns: Json
      }
      protocol_tick_nudge: { Args: never; Returns: undefined }
      protocols_overview: { Args: { p_venue_id?: string }; Returns: Json }
      protocols_waiting_count: { Args: { p_venue_id?: string }; Returns: Json }
      purchases_to_receive: { Args: { p_venue_id?: string }; Returns: Json }
      push_nudge: { Args: never; Returns: undefined }
      raise_waiter_call: {
        Args: { p_reason: Database["public"]["Enums"]["waiter_call_reason"] }
        Returns: Json
      }
      readable_venue_ids: { Args: never; Returns: string[] }
      reason_given: { Args: { p_reason: string }; Returns: boolean }
      receipt_begin_reading: {
        Args: { p_id: string; p_requested_by?: string }
        Returns: Json
      }
      receipt_detail: { Args: { p_id: string }; Returns: Json }
      receipt_fail_reading: {
        Args: {
          p_code: string
          p_id: string
          p_status?: string
          p_token?: string
        }
        Returns: undefined
      }
      receipt_store_reading: {
        Args: {
          p_id: string
          p_model: string
          p_reading: Json
          p_token?: string
        }
        Returns: Json
      }
      receipts_to_review: { Args: { p_venue_id?: string }; Returns: Json }
      receive_delivery: {
        Args: {
          p_device_id?: string
          p_idempotency_key?: string
          p_lines: Json
          p_location?: string
          p_notes?: string
          p_supplier_id?: string
          p_supplier_name?: string
        }
        Returns: Json
      }
      receive_delivery_internal: {
        Args: {
          p_device_id: string
          p_lines: Json
          p_location: Database["public"]["Enums"]["stock_location"]
          p_notes: string
          p_source: string
          p_supplier_id: string
          p_supplier_name: string
          p_venue: string
        }
        Returns: Json
      }
      receive_purchase: {
        Args: {
          p_idempotency_key?: string
          p_lines: Json
          p_location?: string
          p_purchase_id: string
          p_supplier_id?: string
          p_supplier_name?: string
        }
        Returns: Json
      }
      recipe_changes_page: {
        Args: {
          p_filter?: string
          p_limit?: number
          p_offset?: number
          p_venue_id?: string
        }
        Returns: Json
      }
      recipe_view: {
        Args: { p_menu_item_id?: string; p_venue_id?: string }
        Returns: Json
      }
      record_attendance: {
        Args: {
          p_date: string
          p_early_leave_minutes: number
          p_late_minutes: number
          p_note?: string
          p_staff_id: string
          p_venue_id?: string
        }
        Returns: Json
      }
      record_batch: {
        Args: {
          p_expiry_date?: string
          p_idempotency_key?: string
          p_ingredient_id: string
          p_qty: number
          p_venue_id?: string
        }
        Returns: Json
      }
      record_drawer_open: {
        Args: { p_device_id?: string; p_reason_code: string; p_tab_id?: string }
        Returns: undefined
      }
      record_production: {
        Args: {
          p_device_id?: string
          p_expiry_date?: string
          p_ingredient_id: string
          p_location?: string
          p_qty: number
        }
        Returns: Json
      }
      record_production_internal: {
        Args: {
          p_device_id: string
          p_expiry_date: string
          p_ingredient_id: string
          p_location?: Database["public"]["Enums"]["stock_location"]
          p_qty: number
        }
        Returns: Json
      }
      record_purchase: {
        Args: {
          p_bought_at?: string
          p_idempotency_key?: string
          p_lines: Json
          p_receipt_path: string
          p_shop: string
          p_total_iqd: number
          p_venue_id: string
        }
        Returns: Json
      }
      record_waste: {
        Args: {
          p_device_id?: string
          p_idempotency_key?: string
          p_ingredient_id: string
          p_location?: string
          p_movement_type?: Database["public"]["Enums"]["movement_type"]
          p_qty: number
          p_reason_code?: string
        }
        Returns: undefined
      }
      redact_incident: { Args: { p_id: string }; Returns: Json }
      refund: {
        Args: {
          p_amount_iqd: number
          p_device_id?: string
          p_idempotency_key?: string
          p_items?: Json
          p_payment_id: string
          p_pin: string
          p_reason_code: string
        }
        Returns: Json
      }
      register_staff: {
        Args: {
          p_actor_id: string
          p_display_name: string
          p_role: Database["public"]["Enums"]["staff_role"]
          p_staff_id: string
          p_venue_id?: string
        }
        Returns: Json
      }
      register_station: {
        Args: { p_id: string; p_mode: string; p_venue_id: string }
        Returns: Database["public"]["Tables"]["stations"]["Row"]
        SetofOptions: {
          from: "*"
          to: "stations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      reject_insight: {
        Args: { p_reason?: string; p_text: string }
        Returns: string
      }
      reject_order_slip: {
        Args: { p_id: string; p_reason?: string }
        Returns: undefined
      }
      reject_receipt: {
        Args: { p_id: string; p_reason?: string }
        Returns: undefined
      }
      release_cost: { Args: { p_run_id: string }; Returns: Json }
      release_due_launches: { Args: { p_limit?: number }; Returns: Json }
      release_due_reviews: { Args: { p_limit?: number }; Returns: Json }
      release_hold: { Args: { p_reservation_id: string }; Returns: Json }
      release_idea_reviewer_ids: {
        Args: { p_team: string; p_venue: string }
        Returns: string[]
      }
      release_ideas_to_review: { Args: { p_venue_id?: string }; Returns: Json }
      release_int: {
        Args: { p_hint: string; p_max: number; p_min: number; p_value: Json }
        Returns: number
      }
      release_launch_internal: {
        Args: { p_menu_photo_path: string; p_run_id: string }
        Returns: undefined
      }
      release_launch_record: { Args: { p_run_id: string }; Returns: Json }
      release_launch_scheduled: {
        Args: { p_menu_photo_path: string; p_run_id: string }
        Returns: string
      }
      release_line: {
        Args: { p_cap: number; p_hint: string; p_value: Json }
        Returns: Json
      }
      release_menu_photo_path: {
        Args: { p_photo_path: string; p_run_id: string }
        Returns: string
      }
      release_notes_for_item: {
        Args: { p_menu_item_id: string }
        Returns: Json
      }
      release_notes_for_me: { Args: { p_venue_id?: string }; Returns: Json }
      release_only_keys: {
        Args: { p_allowed: string[]; p_hint: string; p_record: Json }
        Returns: undefined
      }
      release_propose_check: {
        Args: { p_category: string; p_record: Json; p_venue: string }
        Returns: Json
      }
      release_readiness: { Args: { p_run_id: string }; Returns: Json }
      release_readiness_internal: { Args: { p_run_id: string }; Returns: Json }
      release_review: { Args: { p_run_id: string }; Returns: Json }
      release_review_input: { Args: { p_run_id: string }; Returns: Json }
      release_review_nudge: { Args: never; Returns: undefined }
      release_review_save: {
        Args: {
          p_model: string
          p_numbers: Json
          p_run_id: string
          p_status: string
          p_write_up: Json
        }
        Returns: Json
      }
      release_run_photos: { Args: { p_run_id: string }; Returns: string[] }
      release_test_context: { Args: { p_run_id: string }; Returns: Json }
      release_text: {
        Args: {
          p_cap: number
          p_hint: string
          p_required: boolean
          p_value: Json
        }
        Returns: string
      }
      release_uuid: {
        Args: { p_hint: string; p_required: boolean; p_value: Json }
        Returns: string
      }
      rename_staff: {
        Args: { p_display_name: string; p_staff_id: string }
        Returns: Json
      }
      reorder_courts: { Args: { p_ids: string[] }; Returns: number }
      reorder_menu_categories: { Args: { p_ids: string[] }; Returns: number }
      reorder_menu_items: { Args: { p_ids: string[] }; Returns: number }
      reorder_modifiers: { Args: { p_ids: string[] }; Returns: number }
      report_cafe: {
        Args: { p_filters?: Json; p_from: string; p_to: string }
        Returns: Json
      }
      report_coach_statements: { Args: { p_month?: string }; Returns: Json }
      report_compare: {
        Args: {
          p_compare: string
          p_filters?: Json
          p_from: string
          p_group?: string
          p_report: string
          p_to: string
        }
        Returns: Json
      }
      report_courts: {
        Args: { p_filters?: Json; p_from: string; p_to: string }
        Returns: Json
      }
      report_drill: {
        Args: { p_figure: string; p_from: string; p_key: string; p_to: string }
        Returns: Json
      }
      report_lessons: { Args: { p_from: string; p_to: string }; Returns: Json }
      report_matches: {
        Args: { p_filters?: Json; p_from: string; p_to: string }
        Returns: Json
      }
      report_revenue: {
        Args: {
          p_filters?: Json
          p_from: string
          p_group?: string
          p_to: string
        }
        Returns: Json
      }
      report_staff_activity: {
        Args: { p_from: string; p_staff_id?: string; p_to: string }
        Returns: Json
      }
      report_stock: {
        Args: { p_filters?: Json; p_from: string; p_to: string }
        Returns: Json
      }
      report_venues: { Args: never; Returns: string[] }
      reports_available_minutes: {
        Args: { p_from: string; p_to: string }
        Returns: number
      }
      reports_bucket: {
        Args: { p_d: string; p_group: string }
        Returns: string
      }
      reports_figures: { Args: { p_from: string; p_to: string }; Returns: Json }
      reports_guard: { Args: { p_owner_only?: boolean }; Returns: undefined }
      reports_parse_scope: {
        Args: { p_text: string }
        Returns: Record<string, unknown>
      }
      req_header: { Args: { p_name: string }; Returns: string }
      request_recipe_change: {
        Args: {
          p_idempotency_key?: string
          p_note?: string
          p_ops: Json
          p_target: string
          p_target_id: string
          p_venue_id?: string
        }
        Returns: Json
      }
      resolve_match_report: {
        Args: { p_outcome: string; p_report_id: string }
        Returns: Json
      }
      resolve_venue: { Args: { p_station_id?: string }; Returns: string }
      resolve_waiter_call: { Args: { p_call_id: string }; Returns: Json }
      retire_device: { Args: { p_device_id: string }; Returns: Json }
      retire_station: {
        Args: { p_id: string }
        Returns: Database["public"]["Tables"]["stations"]["Row"]
        SetofOptions: {
          from: "*"
          to: "stations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      retry_telegram_outbox: { Args: { p_id: number }; Returns: undefined }
      review_incident: { Args: { p_id: string; p_note: string }; Returns: Json }
      revise_content: {
        Args: {
          p_body: string
          p_channel?: string
          p_id: string
          p_idempotency_key?: string
          p_images?: string[]
          p_media_link?: string
          p_note?: string
          p_planned_for?: string
          p_title?: string
        }
        Returns: Json
      }
      revoke_user_sessions: { Args: { p_user_id: string }; Returns: number }
      rotate_table_token: { Args: { p_table_id: string }; Returns: number }
      rotate_table_token_secret: { Args: never; Returns: Json }
      row_venue: { Args: { p_id: string; p_table: string }; Returns: string }
      safe_line: { Args: { p_text: string }; Returns: string }
      safe_text: { Args: { p_text: string }; Returns: string }
      save_analytics_insights: {
        Args: {
          p_compare_basis: string
          p_court_id?: string
          p_insights: Json
          p_locale: string
          p_range_from: string
          p_range_to: string
          p_scope?: string
        }
        Returns: string
      }
      save_analytics_patterns: {
        Args: {
          p_court_id?: string
          p_locale: string
          p_patterns: Json
          p_range_from: string
          p_range_to: string
          p_scope?: string
        }
        Returns: string
      }
      save_checklist_template: {
        Args: {
          p_expected_version: number
          p_items: Json
          p_name_ar: string
          p_name_en: string
          p_role: Database["public"]["Enums"]["staff_role"]
          p_slot: string
          p_venue_id: string
        }
        Returns: Json
      }
      save_hiring_candidate: {
        Args: {
          p_candidate: Json
          p_id?: string
          p_idempotency_key?: string
          p_run_id: string
        }
        Returns: Json
      }
      save_marketing_audience: {
        Args: {
          p_id: string
          p_name_ar: string
          p_name_en: string
          p_rule?: Json
        }
        Returns: string
      }
      save_marketing_campaign: {
        Args: {
          p_audience_id?: string
          p_body_ar?: string
          p_body_en?: string
          p_channel: string
          p_ends_at?: string
          p_id: string
          p_name_ar: string
          p_name_en: string
          p_promotion_id?: string
          p_starts_at?: string
        }
        Returns: string
      }
      save_protocol_template: {
        Args: {
          p_expected_version: number
          p_name_ar: string
          p_name_en: string
          p_steps: Json
          p_template_id: string
        }
        Returns: Json
      }
      save_teaching: {
        Args: {
          p_body: string
          p_id?: string
          p_idempotency_key?: string
          p_photos?: string[]
          p_team?: string
          p_title: string
          p_venue_id?: string
        }
        Returns: Json
      }
      scan_date: { Args: { p: string }; Returns: string }
      scan_num: { Args: { p: Json }; Returns: number }
      scan_photos_expired: { Args: { p_limit?: number }; Returns: string[] }
      scan_sweep_stale: { Args: never; Returns: number }
      scan_take_reading: {
        Args: {
          p_kind: string
          p_paper: string
          p_requested_by: string
          p_venue: string
        }
        Returns: string
      }
      search_norm: { Args: { p_text: string }; Returns: string }
      secret: { Args: { p_name: string }; Returns: string }
      send_order_slip: {
        Args: {
          p_device_id?: string
          p_id: string
          p_idempotency_key?: string
          p_items: Json
          p_tab_id?: string
          p_table_id?: string
        }
        Returns: Json
      }
      send_test_push: { Args: never; Returns: Json }
      series_detail: { Args: { p_series_id: string }; Returns: Json }
      series_occurrences: {
        Args: {
          p_duration_min: number
          p_ends_on: string
          p_pattern: string
          p_start_time: string
          p_starts_on: string
          p_venue?: string
          p_weekdays: number[]
        }
        Returns: {
          end_at: string
          occ_date: string
          start_at: string
        }[]
      }
      series_slot_conflict: {
        Args: { p_court_id: string; p_end_at: string; p_start_at: string }
        Returns: {
          kind: Database["public"]["Enums"]["reservation_kind"]
          reservation_id: string
        }[]
      }
      set_addon_suggestions: {
        Args: { p_item_id: string; p_suggested_item_ids: string[] }
        Returns: undefined
      }
      set_batch_yield: {
        Args: { p_batch_yield?: number; p_ingredient_id: string }
        Returns: Json
      }
      set_cafe_setting: {
        Args: { p_key: string; p_value: Json; p_venue_id?: string }
        Returns: Json
      }
      set_cafe_setting_internal: {
        Args: { p_key: string; p_value: Json; p_venue?: string }
        Returns: Json
      }
      set_cafe_settings: {
        Args: { p_settings: Json; p_venue_id?: string }
        Returns: Json
      }
      set_campaign_status: {
        Args: { p_id: string; p_status: string }
        Returns: Json
      }
      set_category_kind: {
        Args: { p_id: string; p_kind: string }
        Returns: undefined
      }
      set_category_photo: {
        Args: {
          p_category_id: string
          p_photo_blur?: string
          p_photo_path: string
        }
        Returns: undefined
      }
      set_coach_branches: {
        Args: { p_coach_id: string; p_venue_ids: string[] }
        Returns: Json
      }
      set_coach_hours: {
        Args: { p_coach_id: string; p_venue_id: string; p_windows: Json }
        Returns: Json
      }
      set_coach_lesson_types: {
        Args: {
          p_coach_id: string
          p_lesson_type_ids: string[]
          p_venue_id: string
        }
        Returns: Json
      }
      set_coach_price: {
        Args: {
          p_coach_id: string
          p_lesson_type_id: string
          p_price_iqd: number
        }
        Returns: Json
      }
      set_coach_price_internal: {
        Args: {
          p_coach_id: string
          p_lesson_type_id: string
          p_price_iqd: number
          p_run_id: string
        }
        Returns: undefined
      }
      set_coach_status: {
        Args: { p_coach_id: string; p_reason: string; p_status: string }
        Returns: Json
      }
      set_coaching_settings: {
        Args: { p_patch: Json; p_venue_id: string }
        Returns: Json
      }
      set_customer_flags: {
        Args: { p_customer_id: string; p_flags: Json }
        Returns: Json
      }
      set_deposit_settings: {
        Args: { p_patch: Json; p_venue_id?: string }
        Returns: Json
      }
      set_item_availability: {
        Args: { p_available: boolean; p_item_id: string }
        Returns: undefined
      }
      set_item_cost: {
        Args: { p_cost_iqd: number; p_item_id: string }
        Returns: undefined
      }
      set_item_photo: {
        Args: { p_item_id: string; p_photo_blur?: string; p_photo_path: string }
        Returns: undefined
      }
      set_item_sold_out: {
        Args: { p_item_id: string; p_sold_out: boolean }
        Returns: undefined
      }
      set_match_ban: {
        Args: { p_banned: boolean; p_customer_id: string; p_reason: string }
        Returns: Json
      }
      set_match_settings: {
        Args: { p_patch: Json; p_venue_id?: string }
        Returns: Json
      }
      set_modifier_reveals: {
        Args: { p_group_ids: string[]; p_modifier_id: string }
        Returns: undefined
      }
      set_my_coach_hours: {
        Args: { p_venue_id: string; p_windows: Json }
        Returns: Json
      }
      set_my_gender: { Args: { p_gender: string }; Returns: Json }
      set_opening_hours: {
        Args: {
          p_closed_dates?: string[]
          p_opening_hours?: Json
          p_venue_id?: string
        }
        Returns: undefined
      }
      set_order_item_ready: {
        Args: {
          p_device_id?: string
          p_order_item_id: string
          p_ready: boolean
        }
        Returns: Json
      }
      set_promotion_enabled: {
        Args: { p_enabled: boolean; p_id: string }
        Returns: Json
      }
      set_promotion_enabled_internal: {
        Args: { p_enabled: boolean; p_id: string }
        Returns: Json
      }
      set_promotion_venue: {
        Args: { p_promotion_id: string; p_venue_id: string }
        Returns: Database["public"]["Tables"]["promotions"]["Row"]
        SetofOptions: {
          from: "*"
          to: "promotions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_recipe: {
        Args: { p_lines?: Json; p_target: string; p_target_id: string }
        Returns: number
      }
      set_secret_value: {
        Args: { p_name: string; p_value: string }
        Returns: undefined
      }
      set_staff_active: {
        Args: { p_active: boolean; p_reason_code?: string; p_staff_id: string }
        Returns: Json
      }
      set_staff_pin: {
        Args: { p_pin: string; p_staff_id: string }
        Returns: undefined
      }
      set_staff_role: {
        Args: {
          p_reason_code?: string
          p_role: Database["public"]["Enums"]["staff_role"]
          p_staff_id: string
        }
        Returns: Json
      }
      set_staff_venues: {
        Args: { p_staff_id: string; p_venue_ids: string[] }
        Returns: Json
      }
      set_staff_wage: {
        Args: {
          p_from_month?: string
          p_pay_day: number
          p_salary_iqd: number
          p_staff_id: string
          p_venue_id?: string
        }
        Returns: Json
      }
      set_station_staff: {
        Args: { p_staff_id: string; p_station_ids: string[] }
        Returns: Json
      }
      set_table_bell: {
        Args: { p_enabled: boolean; p_table_id: string }
        Returns: undefined
      }
      set_telegram_staff: {
        Args: {
          p_can_void?: boolean
          p_device_id?: string
          p_is_active?: boolean
          p_label?: string
          p_staff_id: string
          p_tg_user_id: number
        }
        Returns: Json
      }
      set_ticket_status: {
        Args: {
          p_device_id?: string
          p_status: Database["public"]["Enums"]["ticket_status"]
          p_ticket_id: string
        }
        Returns: Json
      }
      set_venue_details: {
        Args: { p_patch: Json; p_venue_id?: string }
        Returns: Json
      }
      set_waiter_call_cooldown: {
        Args: { p_seconds: number; p_venue_id?: string }
        Returns: undefined
      }
      settle_tab: {
        Args: {
          p_amount_iqd?: number
          p_device_id?: string
          p_expected_total_iqd?: number
          p_idempotency_key?: string
          p_method: Database["public"]["Enums"]["payment_method"]
          p_tab_id: string
          p_tendered_iqd?: number
        }
        Returns: Json
      }
      settle_zero_tab: {
        Args: {
          p_device_id?: string
          p_idempotency_key?: string
          p_reason_code: string
          p_tab_id: string
        }
        Returns: Json
      }
      shopping_list: {
        Args: { p_status?: string; p_venue_id?: string }
        Returns: Json
      }
      skip_step: {
        Args: { p_note: string; p_run_step_id: string }
        Returns: Json
      }
      slip_begin_reading: {
        Args: { p_id: string; p_requested_by?: string }
        Returns: Json
      }
      slip_detail: { Args: { p_id: string }; Returns: Json }
      slip_fail_reading: {
        Args: {
          p_code: string
          p_id: string
          p_status?: string
          p_token?: string
        }
        Returns: undefined
      }
      slip_store_reading: {
        Args: {
          p_id: string
          p_model: string
          p_reading: Json
          p_token?: string
        }
        Returns: Json
      }
      slips_to_send: { Args: { p_venue_id?: string }; Returns: Json }
      sms_send_gate: {
        Args: { p_phone_e164: string; p_purpose?: string; p_user_id?: string }
        Returns: Json
      }
      sms_send_result: {
        Args: {
          p_channel?: string
          p_cost_iqd?: number
          p_error?: string
          p_provider?: string
          p_provider_msg_id?: string
          p_send_id: number
          p_status: string
        }
        Returns: undefined
      }
      split_by_item: {
        Args: { p_groups: Json; p_tab_id: string }
        Returns: number[]
      }
      split_evenly: {
        Args: { p_n: number; p_tab_id: string }
        Returns: number[]
      }
      split_person_name: { Args: { p: string }; Returns: string[] }
      staff_create_reservation: {
        Args: {
          p_client_ref?: string
          p_court_id: string
          p_device_id?: string
          p_end_at: string
          p_guest_id?: string
          p_guest_name?: string
          p_guest_phone?: string
          p_idempotency_key?: string
          p_kind: Database["public"]["Enums"]["reservation_kind"]
          p_notes?: string
          p_players?: number
          p_price_override_iqd?: number
          p_start_at: string
        }
        Returns: Json
      }
      staff_home_location: {
        Args: { p_role: Database["public"]["Enums"]["staff_role"] }
        Returns: Database["public"]["Enums"]["stock_location"]
      }
      staff_ids_with_roles: {
        Args: {
          p_roles: Database["public"]["Enums"]["staff_role"][]
          p_venue: string
        }
        Returns: string[]
      }
      staff_ingredient_options: {
        Args: { p_query?: string; p_venue_id?: string }
        Returns: Json
      }
      staff_media_folder: { Args: { p_name: string }; Returns: string }
      staff_media_is_evidence: { Args: { p_name: string }; Returns: boolean }
      staff_media_orphan_purge_due: {
        Args: { p_limit?: number }
        Returns: Json
      }
      staff_media_orphans_purged: {
        Args: { p_paths: string[] }
        Returns: number
      }
      staff_media_slot: {
        Args: { p_ext: string; p_folder: string; p_venue_id: string }
        Returns: Json
      }
      staff_media_venue: { Args: { p_name: string }; Returns: string }
      staff_media_visible: { Args: { p_name: string }; Returns: boolean }
      staff_memberships: { Args: { p_staff_id: string }; Returns: string[] }
      staff_requests_page: {
        Args: { p_limit?: number; p_offset?: number; p_status?: string }
        Returns: Json
      }
      staff_role: {
        Args: never
        Returns: Database["public"]["Enums"]["staff_role"]
      }
      staff_set_customer_gender: {
        Args: { p_customer_id: string; p_gender: string }
        Returns: Json
      }
      staff_stock_view: {
        Args: { p_kind?: string; p_venue_id?: string }
        Returns: Json
      }
      staff_team: {
        Args: { p_role: Database["public"]["Enums"]["staff_role"] }
        Returns: string
      }
      staff_team_head: {
        Args: { p_team: string }
        Returns: Database["public"]["Enums"]["staff_role"]
      }
      staff_venue_ids: { Args: never; Returns: string[] }
      start_break: {
        Args: { p_device_id: string; p_pin: string }
        Returns: Json
      }
      start_count: {
        Args: { p_location?: string; p_venue_id?: string }
        Returns: Json
      }
      start_protocol: {
        Args: {
          p_data?: Json
          p_first_record?: Json
          p_idempotency_key?: string
          p_kind: string
          p_photos?: string[]
          p_title_ar?: string
          p_title_en?: string
          p_variant?: string
          p_venue_id?: string
        }
        Returns: Json
      }
      stock_cost_estimate: {
        Args: { p_ingredient: string }
        Returns: Record<string, unknown>
      }
      stock_pick_list: {
        Args: {
          p_location?: string
          p_purpose: string
          p_query?: string
          p_venue_id?: string
        }
        Returns: Json
      }
      stock_today: { Args: { p_venue_id?: string }; Returns: Json }
      stop_protocol: {
        Args: { p_note: string; p_run_id: string }
        Returns: Json
      }
      storage_path_in_use: { Args: { p_path: string }; Returns: boolean }
      submit_content: {
        Args: {
          p_body: string
          p_campaign_id?: string
          p_channel: string
          p_idempotency_key?: string
          p_images?: string[]
          p_media_link?: string
          p_menu_item_id?: string
          p_note?: string
          p_planned_for: string
          p_title: string
          p_venue_id?: string
        }
        Returns: Json
      }
      submit_incident: {
        Args: {
          p_court_id?: string
          p_description: string
          p_idempotency_key?: string
          p_kind: string
          p_occurred_at: string
          p_people_involved?: string
          p_photos?: string[]
          p_place: string
          p_place_detail?: string
          p_venue_id?: string
        }
        Returns: Json
      }
      submit_release_idea: {
        Args: {
          p_idempotency_key?: string
          p_photos?: string[]
          p_record: Json
          p_venue_id?: string
        }
        Returns: Json
      }
      submit_staff_request: {
        Args: {
          p_amount_iqd?: number
          p_from?: string
          p_kind: string
          p_note?: string
          p_to?: string
        }
        Returns: string
      }
      submit_step: {
        Args: {
          p_idempotency_key?: string
          p_photos?: string[]
          p_record: Json
          p_run_step_id: string
        }
        Returns: Json
      }
      submit_stock_count: {
        Args: {
          p_idempotency_key?: string
          p_lines?: Json
          p_location?: string
          p_venue_id?: string
        }
        Returns: Json
      }
      suggest_campaign: {
        Args: {
          p_body_ar?: string
          p_body_en?: string
          p_channel?: string
          p_ends_at?: string
          p_id?: string
          p_idempotency_key?: string
          p_images?: string[]
          p_menu_item_id?: string
          p_name_ar?: string
          p_name_en?: string
          p_note?: string
          p_run_id?: string
          p_starts_at?: string
          p_venue_id?: string
        }
        Returns: Json
      }
      suggestions_page: {
        Args: {
          p_filter?: string
          p_limit?: number
          p_offset?: number
          p_venue_id?: string
        }
        Returns: Json
      }
      sweep_degraded_period: { Args: { p_venue: string }; Returns: undefined }
      sweep_degraded_periods: { Args: never; Returns: undefined }
      tab_is_callers: { Args: { p_tab_id: string }; Returns: boolean }
      tab_net_paid: { Args: { p_tab_id: string }; Returns: number }
      table_branch: { Args: { p_token: string }; Returns: string }
      table_qr_tokens: { Args: never; Returns: Json }
      table_token_secret: { Args: never; Returns: string }
      table_token_secret_prev: { Args: never; Returns: string }
      teachings_for_me: {
        Args: {
          p_limit?: number
          p_offset?: number
          p_team?: string
          p_venue_id?: string
        }
        Returns: Json
      }
      telegram_apply_action: {
        Args: {
          p_action: string
          p_actor: Json
          p_chat_id?: string
          p_ref_id: string
        }
        Returns: Json
      }
      telegram_call_payload: { Args: { p_call_id: string }; Returns: Json }
      telegram_nudge: { Args: never; Returns: undefined }
      telegram_order_payload: { Args: { p_order_id: string }; Returns: Json }
      telegram_send_test: { Args: { p_venue_id?: string }; Returns: Json }
      text_control_class: { Args: never; Returns: string }
      text_control_class_multiline: { Args: never; Returns: string }
      tick_run_item: {
        Args: { p_done: boolean; p_item_id: string }
        Returns: Json
      }
      ticket_cashout: {
        Args: { p_customer_id: string; p_purchase_payment_id: string }
        Returns: Json
      }
      ticket_cashout_block: { Args: { p_payment_id: string }; Returns: Json }
      ticket_forfeit: {
        Args: { p_seat_id: string; p_ticket_id: string }
        Returns: boolean
      }
      ticket_lock: {
        Args: {
          p_request_id?: string
          p_seat_ids?: string[]
          p_ticket_ids: string[]
        }
        Returns: number
      }
      ticket_money_figures: {
        Args: { p_ts_from: string; p_ts_to: string; p_venues: string[] }
        Returns: Json
      }
      ticket_payment_prepare: {
        Args: {
          p_count: number
          p_guest_id: string
          p_locale: string
          p_provider: string
        }
        Returns: Json
      }
      ticket_pick: {
        Args: {
          p_count: number
          p_guest_id: string
          p_request_id?: string
          p_sandbox: boolean
        }
        Returns: string[]
      }
      ticket_refund_deleted: { Args: { p_guest_id?: string }; Returns: number }
      ticket_release: {
        Args: {
          p_code: string
          p_request_id?: string
          p_seat_ids?: string[]
          p_ticket_ids: string[]
        }
        Returns: number
      }
      ticket_restore: {
        Args: { p_relock?: boolean; p_seat_id: string; p_ticket_id: string }
        Returns: boolean
      }
      ticket_settle_success: { Args: { p_payment_id: string }; Returns: string }
      ticket_transition: {
        Args: {
          p_actor_label?: string
          p_device_id: string
          p_status: Database["public"]["Enums"]["ticket_status"]
          p_ticket_id: string
        }
        Returns: Json
      }
      ticket_wallet: {
        Args: { p_guest_id: string; p_staff: boolean }
        Returns: Json
      }
      tickets_cash_out: {
        Args: { p_payment_id: string; p_reason: string; p_staff_id: string }
        Returns: Json
      }
      till_add_items: {
        Args: {
          p_device_id?: string
          p_idempotency_key?: string
          p_items: Json
          p_tab_id: string
        }
        Returns: Json
      }
      till_shift_figures: { Args: { p_shift_id: string }; Returns: Json }
      till_shift_list: {
        Args: {
          p_from?: string
          p_staff_id?: string
          p_station_id?: string
          p_to?: string
          p_venue_id?: string
        }
        Returns: Json
      }
      till_shift_station: {
        Args: { p_device_id: string; p_write: boolean }
        Returns: Database["public"]["Tables"]["stations"]["Row"]
        SetofOptions: {
          from: "*"
          to: "stations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      till_shift_status: { Args: { p_device_id: string }; Returns: Json }
      touch_guest_session: {
        Args: never
        Returns: Database["public"]["Tables"]["guest_sessions"]["Row"]
        SetofOptions: {
          from: "*"
          to: "guest_sessions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      tournament_context: { Args: { p_run_step_id: string }; Returns: Json }
      tournament_feasibility: { Args: { p_run_id: string }; Returns: Json }
      tournament_int: {
        Args: {
          p_hint: string
          p_max: number
          p_min: number
          p_required: boolean
          p_value: Json
        }
        Returns: number
      }
      tournament_line: {
        Args: { p_cap: number; p_hint: string; p_value: Json }
        Returns: Json
      }
      tournament_only_keys: {
        Args: { p_allowed: string[]; p_hint: string; p_record: Json }
        Returns: undefined
      }
      tournament_plan_has_window: {
        Args: { p_court_id: string; p_from: string; p_plan: Json; p_to: string }
        Returns: boolean
      }
      tournament_text: {
        Args: {
          p_cap: number
          p_hint: string
          p_required: boolean
          p_value: Json
        }
        Returns: string
      }
      transfer_stock: {
        Args: {
          p_from: string
          p_idempotency_key?: string
          p_lines: Json
          p_to: string
          p_venue_id?: string
        }
        Returns: Json
      }
      try_lock_coach: { Args: { p_coach_id: string }; Returns: boolean }
      try_lock_match_venue: {
        Args: { p_courts?: boolean; p_venue: string }
        Returns: boolean
      }
      undo_wage_paid: {
        Args: { p_id: string; p_reason: string }
        Returns: Json
      }
      unpaid_played_bookings: {
        Args: { p_day_session_id?: string }
        Returns: Json
      }
      unreject_insight: { Args: { p_id: string }; Returns: undefined }
      upsert_cafe_table: {
        Args: {
          p_capacity?: number
          p_id?: string
          p_is_active?: boolean
          p_table_number: string
          p_zone?: string
        }
        Returns: string
      }
      upsert_court: {
        Args: {
          p_active_from?: string
          p_active_to?: string
          p_description_ar?: string
          p_description_en?: string
          p_duration_options?: number[]
          p_id?: string
          p_indoor: boolean
          p_is_active?: boolean
          p_name_ar: string
          p_name_en: string
          p_photo_path?: string
          p_sort_order?: number
        }
        Returns: string
      }
      upsert_ingredient: {
        Args: {
          p_id?: string
          p_is_active?: boolean
          p_kind?: Database["public"]["Enums"]["ingredient_kind"]
          p_low_stock_threshold?: number
          p_name_ar: string
          p_name_en: string
          p_pack_cost_iqd?: number
          p_pack_size?: number
          p_par_level?: number
          p_shelf_life_days?: number
          p_supplier_name?: string
          p_unit: Database["public"]["Enums"]["stock_unit"]
          p_waste_allowance_percent?: number
          p_yield_percent?: number
        }
        Returns: string
      }
      upsert_lesson_type: {
        Args: { p_id: string; p_patch: Json; p_venue_id: string }
        Returns: Json
      }
      upsert_lesson_type_internal: {
        Args: { p_id: string; p_patch: Json; p_venue: string }
        Returns: Database["public"]["Tables"]["lesson_types"]["Row"]
        SetofOptions: {
          from: "*"
          to: "lesson_types"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      upsert_menu_category: {
        Args: {
          p_id?: string
          p_is_active?: boolean
          p_name_ar: string
          p_name_en: string
          p_serve_temp?: string
          p_sort_order?: number
          p_tax_group_id: string
        }
        Returns: string
      }
      upsert_menu_item: {
        Args: {
          p_category_id: string
          p_description_ar?: string
          p_description_en?: string
          p_highlight?: string
          p_hook_ar?: string
          p_hook_en?: string
          p_id?: string
          p_is_active?: boolean
          p_name_ar: string
          p_name_en: string
          p_serve_temp?: string
          p_sort_order?: number
        }
        Returns: string
      }
      upsert_menu_item_internal: {
        Args: {
          p_category_id: string
          p_description_ar?: string
          p_description_en?: string
          p_highlight?: string
          p_hook_ar?: string
          p_hook_en?: string
          p_id?: string
          p_is_active?: boolean
          p_name_ar: string
          p_name_en: string
          p_serve_temp?: string
          p_sort_order?: number
        }
        Returns: string
      }
      upsert_modifier: {
        Args: {
          p_group_id: string
          p_id?: string
          p_is_active?: boolean
          p_name_ar: string
          p_name_en: string
          p_price_delta_iqd?: number
          p_sort_order?: number
        }
        Returns: string
      }
      upsert_modifier_group: {
        Args: {
          p_id?: string
          p_max_select?: number
          p_min_select?: number
          p_name_ar: string
          p_name_en: string
        }
        Returns: string
      }
      upsert_modifier_internal: {
        Args: {
          p_group_id: string
          p_id?: string
          p_is_active?: boolean
          p_name_ar: string
          p_name_en: string
          p_price_delta_iqd?: number
          p_sort_order?: number
        }
        Returns: string
      }
      upsert_promotion: {
        Args: {
          p_auto?: boolean
          p_code_single_use?: boolean
          p_enabled?: boolean
          p_ends_at?: string
          p_hour_from?: string
          p_hour_to?: string
          p_id?: string
          p_limits?: Json
          p_name_ar?: string
          p_name_en?: string
          p_public_code?: string
          p_scope?: Json
          p_starts_at?: string
          p_type?: string
          p_value?: number
          p_weekdays?: number[]
        }
        Returns: string
      }
      upsert_promotion_internal: {
        Args: {
          p_auto?: boolean
          p_code_single_use?: boolean
          p_enabled?: boolean
          p_ends_at?: string
          p_hour_from?: string
          p_hour_to?: string
          p_id?: string
          p_limits?: Json
          p_name_ar?: string
          p_name_en?: string
          p_public_code?: string
          p_scope?: Json
          p_starts_at?: string
          p_type?: string
          p_value?: number
          p_weekdays?: number[]
        }
        Returns: string
      }
      upsert_rate_rule: {
        Args: {
          p_court_id?: string
          p_days_of_week: number[]
          p_end_time: string
          p_id?: string
          p_is_active?: boolean
          p_name: string
          p_prices: Json
          p_priority?: number
          p_start_time: string
          p_valid_from?: string
          p_valid_to?: string
        }
        Returns: string
      }
      upsert_rate_rule_internal: {
        Args: {
          p_court_id?: string
          p_days_of_week: number[]
          p_end_time: string
          p_id?: string
          p_is_active?: boolean
          p_name: string
          p_prices: Json
          p_priority?: number
          p_start_time: string
          p_valid_from?: string
          p_valid_to?: string
        }
        Returns: string
      }
      upsert_retail_variant: {
        Args: {
          p_barcode?: string
          p_id?: string
          p_is_default?: boolean
          p_item_id: string
          p_low_stock_threshold?: number
          p_name_ar: string
          p_name_en: string
          p_pack_cost_iqd?: number
          p_price_iqd: number
          p_sku?: string
          p_sort_order?: number
          p_supplier_id?: string
        }
        Returns: Json
      }
      upsert_shop_category: {
        Args: {
          p_id?: string
          p_is_active?: boolean
          p_name_ar: string
          p_name_en: string
          p_sort_order?: number
          p_tax_group_id: string
        }
        Returns: string
      }
      upsert_supplier: {
        Args: {
          p_id?: string
          p_is_active?: boolean
          p_name: string
          p_notes?: string
          p_phone?: string
        }
        Returns: string
      }
      upsert_variant: {
        Args: {
          p_id?: string
          p_is_default?: boolean
          p_item_id: string
          p_name_ar: string
          p_name_en: string
          p_price_iqd: number
          p_sort_order?: number
        }
        Returns: string
      }
      upsert_variant_internal: {
        Args: {
          p_id?: string
          p_is_default?: boolean
          p_item_id: string
          p_name_ar: string
          p_name_en: string
          p_price_iqd: number
          p_sort_order?: number
        }
        Returns: string
      }
      validate_cafe_setting: {
        Args: { p_jtype: string; p_key: string; p_value: Json }
        Returns: undefined
      }
      venue_business_date: {
        Args: { p_at?: string; p_venue: string }
        Returns: string
      }
      venue_mode:
        | { Args: never; Returns: Json }
        | { Args: { p_venue: string }; Returns: Json }
      venue_patch_int: {
        Args: { p_key: string; p_max: number; p_min: number; p_patch: Json }
        Returns: number
      }
      verify_manager_pin: {
        Args: { p_device_id?: string; p_pin: string }
        Returns: string
      }
      verify_own_pin: {
        Args: { p_device_id?: string; p_pin: string }
        Returns: boolean
      }
      verify_table_token: { Args: { p_token: string }; Returns: string }
      visible_venue_ids: { Args: never; Returns: string[] }
      void_after_send: {
        Args: {
          p_device_id?: string
          p_order_item_id: string
          p_pin: string
          p_reason_code: string
        }
        Returns: Json
      }
      void_order_item_internal: {
        Args: {
          p_actor?: Json
          p_authorizer: string
          p_device_id: string
          p_order_item_id: string
          p_reason_code: string
        }
        Returns: Json
      }
      wage_due_date: {
        Args: { p_month: string; p_pay_day: number }
        Returns: string
      }
      wage_line: {
        Args: {
          p_month: string
          p_remind: number
          p_staff: string
          p_today: string
          p_venue: string
        }
        Returns: Json
      }
      wage_month_paid: {
        Args: { p_month: string; p_staff: string; p_venue: string }
        Returns: boolean
      }
      wage_open_month: {
        Args: { p_from: string; p_staff: string; p_venue: string }
        Returns: string
      }
      wages_due: { Args: { p_venue_id?: string }; Returns: Json }
      wages_month: {
        Args: { p_month?: string; p_venue_id?: string }
        Returns: Json
      }
      waiter_call_transition: {
        Args: {
          p_call_id: string
          p_label: string
          p_staff: string
          p_to: Database["public"]["Enums"]["waiter_call_status"]
        }
        Returns: Json
      }
      withdraw_content: { Args: { p_id: string }; Returns: Json }
      withdraw_deduction: { Args: { p_id: string }; Returns: Json }
      withdraw_marketing_request: { Args: { p_id: string }; Returns: Json }
      withdraw_protocol: { Args: { p_run_id: string }; Returns: Json }
      withdraw_recipe_change: { Args: { p_id: string }; Returns: Json }
      withdraw_release_idea: { Args: { p_id: string }; Returns: Json }
      withdraw_staff_request: { Args: { p_id: string }; Returns: undefined }
      withdraw_step: { Args: { p_submission_id: string }; Returns: Json }
      write_audit: {
        Args: {
          p_action: string
          p_after?: Json
          p_authorizer_id?: string
          p_before?: Json
          p_device_id?: string
          p_entity: string
          p_entity_id: string
          p_reason_code?: string
        }
        Returns: undefined
      }
      write_audit_external: {
        Args: {
          p_action: string
          p_actor_role: string
          p_after?: Json
          p_authorizer?: string
          p_before?: Json
          p_entity: string
          p_entity_id: string
          p_reason_code?: string
        }
        Returns: undefined
      }
      write_off_expired: {
        Args: {
          p_batch_id: string
          p_device_id?: string
          p_pin: string
          p_reason_code?: string
        }
        Returns: undefined
      }
      // PROVISIONAL coaching RPC types — replaced by the regenerated file at integration
      // (docs/design/coaching/build-contracts-2026-10-01.md §1.7, §1.12–§1.14: R4, R70, R75).
      // Only the RPCs the operator calls; signatures as the contracts name them, results Json.
      add_coach_time_off: {
        Args: {
          p_coach_id: string
          p_ends_at: string
          p_reason?: string
          p_starts_at: string
        }
        Returns: Json
      }
      cancel_coach_time_off: { Args: { p_id: string }; Returns: Json }
      coach_promote: {
        Args: {
          p_bio_ar?: string
          p_bio_en?: string
          p_display_name_ar: string
          p_display_name_en: string
          p_photo_path?: string
          p_profile_id: string
          p_venue_ids?: string[]
        }
        Returns: Json
      }
      coach_statement_approve: { Args: { p_statement_id: string }; Returns: Json }
      coach_statement_detail: { Args: { p_statement_id: string }; Returns: Json }
      coach_statement_mark_paid: {
        Args: {
          p_device_id?: string
          p_pin: string
          p_reference: string
          p_statement_id: string
        }
        Returns: Json
      }
      coach_statement_refresh: { Args: { p_statement_id: string }; Returns: Json }
      coach_statement_void: {
        Args: {
          p_device_id?: string
          p_pin?: string
          p_reason: string
          p_statement_id: string
        }
        Returns: Json
      }
      coach_update: { Args: { p_coach_id: string; p_patch: Json }; Returns: Json }
      coaches_admin: { Args: { p_venue_id?: string }; Returns: Json }
      customer_lessons: { Args: { p_customer_id: string }; Returns: Json }
      desk_add_student: {
        Args: {
          p_course_id?: string
          p_customer_id?: string
          p_idempotency_key: string
          p_lesson_id?: string
          p_name?: string
          p_phone?: string
        }
        Returns: Json
      }
      desk_book_lesson: {
        Args: {
          p_coach_id: string
          p_customer_id?: string
          p_idempotency_key: string
          p_lesson_type_id: string
          p_name?: string
          p_party_size?: number
          p_phone?: string
          p_start_at: string
        }
        Returns: Json
      }
      desk_cancel_course: {
        Args: { p_course_id: string; p_reason: string }
        Returns: Json
      }
      desk_cancel_enrolment: {
        Args: { p_enrolment_id: string; p_reason: string }
        Returns: Json
      }
      desk_cancel_lesson: {
        Args: { p_lesson_id: string; p_reason: string }
        Returns: Json
      }
      desk_create_course: {
        Args: {
          p_coach_id: string
          p_idempotency_key: string
          p_lesson_type_id: string
          p_starts: string[]
          p_title_ar?: string
          p_title_en?: string
        }
        Returns: Json
      }
      desk_create_group: {
        Args: {
          p_coach_id: string
          p_idempotency_key: string
          p_lesson_type_id: string
          p_start_at: string
        }
        Returns: Json
      }
      desk_lesson_detail: { Args: { p_lesson_id: string }; Returns: Json }
      desk_lessons: {
        Args: { p_from: string; p_to: string; p_venue_id?: string }
        Returns: Json
      }
      desk_mark_attendance: {
        Args: { p_enrolment_id: string; p_lesson_id: string; p_status: string }
        Returns: Json
      }
      desk_move_lesson_court: {
        Args: { p_court_id: string; p_lesson_id: string }
        Returns: Json
      }
      desk_reschedule_session: {
        Args: { p_lesson_id: string; p_start_at: string }
        Returns: Json
      }
      lesson_blocked_refund_record: {
        Args: {
          p_amount_iqd: number
          p_device_id?: string
          p_enrolment_id: string
          p_pin: string
          p_reference: string
        }
        Returns: Json
      }
      lesson_refunds_due: { Args: { p_venue_id?: string }; Returns: Json }
      lesson_settle: {
        Args: {
          p_device_id?: string
          p_enrolment_id: string
          p_expected_owed_iqd: number
          p_idempotency_key: string
          p_method: string
          p_tendered_iqd?: number
        }
        Returns: Json
      }
      report_coach_statements: { Args: { p_month?: string }; Returns: Json }
      report_lessons: { Args: { p_from: string; p_to: string }; Returns: Json }
      set_coach_branches: {
        Args: { p_coach_id: string; p_venue_ids: string[] }
        Returns: Json
      }
      set_coach_hours: {
        Args: { p_coach_id: string; p_venue_id: string; p_windows: Json }
        Returns: Json
      }
      set_coach_lesson_types: {
        Args: {
          p_coach_id: string
          p_lesson_type_ids: string[]
          p_venue_id: string
        }
        Returns: Json
      }
      set_coach_price: {
        Args: {
          p_coach_id: string
          p_lesson_type_id: string
          p_price_iqd?: number
        }
        Returns: Json
      }
      set_coach_status: {
        Args: { p_coach_id: string; p_reason?: string; p_status: string }
        Returns: Json
      }
      upsert_lesson_type: {
        Args: { p_id?: string; p_patch: Json; p_venue_id: string }
        Returns: Json
      }
      // END PROVISIONAL coaching RPC types
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      addon_suggestions: {
        Row: {
          item_id: string
          sort_order: number
          suggested_item_id: string
        }
        Insert: {
          item_id: string
          sort_order?: number
          suggested_item_id: string
        }
        Update: {
          item_id?: string
          sort_order?: number
          suggested_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "addon_suggestions_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "addon_suggestions_suggested_item_id_fkey"
            columns: ["suggested_item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
        ]
      }
      allergens: {
        Row: {
          code: string
          id: string
          label_ar: string
          label_en: string
        }
        Insert: {
          code: string
          id?: string
          label_ar: string
          label_en: string
        }
        Update: {
          code?: string
          id?: string
          label_ar?: string
          label_en?: string
        }
        Relationships: []
      }
      analytics_insight_rejections: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          reason: string | null
          text: string
          text_key: string
          venue_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          reason?: string | null
          text: string
          text_key: string
          venue_id?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          reason?: string | null
          text?: string
          text_key?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "analytics_insight_rejections_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "analytics_insight_rejections_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      analytics_insights: {
        Row: {
          compare_basis: string
          court_id: string | null
          created_at: string
          created_by: string | null
          id: string
          insights: Json
          locale: string
          range_from: string
          range_to: string
          scope: string
          venue_id: string
        }
        Insert: {
          compare_basis?: string
          court_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          insights: Json
          locale?: string
          range_from: string
          range_to: string
          scope?: string
          venue_id?: string
        }
        Update: {
          compare_basis?: string
          court_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          insights?: Json
          locale?: string
          range_from?: string
          range_to?: string
          scope?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "analytics_insights_court_id_fkey"
            columns: ["court_id"]
            isOneToOne: false
            referencedRelation: "courts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "analytics_insights_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "analytics_insights_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      analytics_patterns: {
        Row: {
          court_id: string | null
          created_at: string
          created_by: string | null
          id: string
          locale: string
          patterns: Json
          range_from: string
          range_to: string
          scope: string
          venue_id: string
        }
        Insert: {
          court_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          locale?: string
          patterns: Json
          range_from: string
          range_to: string
          scope?: string
          venue_id?: string
        }
        Update: {
          court_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          locale?: string
          patterns?: Json
          range_from?: string
          range_to?: string
          scope?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "analytics_patterns_court_id_fkey"
            columns: ["court_id"]
            isOneToOne: false
            referencedRelation: "courts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "analytics_patterns_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "analytics_patterns_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      assistant_calls: {
        Row: {
          cache_read_tokens: number
          cache_write_tokens: number
          call_no: number
          cost_micros: number
          created_at: string
          id: number
          input_tokens: number
          message_id: string
          model: string
          ms: number | null
          output_tokens: number
          stop_reason: string | null
        }
        Insert: {
          cache_read_tokens?: number
          cache_write_tokens?: number
          call_no: number
          cost_micros?: number
          created_at?: string
          id?: never
          input_tokens?: number
          message_id: string
          model: string
          ms?: number | null
          output_tokens?: number
          stop_reason?: string | null
        }
        Update: {
          cache_read_tokens?: number
          cache_write_tokens?: number
          call_no?: number
          cost_micros?: number
          created_at?: string
          id?: never
          input_tokens?: number
          message_id?: string
          model?: string
          ms?: number | null
          output_tokens?: number
          stop_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "assistant_calls_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "assistant_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      assistant_chunks: {
        Row: {
          body: string
          embedding: string | null
          id: number
          indexed_at: string
          kind: string
          lang: string
          ref: string
          route: string | null
          source_updated_at: string | null
          title: string | null
          tsv: unknown
        }
        Insert: {
          body: string
          embedding?: string | null
          id?: never
          indexed_at?: string
          kind: string
          lang: string
          ref: string
          route?: string | null
          source_updated_at?: string | null
          title?: string | null
          tsv?: unknown
        }
        Update: {
          body?: string
          embedding?: string | null
          id?: never
          indexed_at?: string
          kind?: string
          lang?: string
          ref?: string
          route?: string | null
          source_updated_at?: string | null
          title?: string | null
          tsv?: unknown
        }
        Relationships: []
      }
      assistant_component_cache: {
        Row: {
          component_key: string
          content: Json
          expires_at: string | null
          gate: Json | null
          generated_at: string
          id: number
          inputs_fingerprint: string
          params_hash: string
          sources: Json
          superseded_at: string | null
          tokens: Json
        }
        Insert: {
          component_key: string
          content: Json
          expires_at?: string | null
          gate?: Json | null
          generated_at?: string
          id?: never
          inputs_fingerprint: string
          params_hash: string
          sources?: Json
          superseded_at?: string | null
          tokens?: Json
        }
        Update: {
          component_key?: string
          content?: Json
          expires_at?: string | null
          gate?: Json | null
          generated_at?: string
          id?: never
          inputs_fingerprint?: string
          params_hash?: string
          sources?: Json
          superseded_at?: string | null
          tokens?: Json
        }
        Relationships: [
          {
            foreignKeyName: "assistant_component_cache_component_key_fkey"
            columns: ["component_key"]
            isOneToOne: false
            referencedRelation: "assistant_components"
            referencedColumns: ["key"]
          },
        ]
      }
      assistant_components: {
        Row: {
          archived_at: string | null
          created_at: string
          created_by: string | null
          default_params: Json
          key: string
          kind: string
          output_schema: Json
          question: string
          tools: string[]
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          created_by?: string | null
          default_params?: Json
          key: string
          kind: string
          output_schema: Json
          question: string
          tools: string[]
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          created_by?: string | null
          default_params?: Json
          key?: string
          kind?: string
          output_schema?: Json
          question?: string
          tools?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "assistant_components_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      assistant_conversations: {
        Row: {
          archived_at: string | null
          created_at: string
          handles: Json
          id: string
          model: string | null
          owner_id: string
          range: Json | null
          scopes: string[]
          title: string | null
          tokens: Json
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          handles?: Json
          id?: string
          model?: string | null
          owner_id: string
          range?: Json | null
          scopes?: string[]
          title?: string | null
          tokens?: Json
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          handles?: Json
          id?: string
          model?: string | null
          owner_id?: string
          range?: Json | null
          scopes?: string[]
          title?: string | null
          tokens?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "assistant_conversations_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      assistant_index_queue: {
        Row: {
          attempts: number
          claimed_at: string | null
          enqueued_at: string
          id: number
          kind: string
          last_error: string | null
          op: string
          ref: string
        }
        Insert: {
          attempts?: number
          claimed_at?: string | null
          enqueued_at?: string
          id?: never
          kind: string
          last_error?: string | null
          op: string
          ref: string
        }
        Update: {
          attempts?: number
          claimed_at?: string | null
          enqueued_at?: string
          id?: never
          kind?: string
          last_error?: string | null
          op?: string
          ref?: string
        }
        Relationships: []
      }
      assistant_jobs: {
        Row: {
          batch_id: string | null
          chunks_done: number
          chunks_total: number | null
          conversation_id: string | null
          created_at: string
          error: string | null
          estimate: Json
          finished_at: string | null
          id: string
          message_id: string | null
          mode: string | null
          plan: Json
          result: Json | null
          started_at: string | null
          status: string
          tokens: Json
        }
        Insert: {
          batch_id?: string | null
          chunks_done?: number
          chunks_total?: number | null
          conversation_id?: string | null
          created_at?: string
          error?: string | null
          estimate: Json
          finished_at?: string | null
          id?: string
          message_id?: string | null
          mode?: string | null
          plan: Json
          result?: Json | null
          started_at?: string | null
          status?: string
          tokens?: Json
        }
        Update: {
          batch_id?: string | null
          chunks_done?: number
          chunks_total?: number | null
          conversation_id?: string | null
          created_at?: string
          error?: string | null
          estimate?: Json
          finished_at?: string | null
          id?: string
          message_id?: string | null
          mode?: string | null
          plan?: Json
          result?: Json | null
          started_at?: string | null
          status?: string
          tokens?: Json
        }
        Relationships: [
          {
            foreignKeyName: "assistant_jobs_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "assistant_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assistant_jobs_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "assistant_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      assistant_messages: {
        Row: {
          content: Json
          conversation_id: string
          created_at: string
          gate: Json | null
          id: string
          role: string
          seq: number
          sources: Json
          tokens: Json
        }
        Insert: {
          content: Json
          conversation_id: string
          created_at?: string
          gate?: Json | null
          id?: string
          role: string
          seq: number
          sources?: Json
          tokens?: Json
        }
        Update: {
          content?: Json
          conversation_id?: string
          created_at?: string
          gate?: Json | null
          id?: string
          role?: string
          seq?: number
          sources?: Json
          tokens?: Json
        }
        Relationships: [
          {
            foreignKeyName: "assistant_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "assistant_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          actor_role: string | null
          after: Json | null
          at: string
          authorizer_id: string | null
          before: Json | null
          device_id: string | null
          entity: string
          entity_id: string
          id: number
          reason_code: string | null
          search_text: unknown
          venue_id: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_role?: string | null
          after?: Json | null
          at?: string
          authorizer_id?: string | null
          before?: Json | null
          device_id?: string | null
          entity: string
          entity_id: string
          id?: never
          reason_code?: string | null
          search_text?: unknown
          venue_id?: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_role?: string | null
          after?: Json | null
          at?: string
          authorizer_id?: string | null
          before?: Json | null
          device_id?: string | null
          entity?: string
          entity_id?: string
          id?: never
          reason_code?: string | null
          search_text?: unknown
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_payment_events: {
        Row: {
          at: string
          id: number
          note: string | null
          payment_id: string | null
          provider_status: string | null
          raw: Json
          signature_ok: boolean | null
          source: string
        }
        Insert: {
          at?: string
          id?: never
          note?: string | null
          payment_id?: string | null
          provider_status?: string | null
          raw?: Json
          signature_ok?: boolean | null
          source: string
        }
        Update: {
          at?: string
          id?: never
          note?: string | null
          payment_id?: string | null
          provider_status?: string | null
          raw?: Json
          signature_ok?: boolean | null
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_payment_events_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "booking_payments"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_payments: {
        Row: {
          amount_iqd: number
          cancel_attempts: number
          claimed_at: string | null
          created_at: string
          deadline_at: string
          expired_at: string | null
          failed_at: string | null
          failure_code: string | null
          forfeited_at: string | null
          form_url: string | null
          guest_id: string | null
          hold_id: string | null
          id: string
          last_checked_at: string | null
          lesson_enrolment_id: string | null
          locale: string
          provider: string
          provider_payment_id: string | null
          provider_status: string | null
          purpose: string
          quoted_price_iqd: number
          refund_amount_iqd: number | null
          refund_attempts: number
          refund_note: string | null
          refund_provider_id: string | null
          refund_reason: string | null
          refund_request_id: string | null
          refund_requested_at: string | null
          refunded_at: string | null
          request_id: string
          reservation_id: string | null
          sandbox: boolean
          status: string
          succeeded_at: string | null
          ticket_count: number | null
          updated_at: string
          venue_id: string | null
        }
        Insert: {
          amount_iqd: number
          cancel_attempts?: number
          claimed_at?: string | null
          created_at?: string
          deadline_at: string
          expired_at?: string | null
          failed_at?: string | null
          failure_code?: string | null
          forfeited_at?: string | null
          form_url?: string | null
          guest_id?: string | null
          hold_id?: string | null
          id?: string
          last_checked_at?: string | null
          lesson_enrolment_id?: string | null
          locale?: string
          provider: string
          provider_payment_id?: string | null
          provider_status?: string | null
          purpose?: string
          quoted_price_iqd: number
          refund_amount_iqd?: number | null
          refund_attempts?: number
          refund_note?: string | null
          refund_provider_id?: string | null
          refund_reason?: string | null
          refund_request_id?: string | null
          refund_requested_at?: string | null
          refunded_at?: string | null
          request_id: string
          reservation_id?: string | null
          sandbox?: boolean
          status?: string
          succeeded_at?: string | null
          ticket_count?: number | null
          updated_at?: string
          venue_id?: string | null
        }
        Update: {
          amount_iqd?: number
          cancel_attempts?: number
          claimed_at?: string | null
          created_at?: string
          deadline_at?: string
          expired_at?: string | null
          failed_at?: string | null
          failure_code?: string | null
          forfeited_at?: string | null
          form_url?: string | null
          guest_id?: string | null
          hold_id?: string | null
          id?: string
          last_checked_at?: string | null
          lesson_enrolment_id?: string | null
          locale?: string
          provider?: string
          provider_payment_id?: string | null
          provider_status?: string | null
          purpose?: string
          quoted_price_iqd?: number
          refund_amount_iqd?: number | null
          refund_attempts?: number
          refund_note?: string | null
          refund_provider_id?: string | null
          refund_reason?: string | null
          refund_request_id?: string | null
          refund_requested_at?: string | null
          refunded_at?: string | null
          request_id?: string
          reservation_id?: string | null
          sandbox?: boolean
          status?: string
          succeeded_at?: string | null
          ticket_count?: number | null
          updated_at?: string
          venue_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "booking_payments_guest_id_fkey"
            columns: ["guest_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_payments_hold_id_fkey"
            columns: ["hold_id"]
            isOneToOne: false
            referencedRelation: "reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_payments_lesson_enrolment_fkey"
            columns: ["lesson_enrolment_id"]
            isOneToOne: false
            referencedRelation: "lesson_enrolments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_payments_reservation_id_fkey"
            columns: ["reservation_id"]
            isOneToOne: false
            referencedRelation: "reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_payments_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      cafe_settings: {
        Row: {
          is_public: boolean
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
          venue_id: string
        }
        Insert: {
          is_public: boolean
          key: string
          updated_at?: string
          updated_by?: string | null
          value: Json
          venue_id?: string
        }
        Update: {
          is_public?: boolean
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cafe_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cafe_settings_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      cafe_tables: {
        Row: {
          bell_enabled: boolean
          capacity: number | null
          id: string
          is_active: boolean
          table_number: string
          token_version: number
          venue_id: string
          zone: string | null
        }
        Insert: {
          bell_enabled?: boolean
          capacity?: number | null
          id?: string
          is_active?: boolean
          table_number: string
          token_version?: number
          venue_id?: string
          zone?: string | null
        }
        Update: {
          bell_enabled?: boolean
          capacity?: number | null
          id?: string
          is_active?: boolean
          table_number?: string
          token_version?: number
          venue_id?: string
          zone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cafe_tables_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      checklist_run_items: {
        Row: {
          done_at: string | null
          done_by: string | null
          id: string
          note: string | null
          photo_path: string | null
          photo_required: boolean
          position: number
          run_id: string
          text_ar: string
          text_en: string
        }
        Insert: {
          done_at?: string | null
          done_by?: string | null
          id?: string
          note?: string | null
          photo_path?: string | null
          photo_required?: boolean
          position: number
          run_id: string
          text_ar: string
          text_en: string
        }
        Update: {
          done_at?: string | null
          done_by?: string | null
          id?: string
          note?: string | null
          photo_path?: string | null
          photo_required?: boolean
          position?: number
          run_id?: string
          text_ar?: string
          text_en?: string
        }
        Relationships: [
          {
            foreignKeyName: "checklist_run_items_done_by_fkey"
            columns: ["done_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklist_run_items_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "checklist_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      checklist_runs: {
        Row: {
          business_date: string
          created_at: string
          id: string
          role: Database["public"]["Enums"]["staff_role"]
          slot: string
          template_id: string
          venue_id: string
        }
        Insert: {
          business_date: string
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["staff_role"]
          slot: string
          template_id: string
          venue_id: string
        }
        Update: {
          business_date?: string
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["staff_role"]
          slot?: string
          template_id?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "checklist_runs_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "checklist_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklist_runs_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      checklist_template_items: {
        Row: {
          id: string
          photo_required: boolean
          position: number
          template_id: string
          text_ar: string
          text_en: string
        }
        Insert: {
          id?: string
          photo_required?: boolean
          position: number
          template_id: string
          text_ar: string
          text_en: string
        }
        Update: {
          id?: string
          photo_required?: boolean
          position?: number
          template_id?: string
          text_ar?: string
          text_en?: string
        }
        Relationships: [
          {
            foreignKeyName: "checklist_template_items_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "checklist_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      checklist_templates: {
        Row: {
          id: string
          name_ar: string
          name_en: string
          role: Database["public"]["Enums"]["staff_role"]
          slot: string
          updated_at: string
          updated_by: string | null
          venue_id: string
          version: number
        }
        Insert: {
          id?: string
          name_ar: string
          name_en: string
          role: Database["public"]["Enums"]["staff_role"]
          slot: string
          updated_at?: string
          updated_by?: string | null
          venue_id: string
          version?: number
        }
        Update: {
          id?: string
          name_ar?: string
          name_en?: string
          role?: Database["public"]["Enums"]["staff_role"]
          slot?: string
          updated_at?: string
          updated_by?: string | null
          venue_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "checklist_templates_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklist_templates_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      coach_branches: {
        Row: {
          active: boolean
          coach_id: string
          created_at: string
          venue_id: string
        }
        Insert: {
          active?: boolean
          coach_id: string
          created_at?: string
          venue_id: string
        }
        Update: {
          active?: boolean
          coach_id?: string
          created_at?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "coach_branches_coach_id_fkey"
            columns: ["coach_id"]
            isOneToOne: false
            referencedRelation: "coaches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coach_branches_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      coach_hours: {
        Row: {
          coach_id: string
          end_time: string
          id: string
          set_by: string
          set_by_staff_id: string | null
          start_time: string
          updated_at: string
          venue_id: string
          weekday: number
        }
        Insert: {
          coach_id: string
          end_time: string
          id?: string
          set_by: string
          set_by_staff_id?: string | null
          start_time: string
          updated_at?: string
          venue_id: string
          weekday: number
        }
        Update: {
          coach_id?: string
          end_time?: string
          id?: string
          set_by?: string
          set_by_staff_id?: string | null
          start_time?: string
          updated_at?: string
          venue_id?: string
          weekday?: number
        }
        Relationships: [
          {
            foreignKeyName: "coach_hours_coach_id_fkey"
            columns: ["coach_id"]
            isOneToOne: false
            referencedRelation: "coaches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coach_hours_set_by_staff_id_fkey"
            columns: ["set_by_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coach_hours_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      coach_lesson_types: {
        Row: {
          coach_id: string
          created_at: string
          lesson_type_id: string
          venue_id: string
        }
        Insert: {
          coach_id: string
          created_at?: string
          lesson_type_id: string
          venue_id: string
        }
        Update: {
          coach_id?: string
          created_at?: string
          lesson_type_id?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "coach_lesson_types_coach_id_fkey"
            columns: ["coach_id"]
            isOneToOne: false
            referencedRelation: "coaches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coach_lesson_types_lesson_type_id_fkey"
            columns: ["lesson_type_id"]
            isOneToOne: false
            referencedRelation: "lesson_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coach_lesson_types_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      coach_photo_purges: {
        Row: {
          coach_id: string
          folder: string
          id: string
          purged_at: string | null
          queued_at: string
        }
        Insert: {
          coach_id: string
          folder: string
          id?: string
          purged_at?: string | null
          queued_at?: string
        }
        Update: {
          coach_id?: string
          folder?: string
          id?: string
          purged_at?: string | null
          queued_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "coach_photo_purges_coach_id_fkey"
            columns: ["coach_id"]
            isOneToOne: false
            referencedRelation: "coaches"
            referencedColumns: ["id"]
          },
        ]
      }
      coach_prices: {
        Row: {
          coach_id: string
          lesson_type_id: string
          price_iqd: number
          protocol_run_id: string | null
          set_at: string
          venue_id: string
        }
        Insert: {
          coach_id: string
          lesson_type_id: string
          price_iqd: number
          protocol_run_id?: string | null
          set_at?: string
          venue_id: string
        }
        Update: {
          coach_id?: string
          lesson_type_id?: string
          price_iqd?: number
          protocol_run_id?: string | null
          set_at?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "coach_prices_coach_id_fkey"
            columns: ["coach_id"]
            isOneToOne: false
            referencedRelation: "coaches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coach_prices_lesson_type_id_fkey"
            columns: ["lesson_type_id"]
            isOneToOne: false
            referencedRelation: "lesson_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coach_prices_protocol_run_id_fkey"
            columns: ["protocol_run_id"]
            isOneToOne: false
            referencedRelation: "protocol_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coach_prices_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      coach_statement_lines: {
        Row: {
          coach_iqd: number
          collected_iqd: number
          court_share_iqd: number
          created_at: string
          id: string
          is_adjustment: boolean
          lesson_id: string
          share_bp: number
          statement_id: string
          venue_id: string
        }
        Insert: {
          coach_iqd: number
          collected_iqd?: number
          court_share_iqd?: number
          created_at?: string
          id?: string
          is_adjustment?: boolean
          lesson_id: string
          share_bp: number
          statement_id: string
          venue_id: string
        }
        Update: {
          coach_iqd?: number
          collected_iqd?: number
          court_share_iqd?: number
          created_at?: string
          id?: string
          is_adjustment?: boolean
          lesson_id?: string
          share_bp?: number
          statement_id?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "coach_statement_lines_lesson_id_fkey"
            columns: ["lesson_id"]
            isOneToOne: false
            referencedRelation: "lessons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coach_statement_lines_statement_id_fkey"
            columns: ["statement_id"]
            isOneToOne: false
            referencedRelation: "coach_statements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coach_statement_lines_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      coach_statements: {
        Row: {
          adjustments_iqd: number
          approved_at: string | null
          approved_by: string | null
          coach_id: string
          coach_iqd: number
          collected_iqd: number
          court_share_iqd: number
          drafted_at: string
          id: string
          lessons_count: number
          month: string
          paid_at: string | null
          paid_by: string | null
          paid_reference: string | null
          refreshed_at: string | null
          status: string
          venue_id: string
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        Insert: {
          adjustments_iqd?: number
          approved_at?: string | null
          approved_by?: string | null
          coach_id: string
          coach_iqd?: number
          collected_iqd?: number
          court_share_iqd?: number
          drafted_at?: string
          id?: string
          lessons_count?: number
          month: string
          paid_at?: string | null
          paid_by?: string | null
          paid_reference?: string | null
          refreshed_at?: string | null
          status?: string
          venue_id: string
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Update: {
          adjustments_iqd?: number
          approved_at?: string | null
          approved_by?: string | null
          coach_id?: string
          coach_iqd?: number
          collected_iqd?: number
          court_share_iqd?: number
          drafted_at?: string
          id?: string
          lessons_count?: number
          month?: string
          paid_at?: string | null
          paid_by?: string | null
          paid_reference?: string | null
          refreshed_at?: string | null
          status?: string
          venue_id?: string
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "coach_statements_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coach_statements_coach_id_fkey"
            columns: ["coach_id"]
            isOneToOne: false
            referencedRelation: "coaches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coach_statements_paid_by_fkey"
            columns: ["paid_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coach_statements_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coach_statements_voided_by_fkey"
            columns: ["voided_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      coach_time_off: {
        Row: {
          cancelled_at: string | null
          coach_id: string
          created_at: string
          id: string
          period: unknown
          reason: string
          set_by: string
          set_by_staff_id: string | null
        }
        Insert: {
          cancelled_at?: string | null
          coach_id: string
          created_at?: string
          id?: string
          period: unknown
          reason?: string
          set_by: string
          set_by_staff_id?: string | null
        }
        Update: {
          cancelled_at?: string | null
          coach_id?: string
          created_at?: string
          id?: string
          period?: unknown
          reason?: string
          set_by?: string
          set_by_staff_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "coach_time_off_coach_id_fkey"
            columns: ["coach_id"]
            isOneToOne: false
            referencedRelation: "coaches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coach_time_off_set_by_staff_id_fkey"
            columns: ["set_by_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      coaches: {
        Row: {
          bio_ar: string
          bio_en: string
          created_at: string
          created_by_staff_id: string | null
          display_name_ar: string
          display_name_en: string
          id: string
          photo_path: string | null
          profile_id: string
          public_accepted_at: string | null
          retired_at: string | null
          sort_order: number
          status: string
          updated_at: string
        }
        Insert: {
          bio_ar?: string
          bio_en?: string
          created_at?: string
          created_by_staff_id?: string | null
          display_name_ar: string
          display_name_en: string
          id?: string
          photo_path?: string | null
          profile_id: string
          public_accepted_at?: string | null
          retired_at?: string | null
          sort_order?: number
          status?: string
          updated_at?: string
        }
        Update: {
          bio_ar?: string
          bio_en?: string
          created_at?: string
          created_by_staff_id?: string | null
          display_name_ar?: string
          display_name_en?: string
          id?: string
          photo_path?: string | null
          profile_id?: string
          public_accepted_at?: string | null
          retired_at?: string | null
          sort_order?: number
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "coaches_created_by_staff_id_fkey"
            columns: ["created_by_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coaches_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      courses: {
        Row: {
          cancel_reason: string | null
          cancelled_at: string | null
          coach_id: string
          coach_share_bp: number
          court_share_iqd: number
          created_at: string
          created_by_kind: string
          created_by_profile_id: string | null
          created_by_staff_id: string | null
          cutoff_at: string
          cutoff_checked_at: string | null
          id: string
          idempotency_key: string | null
          lesson_type_id: string
          max_places: number
          min_places: number
          price_iqd: number
          sessions_count: number
          signup_closes_at: string
          status: string
          title_ar: string
          title_en: string
          updated_at: string
          venue_id: string
        }
        Insert: {
          cancel_reason?: string | null
          cancelled_at?: string | null
          coach_id: string
          coach_share_bp: number
          court_share_iqd: number
          created_at?: string
          created_by_kind: string
          created_by_profile_id?: string | null
          created_by_staff_id?: string | null
          cutoff_at: string
          cutoff_checked_at?: string | null
          id?: string
          idempotency_key?: string | null
          lesson_type_id: string
          max_places: number
          min_places: number
          price_iqd: number
          sessions_count: number
          signup_closes_at: string
          status?: string
          title_ar?: string
          title_en?: string
          updated_at?: string
          venue_id: string
        }
        Update: {
          cancel_reason?: string | null
          cancelled_at?: string | null
          coach_id?: string
          coach_share_bp?: number
          court_share_iqd?: number
          created_at?: string
          created_by_kind?: string
          created_by_profile_id?: string | null
          created_by_staff_id?: string | null
          cutoff_at?: string
          cutoff_checked_at?: string | null
          id?: string
          idempotency_key?: string | null
          lesson_type_id?: string
          max_places?: number
          min_places?: number
          price_iqd?: number
          sessions_count?: number
          signup_closes_at?: string
          status?: string
          title_ar?: string
          title_en?: string
          updated_at?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "courses_coach_id_fkey"
            columns: ["coach_id"]
            isOneToOne: false
            referencedRelation: "coaches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "courses_created_by_profile_id_fkey"
            columns: ["created_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "courses_created_by_staff_id_fkey"
            columns: ["created_by_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "courses_lesson_type_id_fkey"
            columns: ["lesson_type_id"]
            isOneToOne: false
            referencedRelation: "lesson_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "courses_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      courts: {
        Row: {
          active_from: string | null
          active_to: string | null
          description_ar: string | null
          description_en: string | null
          duration_options: number[]
          id: string
          indoor: boolean
          is_active: boolean
          name_ar: string
          name_en: string
          photo_path: string | null
          sort_order: number
          venue_id: string
        }
        Insert: {
          active_from?: string | null
          active_to?: string | null
          description_ar?: string | null
          description_en?: string | null
          duration_options?: number[]
          id?: string
          indoor?: boolean
          is_active?: boolean
          name_ar: string
          name_en: string
          photo_path?: string | null
          sort_order?: number
          venue_id?: string
        }
        Update: {
          active_from?: string | null
          active_to?: string | null
          description_ar?: string | null
          description_en?: string | null
          duration_options?: number[]
          id?: string
          indoor?: boolean
          is_active?: boolean
          name_ar?: string
          name_en?: string
          photo_path?: string | null
          sort_order?: number
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "courts_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_flags: {
        Row: {
          created_at: string
          created_by: string
          customer_id: string
          label: string | null
          type: string
        }
        Insert: {
          created_at?: string
          created_by: string
          customer_id: string
          label?: string | null
          type: string
        }
        Update: {
          created_at?: string
          created_by?: string
          customer_id?: string
          label?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_flags_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_flags_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_notes: {
        Row: {
          author_id: string
          body: string
          created_at: string
          customer_id: string
          edited_at: string | null
          edited_by: string | null
          id: string
        }
        Insert: {
          author_id: string
          body: string
          created_at?: string
          customer_id: string
          edited_at?: string | null
          edited_by?: string | null
          id?: string
        }
        Update: {
          author_id?: string
          body?: string
          created_at?: string
          customer_id?: string
          edited_at?: string | null
          edited_by?: string | null
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_notes_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_notes_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_notes_edited_by_fkey"
            columns: ["edited_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      day_sessions: {
        Row: {
          business_date: string
          card_expected_iqd: number | null
          card_terminal_batch_iqd: number | null
          cash_counted_iqd: number | null
          cash_expected_iqd: number | null
          cash_variance_iqd: number | null
          closed_at: string | null
          closed_by: string | null
          id: string
          notes: string | null
          opened_at: string
          opened_by: string
          opening_float_iqd: number
          status: Database["public"]["Enums"]["day_status"]
          venue_id: string
        }
        Insert: {
          business_date: string
          card_expected_iqd?: number | null
          card_terminal_batch_iqd?: number | null
          cash_counted_iqd?: number | null
          cash_expected_iqd?: number | null
          cash_variance_iqd?: number | null
          closed_at?: string | null
          closed_by?: string | null
          id?: string
          notes?: string | null
          opened_at?: string
          opened_by: string
          opening_float_iqd: number
          status?: Database["public"]["Enums"]["day_status"]
          venue_id?: string
        }
        Update: {
          business_date?: string
          card_expected_iqd?: number | null
          card_terminal_batch_iqd?: number | null
          cash_counted_iqd?: number | null
          cash_expected_iqd?: number | null
          cash_variance_iqd?: number | null
          closed_at?: string | null
          closed_by?: string | null
          id?: string
          notes?: string | null
          opened_at?: string
          opened_by?: string
          opening_float_iqd?: number
          status?: Database["public"]["Enums"]["day_status"]
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "day_sessions_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "day_sessions_opened_by_fkey"
            columns: ["opened_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "day_sessions_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      degraded_periods: {
        Row: {
          detected_by: string
          ended_at: string | null
          id: string
          started_at: string
          venue_id: string
        }
        Insert: {
          detected_by?: string
          ended_at?: string | null
          id?: string
          started_at: string
          venue_id?: string
        }
        Update: {
          detected_by?: string
          ended_at?: string | null
          id?: string
          started_at?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "degraded_periods_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      deliveries: {
        Row: {
          id: string
          location: Database["public"]["Enums"]["stock_location"]
          notes: string | null
          received_at: string
          received_by: string
          source: string
          supplier_id: string | null
          supplier_name: string | null
          venue_id: string
        }
        Insert: {
          id?: string
          location?: Database["public"]["Enums"]["stock_location"]
          notes?: string | null
          received_at?: string
          received_by: string
          source?: string
          supplier_id?: string | null
          supplier_name?: string | null
          venue_id?: string
        }
        Update: {
          id?: string
          location?: Database["public"]["Enums"]["stock_location"]
          notes?: string | null
          received_at?: string
          received_by?: string
          source?: string
          supplier_id?: string | null
          supplier_name?: string | null
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "deliveries_received_by_fkey"
            columns: ["received_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deliveries_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deliveries_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      delivery_lines: {
        Row: {
          cost_source: string
          delivery_id: string
          expiry_date: string | null
          id: string
          ingredient_id: string
          qty_expected: number | null
          qty_received: number
          unit_cost_iqd: number
        }
        Insert: {
          cost_source?: string
          delivery_id: string
          expiry_date?: string | null
          id?: string
          ingredient_id: string
          qty_expected?: number | null
          qty_received: number
          unit_cost_iqd: number
        }
        Update: {
          cost_source?: string
          delivery_id?: string
          expiry_date?: string | null
          id?: string
          ingredient_id?: string
          qty_expected?: number | null
          qty_received?: number
          unit_cost_iqd?: number
        }
        Relationships: [
          {
            foreignKeyName: "delivery_lines_delivery_id_fkey"
            columns: ["delivery_id"]
            isOneToOne: false
            referencedRelation: "deliveries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_lines_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_lines_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "v_ingredient_on_hand"
            referencedColumns: ["ingredient_id"]
          },
          {
            foreignKeyName: "delivery_lines_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "v_stock_by_location"
            referencedColumns: ["ingredient_id"]
          },
        ]
      }
      device_heartbeats: {
        Row: {
          app_version: string | null
          device_id: string
          is_till: boolean
          last_seen_at: string
          queue_depth: number
          staff_id: string | null
          venue_id: string
        }
        Insert: {
          app_version?: string | null
          device_id: string
          is_till?: boolean
          last_seen_at?: string
          queue_depth?: number
          staff_id?: string | null
          venue_id?: string
        }
        Update: {
          app_version?: string | null
          device_id?: string
          is_till?: boolean
          last_seen_at?: string
          queue_depth?: number
          staff_id?: string | null
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "device_heartbeats_device_venue_fkey"
            columns: ["device_id", "venue_id"]
            isOneToOne: false
            referencedRelation: "stations"
            referencedColumns: ["id", "venue_id"]
          },
          {
            foreignKeyName: "device_heartbeats_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "device_heartbeats_station_fkey"
            columns: ["device_id"]
            isOneToOne: true
            referencedRelation: "stations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "device_heartbeats_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      guest_sessions: {
        Row: {
          auth_user_id: string
          closed_at: string | null
          created_at: string
          expires_at: string
          id: string
          last_activity_at: string
          linked_profile_id: string | null
          table_id: string
          venue_id: string
        }
        Insert: {
          auth_user_id: string
          closed_at?: string | null
          created_at?: string
          expires_at: string
          id?: string
          last_activity_at?: string
          linked_profile_id?: string | null
          table_id: string
          venue_id?: string
        }
        Update: {
          auth_user_id?: string
          closed_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          last_activity_at?: string
          linked_profile_id?: string | null
          table_id?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "guest_sessions_linked_profile_id_fkey"
            columns: ["linked_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guest_sessions_table_id_fkey"
            columns: ["table_id"]
            isOneToOne: false
            referencedRelation: "cafe_tables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guest_sessions_table_venue_fkey"
            columns: ["table_id", "venue_id"]
            isOneToOne: false
            referencedRelation: "cafe_tables"
            referencedColumns: ["id", "venue_id"]
          },
          {
            foreignKeyName: "guest_sessions_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      hiring_candidates: {
        Row: {
          brief: string
          candidate_name: string
          candidate_phone: string
          created_at: string
          created_by: string
          decided_at: string | null
          id: string
          interview_at: string | null
          pick_reason: string | null
          picked: boolean
          purge_after: string | null
          run_id: string
          venue_id: string
        }
        Insert: {
          brief?: string
          candidate_name: string
          candidate_phone: string
          created_at?: string
          created_by: string
          decided_at?: string | null
          id?: string
          interview_at?: string | null
          pick_reason?: string | null
          picked?: boolean
          purge_after?: string | null
          run_id: string
          venue_id: string
        }
        Update: {
          brief?: string
          candidate_name?: string
          candidate_phone?: string
          created_at?: string
          created_by?: string
          decided_at?: string | null
          id?: string
          interview_at?: string | null
          pick_reason?: string | null
          picked?: boolean
          purge_after?: string | null
          run_id?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "hiring_candidates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hiring_candidates_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "protocol_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hiring_candidates_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      hold_standing: {
        Row: {
          banned_at: string | null
          banned_by: string | null
          blocked_until: string | null
          guest_id: string | null
          id: string
          key: string
          last_strike_at: string | null
          needs_review: boolean
          review_venue_id: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          strikes: number
          suspended_at: string | null
          updated_at: string
        }
        Insert: {
          banned_at?: string | null
          banned_by?: string | null
          blocked_until?: string | null
          guest_id?: string | null
          id?: string
          key: string
          last_strike_at?: string | null
          needs_review?: boolean
          review_venue_id?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          strikes?: number
          suspended_at?: string | null
          updated_at?: string
        }
        Update: {
          banned_at?: string | null
          banned_by?: string | null
          blocked_until?: string | null
          guest_id?: string | null
          id?: string
          key?: string
          last_strike_at?: string | null
          needs_review?: boolean
          review_venue_id?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          strikes?: number
          suspended_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "hold_standing_banned_by_fkey"
            columns: ["banned_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hold_standing_guest_id_fkey"
            columns: ["guest_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hold_standing_review_venue_id_fkey"
            columns: ["review_venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hold_standing_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      hold_strikes: {
        Row: {
          counted: boolean
          created_at: string
          reservation_id: string
          standing_key: string
          struck_at: string
        }
        Insert: {
          counted: boolean
          created_at?: string
          reservation_id: string
          standing_key: string
          struck_at: string
        }
        Update: {
          counted?: boolean
          created_at?: string
          reservation_id?: string
          standing_key?: string
          struck_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "hold_strikes_reservation_id_fkey"
            columns: ["reservation_id"]
            isOneToOne: true
            referencedRelation: "reservations"
            referencedColumns: ["id"]
          },
        ]
      }
      incident_reports: {
        Row: {
          court_id: string | null
          description: string
          id: string
          kind: string
          occurred_at: string
          people_involved: string | null
          photos: string[]
          photos_purged_at: string | null
          place: string
          place_detail: string | null
          purge_after: string
          reported_at: string
          reported_by: string
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          text_purged_at: string | null
          venue_id: string
        }
        Insert: {
          court_id?: string | null
          description: string
          id?: string
          kind: string
          occurred_at: string
          people_involved?: string | null
          photos?: string[]
          photos_purged_at?: string | null
          place: string
          place_detail?: string | null
          purge_after?: string
          reported_at?: string
          reported_by: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          text_purged_at?: string | null
          venue_id: string
        }
        Update: {
          court_id?: string | null
          description?: string
          id?: string
          kind?: string
          occurred_at?: string
          people_involved?: string | null
          photos?: string[]
          photos_purged_at?: string | null
          place?: string
          place_detail?: string | null
          purge_after?: string
          reported_at?: string
          reported_by?: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          text_purged_at?: string | null
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "incident_reports_court_id_fkey"
            columns: ["court_id"]
            isOneToOne: false
            referencedRelation: "courts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_reports_reported_by_fkey"
            columns: ["reported_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_reports_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_reports_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      ingredient_aliases: {
        Row: {
          alias_norm: string
          created_at: string
          created_by: string | null
          id: string
          ingredient_id: string
          last_used_at: string
          supplier_id: string | null
          uses: number
          venue_id: string
        }
        Insert: {
          alias_norm: string
          created_at?: string
          created_by?: string | null
          id?: string
          ingredient_id: string
          last_used_at?: string
          supplier_id?: string | null
          uses?: number
          venue_id: string
        }
        Update: {
          alias_norm?: string
          created_at?: string
          created_by?: string | null
          id?: string
          ingredient_id?: string
          last_used_at?: string
          supplier_id?: string | null
          uses?: number
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ingredient_aliases_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ingredient_aliases_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ingredient_aliases_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "v_ingredient_on_hand"
            referencedColumns: ["ingredient_id"]
          },
          {
            foreignKeyName: "ingredient_aliases_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "v_stock_by_location"
            referencedColumns: ["ingredient_id"]
          },
          {
            foreignKeyName: "ingredient_aliases_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ingredient_aliases_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      ingredients: {
        Row: {
          batch_yield: number | null
          id: string
          is_active: boolean
          kind: Database["public"]["Enums"]["ingredient_kind"]
          low_stock_threshold: number | null
          name_ar: string
          name_en: string
          pack_cost_iqd: number | null
          pack_size: number | null
          par_level: number | null
          shelf_life_days: number | null
          supplier_id: string | null
          supplier_name: string | null
          unit: Database["public"]["Enums"]["stock_unit"]
          variant_id: string | null
          venue_id: string
          waste_allowance_percent: number
          yield_percent: number
        }
        Insert: {
          batch_yield?: number | null
          id?: string
          is_active?: boolean
          kind?: Database["public"]["Enums"]["ingredient_kind"]
          low_stock_threshold?: number | null
          name_ar: string
          name_en: string
          pack_cost_iqd?: number | null
          pack_size?: number | null
          par_level?: number | null
          shelf_life_days?: number | null
          supplier_id?: string | null
          supplier_name?: string | null
          unit: Database["public"]["Enums"]["stock_unit"]
          variant_id?: string | null
          venue_id?: string
          waste_allowance_percent?: number
          yield_percent?: number
        }
        Update: {
          batch_yield?: number | null
          id?: string
          is_active?: boolean
          kind?: Database["public"]["Enums"]["ingredient_kind"]
          low_stock_threshold?: number | null
          name_ar?: string
          name_en?: string
          pack_cost_iqd?: number | null
          pack_size?: number | null
          par_level?: number | null
          shelf_life_days?: number | null
          supplier_id?: string | null
          supplier_name?: string | null
          unit?: Database["public"]["Enums"]["stock_unit"]
          variant_id?: string | null
          venue_id?: string
          waste_allowance_percent?: number
          yield_percent?: number
        }
        Relationships: [
          {
            foreignKeyName: "ingredients_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ingredients_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: true
            referencedRelation: "menu_item_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ingredients_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: true
            referencedRelation: "v_item_cogs"
            referencedColumns: ["variant_id"]
          },
          {
            foreignKeyName: "ingredients_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: true
            referencedRelation: "v_item_margin"
            referencedColumns: ["variant_id"]
          },
          {
            foreignKeyName: "ingredients_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      lesson_attendance: {
        Row: {
          enrolment_id: string
          lesson_id: string
          marked_at: string
          marked_by_kind: string
          marked_by_profile_id: string | null
          marked_by_staff_id: string | null
          status: string
          venue_id: string
        }
        Insert: {
          enrolment_id: string
          lesson_id: string
          marked_at?: string
          marked_by_kind: string
          marked_by_profile_id?: string | null
          marked_by_staff_id?: string | null
          status: string
          venue_id: string
        }
        Update: {
          enrolment_id?: string
          lesson_id?: string
          marked_at?: string
          marked_by_kind?: string
          marked_by_profile_id?: string | null
          marked_by_staff_id?: string | null
          status?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lesson_attendance_enrolment_id_fkey"
            columns: ["enrolment_id"]
            isOneToOne: false
            referencedRelation: "lesson_enrolments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lesson_attendance_lesson_id_fkey"
            columns: ["lesson_id"]
            isOneToOne: false
            referencedRelation: "lessons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lesson_attendance_marked_by_profile_id_fkey"
            columns: ["marked_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lesson_attendance_marked_by_staff_id_fkey"
            columns: ["marked_by_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lesson_attendance_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      lesson_enrolments: {
        Row: {
          booked_by_kind: string
          booked_by_profile_id: string | null
          booked_by_staff_id: string | null
          cancel_kind: string | null
          cancelled_at: string | null
          course_id: string | null
          created_at: string
          first_session_no: number | null
          friend_names: string[]
          guest_id: string | null
          guest_name: string | null
          guest_phone: string | null
          hold_expires_at: string | null
          id: string
          idempotency_key: string | null
          lesson_id: string | null
          link_confirmed_at: string | null
          party_size: number
          payment_mode: string
          price_iqd: number
          refunded_outside_iqd: number
          sessions_covered: number | null
          status: string
          updated_at: string
          venue_id: string
        }
        Insert: {
          booked_by_kind: string
          booked_by_profile_id?: string | null
          booked_by_staff_id?: string | null
          cancel_kind?: string | null
          cancelled_at?: string | null
          course_id?: string | null
          created_at?: string
          first_session_no?: number | null
          friend_names?: string[]
          guest_id?: string | null
          guest_name?: string | null
          guest_phone?: string | null
          hold_expires_at?: string | null
          id?: string
          idempotency_key?: string | null
          lesson_id?: string | null
          link_confirmed_at?: string | null
          party_size?: number
          payment_mode: string
          price_iqd: number
          refunded_outside_iqd?: number
          sessions_covered?: number | null
          status?: string
          updated_at?: string
          venue_id: string
        }
        Update: {
          booked_by_kind?: string
          booked_by_profile_id?: string | null
          booked_by_staff_id?: string | null
          cancel_kind?: string | null
          cancelled_at?: string | null
          course_id?: string | null
          created_at?: string
          first_session_no?: number | null
          friend_names?: string[]
          guest_id?: string | null
          guest_name?: string | null
          guest_phone?: string | null
          hold_expires_at?: string | null
          id?: string
          idempotency_key?: string | null
          lesson_id?: string | null
          link_confirmed_at?: string | null
          party_size?: number
          payment_mode?: string
          price_iqd?: number
          refunded_outside_iqd?: number
          sessions_covered?: number | null
          status?: string
          updated_at?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lesson_enrolments_booked_by_profile_id_fkey"
            columns: ["booked_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lesson_enrolments_booked_by_staff_id_fkey"
            columns: ["booked_by_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lesson_enrolments_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lesson_enrolments_guest_id_fkey"
            columns: ["guest_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lesson_enrolments_lesson_id_fkey"
            columns: ["lesson_id"]
            isOneToOne: false
            referencedRelation: "lessons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lesson_enrolments_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      lesson_events: {
        Row: {
          actor: string
          actor_profile_id: string | null
          actor_staff_id: string | null
          at: string
          code: string | null
          course_id: string | null
          data: Json
          enrolment_id: string | null
          id: number
          lesson_id: string | null
          type: string
          venue_id: string
        }
        Insert: {
          actor: string
          actor_profile_id?: string | null
          actor_staff_id?: string | null
          at?: string
          code?: string | null
          course_id?: string | null
          data?: Json
          enrolment_id?: string | null
          id?: never
          lesson_id?: string | null
          type: string
          venue_id: string
        }
        Update: {
          actor?: string
          actor_profile_id?: string | null
          actor_staff_id?: string | null
          at?: string
          code?: string | null
          course_id?: string | null
          data?: Json
          enrolment_id?: string | null
          id?: never
          lesson_id?: string | null
          type?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lesson_events_actor_profile_id_fkey"
            columns: ["actor_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lesson_events_actor_staff_id_fkey"
            columns: ["actor_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lesson_events_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lesson_events_enrolment_id_fkey"
            columns: ["enrolment_id"]
            isOneToOne: false
            referencedRelation: "lesson_enrolments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lesson_events_lesson_id_fkey"
            columns: ["lesson_id"]
            isOneToOne: false
            referencedRelation: "lessons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lesson_events_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      lesson_strikes: {
        Row: {
          counted: boolean | null
          enrolment_id: string
          guest_id: string
          kind: string
          lesson_id: string
          settled_at: string | null
          struck_at: string
          venue_id: string
        }
        Insert: {
          counted?: boolean | null
          enrolment_id: string
          guest_id: string
          kind: string
          lesson_id: string
          settled_at?: string | null
          struck_at?: string
          venue_id: string
        }
        Update: {
          counted?: boolean | null
          enrolment_id?: string
          guest_id?: string
          kind?: string
          lesson_id?: string
          settled_at?: string | null
          struck_at?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lesson_strikes_enrolment_id_fkey"
            columns: ["enrolment_id"]
            isOneToOne: false
            referencedRelation: "lesson_enrolments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lesson_strikes_guest_id_fkey"
            columns: ["guest_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lesson_strikes_lesson_id_fkey"
            columns: ["lesson_id"]
            isOneToOne: false
            referencedRelation: "lessons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lesson_strikes_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      lesson_types: {
        Row: {
          court_share_iqd: number
          created_at: string
          created_by_staff_id: string | null
          cutoff_hours: number
          description_ar: string
          description_en: string
          duration_min: number
          id: string
          is_active: boolean
          kind: string
          launched_at: string | null
          max_places: number
          min_places: number
          name_ar: string
          name_en: string
          price_iqd: number | null
          sessions_count: number | null
          sort_order: number
          updated_at: string
          venue_id: string
        }
        Insert: {
          court_share_iqd?: number
          created_at?: string
          created_by_staff_id?: string | null
          cutoff_hours?: number
          description_ar?: string
          description_en?: string
          duration_min: number
          id?: string
          is_active?: boolean
          kind: string
          launched_at?: string | null
          max_places: number
          min_places?: number
          name_ar: string
          name_en: string
          price_iqd?: number | null
          sessions_count?: number | null
          sort_order?: number
          updated_at?: string
          venue_id: string
        }
        Update: {
          court_share_iqd?: number
          created_at?: string
          created_by_staff_id?: string | null
          cutoff_hours?: number
          description_ar?: string
          description_en?: string
          duration_min?: number
          id?: string
          is_active?: boolean
          kind?: string
          launched_at?: string | null
          max_places?: number
          min_places?: number
          name_ar?: string
          name_en?: string
          price_iqd?: number | null
          sessions_count?: number | null
          sort_order?: number
          updated_at?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lesson_types_created_by_staff_id_fkey"
            columns: ["created_by_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lesson_types_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      lessons: {
        Row: {
          booked_by_kind: string
          cancel_reason: string | null
          cancelled_at: string | null
          coach_id: string
          coach_share_bp: number
          completed_at: string | null
          course_id: string | null
          court_share_iqd: number
          created_at: string
          created_by_profile_id: string | null
          created_by_staff_id: string | null
          cutoff_at: string | null
          cutoff_checked_at: string | null
          end_at: string
          hold_expires_at: string | null
          id: string
          idempotency_key: string | null
          kind: string
          lesson_type_id: string
          max_places: number
          min_places: number
          period: unknown
          price_iqd: number | null
          rescheduled_at: string | null
          session_no: number | null
          start_at: string
          status: string
          updated_at: string
          venue_id: string
        }
        Insert: {
          booked_by_kind: string
          cancel_reason?: string | null
          cancelled_at?: string | null
          coach_id: string
          coach_share_bp: number
          completed_at?: string | null
          course_id?: string | null
          court_share_iqd: number
          created_at?: string
          created_by_profile_id?: string | null
          created_by_staff_id?: string | null
          cutoff_at?: string | null
          cutoff_checked_at?: string | null
          end_at: string
          hold_expires_at?: string | null
          id?: string
          idempotency_key?: string | null
          kind: string
          lesson_type_id: string
          max_places: number
          min_places: number
          period?: unknown
          price_iqd?: number | null
          rescheduled_at?: string | null
          session_no?: number | null
          start_at: string
          status?: string
          updated_at?: string
          venue_id: string
        }
        Update: {
          booked_by_kind?: string
          cancel_reason?: string | null
          cancelled_at?: string | null
          coach_id?: string
          coach_share_bp?: number
          completed_at?: string | null
          course_id?: string | null
          court_share_iqd?: number
          created_at?: string
          created_by_profile_id?: string | null
          created_by_staff_id?: string | null
          cutoff_at?: string | null
          cutoff_checked_at?: string | null
          end_at?: string
          hold_expires_at?: string | null
          id?: string
          idempotency_key?: string | null
          kind?: string
          lesson_type_id?: string
          max_places?: number
          min_places?: number
          period?: unknown
          price_iqd?: number | null
          rescheduled_at?: string | null
          session_no?: number | null
          start_at?: string
          status?: string
          updated_at?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lessons_coach_id_fkey"
            columns: ["coach_id"]
            isOneToOne: false
            referencedRelation: "coaches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lessons_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lessons_created_by_profile_id_fkey"
            columns: ["created_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lessons_created_by_staff_id_fkey"
            columns: ["created_by_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lessons_lesson_type_id_fkey"
            columns: ["lesson_type_id"]
            isOneToOne: false
            referencedRelation: "lesson_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lessons_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      llm_usage: {
        Row: {
          cache_read_tokens: number
          cache_write_tokens: number
          completion_tokens: number
          cost_micros: number
          model_calls: number
          prompt_tokens: number
          requests: number
          updated_at: string
          usage_date: string
        }
        Insert: {
          cache_read_tokens?: number
          cache_write_tokens?: number
          completion_tokens?: number
          cost_micros?: number
          model_calls?: number
          prompt_tokens?: number
          requests?: number
          updated_at?: string
          usage_date: string
        }
        Update: {
          cache_read_tokens?: number
          cache_write_tokens?: number
          completion_tokens?: number
          cost_micros?: number
          model_calls?: number
          prompt_tokens?: number
          requests?: number
          updated_at?: string
          usage_date?: string
        }
        Relationships: []
      }
      manager_alerts: {
        Row: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          created_at: string
          id: string
          kind: Database["public"]["Enums"]["alert_kind"]
          payload: Json
          venue_id: string
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          created_at?: string
          id?: string
          kind: Database["public"]["Enums"]["alert_kind"]
          payload: Json
          venue_id?: string
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["alert_kind"]
          payload?: Json
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "manager_alerts_acknowledged_by_fkey"
            columns: ["acknowledged_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manager_alerts_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      marketing_audiences: {
        Row: {
          created_at: string
          created_by: string
          id: string
          name_ar: string
          name_en: string
          rule: Json
          updated_at: string
          venue_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          name_ar: string
          name_en: string
          rule?: Json
          updated_at?: string
          venue_id?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          name_ar?: string
          name_en?: string
          rule?: Json
          updated_at?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "marketing_audiences_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketing_audiences_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      marketing_campaigns: {
        Row: {
          audience_id: string | null
          body_ar: string
          body_en: string
          channel: Database["public"]["Enums"]["marketing_channel"]
          created_at: string
          created_by: string
          ends_at: string | null
          id: string
          images: string[]
          menu_item_id: string | null
          name_ar: string
          name_en: string
          promotion_id: string | null
          protocol_run_id: string | null
          starts_at: string | null
          status: Database["public"]["Enums"]["campaign_status"]
          suggested_at: string | null
          suggested_by: string | null
          suggestion_note: string | null
          updated_at: string
          venue_id: string
        }
        Insert: {
          audience_id?: string | null
          body_ar?: string
          body_en?: string
          channel: Database["public"]["Enums"]["marketing_channel"]
          created_at?: string
          created_by: string
          ends_at?: string | null
          id?: string
          images?: string[]
          menu_item_id?: string | null
          name_ar: string
          name_en: string
          promotion_id?: string | null
          protocol_run_id?: string | null
          starts_at?: string | null
          status?: Database["public"]["Enums"]["campaign_status"]
          suggested_at?: string | null
          suggested_by?: string | null
          suggestion_note?: string | null
          updated_at?: string
          venue_id?: string
        }
        Update: {
          audience_id?: string | null
          body_ar?: string
          body_en?: string
          channel?: Database["public"]["Enums"]["marketing_channel"]
          created_at?: string
          created_by?: string
          ends_at?: string | null
          id?: string
          images?: string[]
          menu_item_id?: string | null
          name_ar?: string
          name_en?: string
          promotion_id?: string | null
          protocol_run_id?: string | null
          starts_at?: string | null
          status?: Database["public"]["Enums"]["campaign_status"]
          suggested_at?: string | null
          suggested_by?: string | null
          suggestion_note?: string | null
          updated_at?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "marketing_campaigns_audience_id_fkey"
            columns: ["audience_id"]
            isOneToOne: false
            referencedRelation: "marketing_audiences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketing_campaigns_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketing_campaigns_menu_item_id_fkey"
            columns: ["menu_item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketing_campaigns_promotion_id_fkey"
            columns: ["promotion_id"]
            isOneToOne: false
            referencedRelation: "promotions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketing_campaigns_protocol_run_id_fkey"
            columns: ["protocol_run_id"]
            isOneToOne: false
            referencedRelation: "protocol_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketing_campaigns_suggested_by_fkey"
            columns: ["suggested_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketing_campaigns_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      marketing_content: {
        Row: {
          author_id: string
          campaign_id: string | null
          channel: string
          created_at: string
          current_version: number
          decided_at: string | null
          decided_by: string | null
          id: string
          menu_item_id: string | null
          planned_for: string
          status: string
          title: string
          updated_at: string
          venue_id: string
        }
        Insert: {
          author_id: string
          campaign_id?: string | null
          channel: string
          created_at?: string
          current_version?: number
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          menu_item_id?: string | null
          planned_for: string
          status?: string
          title: string
          updated_at?: string
          venue_id: string
        }
        Update: {
          author_id?: string
          campaign_id?: string | null
          channel?: string
          created_at?: string
          current_version?: number
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          menu_item_id?: string | null
          planned_for?: string
          status?: string
          title?: string
          updated_at?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "marketing_content_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketing_content_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "marketing_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketing_content_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketing_content_menu_item_id_fkey"
            columns: ["menu_item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketing_content_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      marketing_content_versions: {
        Row: {
          body: string
          content_id: string
          decided_at: string | null
          decided_by: string | null
          decision: string | null
          decision_note: string | null
          id: string
          images: string[]
          media_link: string | null
          note: string | null
          submitted_at: string
          submitted_by: string
          superseded_at: string | null
          version: number
        }
        Insert: {
          body: string
          content_id: string
          decided_at?: string | null
          decided_by?: string | null
          decision?: string | null
          decision_note?: string | null
          id?: string
          images?: string[]
          media_link?: string | null
          note?: string | null
          submitted_at?: string
          submitted_by: string
          superseded_at?: string | null
          version: number
        }
        Update: {
          body?: string
          content_id?: string
          decided_at?: string | null
          decided_by?: string | null
          decision?: string | null
          decision_note?: string | null
          id?: string
          images?: string[]
          media_link?: string | null
          note?: string | null
          submitted_at?: string
          submitted_by?: string
          superseded_at?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "marketing_content_versions_content_id_fkey"
            columns: ["content_id"]
            isOneToOne: false
            referencedRelation: "marketing_content"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketing_content_versions_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketing_content_versions_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      marketing_notes: {
        Row: {
          author_id: string
          body: string
          created_at: string
          id: string
          photos: string[]
          subject_id: string
          subject_kind: string
          venue_id: string
        }
        Insert: {
          author_id: string
          body: string
          created_at?: string
          id?: string
          photos?: string[]
          subject_id: string
          subject_kind: string
          venue_id: string
        }
        Update: {
          author_id?: string
          body?: string
          created_at?: string
          id?: string
          photos?: string[]
          subject_id?: string
          subject_kind?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "marketing_notes_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketing_notes_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      marketing_requests: {
        Row: {
          answer: string | null
          answered_at: string | null
          answered_by: string | null
          body: string
          created_at: string
          id: string
          menu_item_id: string | null
          photos: string[]
          requested_by: string
          status: string
          title: string
          venue_id: string
          want_by: string | null
        }
        Insert: {
          answer?: string | null
          answered_at?: string | null
          answered_by?: string | null
          body: string
          created_at?: string
          id?: string
          menu_item_id?: string | null
          photos?: string[]
          requested_by: string
          status?: string
          title: string
          venue_id: string
          want_by?: string | null
        }
        Update: {
          answer?: string | null
          answered_at?: string | null
          answered_by?: string | null
          body?: string
          created_at?: string
          id?: string
          menu_item_id?: string | null
          photos?: string[]
          requested_by?: string
          status?: string
          title?: string
          venue_id?: string
          want_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "marketing_requests_answered_by_fkey"
            columns: ["answered_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketing_requests_menu_item_id_fkey"
            columns: ["menu_item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketing_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketing_requests_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      marketing_sends: {
        Row: {
          at: string
          campaign_id: string
          delivered: number
          failed: number
          id: string
          meta: Json
          recipients: number
        }
        Insert: {
          at?: string
          campaign_id: string
          delivered?: number
          failed?: number
          id?: string
          meta?: Json
          recipients?: number
        }
        Update: {
          at?: string
          campaign_id?: string
          delivered?: number
          failed?: number
          id?: string
          meta?: Json
          recipients?: number
        }
        Relationships: [
          {
            foreignKeyName: "marketing_sends_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "marketing_campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      match_blocks: {
        Row: {
          blocked_id: string
          blocker_id: string
          created_at: string
          id: string
        }
        Insert: {
          blocked_id: string
          blocker_id: string
          created_at?: string
          id?: string
        }
        Update: {
          blocked_id?: string
          blocker_id?: string
          created_at?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "match_blocks_blocked_id_fkey"
            columns: ["blocked_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_blocks_blocker_id_fkey"
            columns: ["blocker_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      match_events: {
        Row: {
          actor: string
          actor_guest_id: string | null
          actor_staff_id: string | null
          at: string
          code: string | null
          data: Json
          id: number
          match_id: string
          request_id: string | null
          seat_id: string | null
          type: string
          venue_id: string
        }
        Insert: {
          actor: string
          actor_guest_id?: string | null
          actor_staff_id?: string | null
          at?: string
          code?: string | null
          data?: Json
          id?: never
          match_id: string
          request_id?: string | null
          seat_id?: string | null
          type: string
          venue_id: string
        }
        Update: {
          actor?: string
          actor_guest_id?: string | null
          actor_staff_id?: string | null
          at?: string
          code?: string | null
          data?: Json
          id?: never
          match_id?: string
          request_id?: string | null
          seat_id?: string | null
          type?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "match_events_actor_guest_id_fkey"
            columns: ["actor_guest_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_events_actor_staff_id_fkey"
            columns: ["actor_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_events_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_events_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "match_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_events_seat_id_fkey"
            columns: ["seat_id"]
            isOneToOne: false
            referencedRelation: "match_seats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_events_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      match_exclusions: {
        Row: {
          created_at: string
          guest_id: string
          match_id: string
          reason: string
          venue_id: string
        }
        Insert: {
          created_at?: string
          guest_id: string
          match_id: string
          reason: string
          venue_id: string
        }
        Update: {
          created_at?: string
          guest_id?: string
          match_id?: string
          reason?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "match_exclusions_guest_id_fkey"
            columns: ["guest_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_exclusions_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_exclusions_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      match_reports: {
        Row: {
          created_at: string
          id: string
          match_id: string
          reason: string
          reported_id: string
          reporter_id: string
          request_id: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          seat_id: string | null
          status: string
          venue_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          match_id: string
          reason: string
          reported_id: string
          reporter_id: string
          request_id?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          seat_id?: string | null
          status?: string
          venue_id: string
        }
        Update: {
          created_at?: string
          id?: string
          match_id?: string
          reason?: string
          reported_id?: string
          reporter_id?: string
          request_id?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          seat_id?: string | null
          status?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "match_reports_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_reports_reported_id_fkey"
            columns: ["reported_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_reports_reporter_id_fkey"
            columns: ["reporter_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_reports_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "match_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_reports_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_reports_seat_id_fkey"
            columns: ["seat_id"]
            isOneToOne: false
            referencedRelation: "match_seats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_reports_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      match_requests: {
        Row: {
          created_at: string
          decided_at: string | null
          friend_genders: string[] | null
          guest_id: string
          id: string
          match_id: string
          seats_requested: number
          status: string
          venue_id: string
        }
        Insert: {
          created_at?: string
          decided_at?: string | null
          friend_genders?: string[] | null
          guest_id: string
          id?: string
          match_id: string
          seats_requested: number
          status?: string
          venue_id: string
        }
        Update: {
          created_at?: string
          decided_at?: string | null
          friend_genders?: string[] | null
          guest_id?: string
          id?: string
          match_id?: string
          seats_requested?: number
          status?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "match_requests_guest_id_fkey"
            columns: ["guest_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_requests_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_requests_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      match_seats: {
        Row: {
          created_by_staff_id: string | null
          end_reason: string | null
          ended_at: string | null
          gender: string | null
          guest_id: string | null
          guest_name: string | null
          guest_phone: string | null
          id: string
          joined_at: string
          kind: string
          marked_at: string | null
          marked_by_staff_id: string | null
          match_id: string
          replaces_seat_id: string | null
          request_id: string | null
          seat_no: number
          share_iqd: number
          status: string
          ticket_id: string | null
          venue_id: string
          vouched: boolean | null
          write_off_reason: string | null
          written_off_at: string | null
          written_off_by_staff_id: string | null
        }
        Insert: {
          created_by_staff_id?: string | null
          end_reason?: string | null
          ended_at?: string | null
          gender?: string | null
          guest_id?: string | null
          guest_name?: string | null
          guest_phone?: string | null
          id?: string
          joined_at?: string
          kind: string
          marked_at?: string | null
          marked_by_staff_id?: string | null
          match_id: string
          replaces_seat_id?: string | null
          request_id?: string | null
          seat_no: number
          share_iqd: number
          status?: string
          ticket_id?: string | null
          venue_id: string
          vouched?: boolean | null
          write_off_reason?: string | null
          written_off_at?: string | null
          written_off_by_staff_id?: string | null
        }
        Update: {
          created_by_staff_id?: string | null
          end_reason?: string | null
          ended_at?: string | null
          gender?: string | null
          guest_id?: string | null
          guest_name?: string | null
          guest_phone?: string | null
          id?: string
          joined_at?: string
          kind?: string
          marked_at?: string | null
          marked_by_staff_id?: string | null
          match_id?: string
          replaces_seat_id?: string | null
          request_id?: string | null
          seat_no?: number
          share_iqd?: number
          status?: string
          ticket_id?: string | null
          venue_id?: string
          vouched?: boolean | null
          write_off_reason?: string | null
          written_off_at?: string | null
          written_off_by_staff_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "match_seats_created_by_staff_id_fkey"
            columns: ["created_by_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_seats_guest_id_fkey"
            columns: ["guest_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_seats_marked_by_staff_id_fkey"
            columns: ["marked_by_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_seats_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_seats_replaces_seat_id_fkey"
            columns: ["replaces_seat_id"]
            isOneToOne: false
            referencedRelation: "match_seats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_seats_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "match_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_seats_ticket_fk"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "match_tickets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_seats_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_seats_written_off_by_staff_id_fkey"
            columns: ["written_off_by_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      match_ticket_events: {
        Row: {
          actor_staff_id: string | null
          at: string
          code: string | null
          guest_id: string
          id: number
          match_id: string | null
          payment_id: string | null
          request_id: string | null
          seat_id: string | null
          ticket_id: string
          type: string
          venue_id: string | null
        }
        Insert: {
          actor_staff_id?: string | null
          at?: string
          code?: string | null
          guest_id: string
          id?: never
          match_id?: string | null
          payment_id?: string | null
          request_id?: string | null
          seat_id?: string | null
          ticket_id: string
          type: string
          venue_id?: string | null
        }
        Update: {
          actor_staff_id?: string | null
          at?: string
          code?: string | null
          guest_id?: string
          id?: never
          match_id?: string | null
          payment_id?: string | null
          request_id?: string | null
          seat_id?: string | null
          ticket_id?: string
          type?: string
          venue_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "match_ticket_events_actor_staff_id_fkey"
            columns: ["actor_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_ticket_events_guest_id_fkey"
            columns: ["guest_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_ticket_events_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_ticket_events_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "booking_payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_ticket_events_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "match_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_ticket_events_seat_id_fkey"
            columns: ["seat_id"]
            isOneToOne: false
            referencedRelation: "match_seats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_ticket_events_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "match_tickets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_ticket_events_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      match_tickets: {
        Row: {
          cashed_out_at: string | null
          cashout_payment_id: string | null
          created_at: string
          forfeited_at: string | null
          forfeited_seat_id: string | null
          forfeited_venue_id: string | null
          guest_id: string
          id: string
          price_iqd: number
          purchase_payment_id: string
          request_id: string | null
          sandbox: boolean
          seat_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          cashed_out_at?: string | null
          cashout_payment_id?: string | null
          created_at?: string
          forfeited_at?: string | null
          forfeited_seat_id?: string | null
          forfeited_venue_id?: string | null
          guest_id: string
          id?: string
          price_iqd: number
          purchase_payment_id: string
          request_id?: string | null
          sandbox: boolean
          seat_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          cashed_out_at?: string | null
          cashout_payment_id?: string | null
          created_at?: string
          forfeited_at?: string | null
          forfeited_seat_id?: string | null
          forfeited_venue_id?: string | null
          guest_id?: string
          id?: string
          price_iqd?: number
          purchase_payment_id?: string
          request_id?: string | null
          sandbox?: boolean
          seat_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "match_tickets_cashout_payment_id_fkey"
            columns: ["cashout_payment_id"]
            isOneToOne: false
            referencedRelation: "booking_payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_tickets_forfeited_seat_id_fkey"
            columns: ["forfeited_seat_id"]
            isOneToOne: false
            referencedRelation: "match_seats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_tickets_forfeited_venue_id_fkey"
            columns: ["forfeited_venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_tickets_guest_id_fkey"
            columns: ["guest_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_tickets_purchase_payment_id_fkey"
            columns: ["purchase_payment_id"]
            isOneToOne: false
            referencedRelation: "booking_payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_tickets_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "match_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_tickets_seat_id_fkey"
            columns: ["seat_id"]
            isOneToOne: false
            referencedRelation: "match_seats"
            referencedColumns: ["id"]
          },
        ]
      }
      matches: {
        Row: {
          category: string
          created_at: string
          created_by_staff_id: string | null
          deadline_warned_at: string | null
          duration_min: number
          end_at: string
          ended_at: string | null
          ended_reason: string | null
          fill_deadline_at: string
          id: string
          idempotency_key: string | null
          join_policy: string
          organised_by: string
          organiser_id: string | null
          period: unknown
          price_court_id: string
          price_iqd: number
          rate_rule_id: string | null
          reservation_id: string | null
          sandbox: boolean
          share_token: string
          shares_iqd: number[]
          start_at: string
          status: string
          updated_at: string
          venue_id: string
          visibility: string
        }
        Insert: {
          category: string
          created_at?: string
          created_by_staff_id?: string | null
          deadline_warned_at?: string | null
          duration_min: number
          end_at: string
          ended_at?: string | null
          ended_reason?: string | null
          fill_deadline_at: string
          id?: string
          idempotency_key?: string | null
          join_policy: string
          organised_by: string
          organiser_id?: string | null
          period?: unknown
          price_court_id: string
          price_iqd: number
          rate_rule_id?: string | null
          reservation_id?: string | null
          sandbox?: boolean
          share_token: string
          shares_iqd: number[]
          start_at: string
          status?: string
          updated_at?: string
          venue_id: string
          visibility: string
        }
        Update: {
          category?: string
          created_at?: string
          created_by_staff_id?: string | null
          deadline_warned_at?: string | null
          duration_min?: number
          end_at?: string
          ended_at?: string | null
          ended_reason?: string | null
          fill_deadline_at?: string
          id?: string
          idempotency_key?: string | null
          join_policy?: string
          organised_by?: string
          organiser_id?: string | null
          period?: unknown
          price_court_id?: string
          price_iqd?: number
          rate_rule_id?: string | null
          reservation_id?: string | null
          sandbox?: boolean
          share_token?: string
          shares_iqd?: number[]
          start_at?: string
          status?: string
          updated_at?: string
          venue_id?: string
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "matches_created_by_staff_id_fkey"
            columns: ["created_by_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_organiser_id_fkey"
            columns: ["organiser_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_price_court_id_fkey"
            columns: ["price_court_id"]
            isOneToOne: false
            referencedRelation: "courts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_rate_rule_id_fkey"
            columns: ["rate_rule_id"]
            isOneToOne: false
            referencedRelation: "rate_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_reservation_id_fkey"
            columns: ["reservation_id"]
            isOneToOne: false
            referencedRelation: "reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_aliases: {
        Row: {
          alias_norm: string
          created_at: string
          created_by: string | null
          id: string
          last_used_at: string
          uses: number
          variant_id: string
          venue_id: string
        }
        Insert: {
          alias_norm: string
          created_at?: string
          created_by?: string | null
          id?: string
          last_used_at?: string
          uses?: number
          variant_id: string
          venue_id: string
        }
        Update: {
          alias_norm?: string
          created_at?: string
          created_by?: string | null
          id?: string
          last_used_at?: string
          uses?: number
          variant_id?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "menu_aliases_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_aliases_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "menu_item_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_aliases_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "v_item_cogs"
            referencedColumns: ["variant_id"]
          },
          {
            foreignKeyName: "menu_aliases_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "v_item_margin"
            referencedColumns: ["variant_id"]
          },
          {
            foreignKeyName: "menu_aliases_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_categories: {
        Row: {
          id: string
          is_active: boolean
          kind: string
          name_ar: string
          name_en: string
          photo_blur: string | null
          photo_path: string | null
          serve_temp: string
          sort_order: number
          tax_group_id: string
          venue_id: string
        }
        Insert: {
          id?: string
          is_active?: boolean
          kind?: string
          name_ar: string
          name_en: string
          photo_blur?: string | null
          photo_path?: string | null
          serve_temp?: string
          sort_order?: number
          tax_group_id: string
          venue_id?: string
        }
        Update: {
          id?: string
          is_active?: boolean
          kind?: string
          name_ar?: string
          name_en?: string
          photo_blur?: string | null
          photo_path?: string | null
          serve_temp?: string
          sort_order?: number
          tax_group_id?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "menu_categories_tax_group_id_fkey"
            columns: ["tax_group_id"]
            isOneToOne: false
            referencedRelation: "tax_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_categories_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_item_allergens: {
        Row: {
          allergen_id: string
          item_id: string
        }
        Insert: {
          allergen_id: string
          item_id: string
        }
        Update: {
          allergen_id?: string
          item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "menu_item_allergens_allergen_id_fkey"
            columns: ["allergen_id"]
            isOneToOne: false
            referencedRelation: "allergens"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_item_allergens_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_item_costs: {
        Row: {
          cost_iqd: number
          item_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          cost_iqd: number
          item_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          cost_iqd?: number
          item_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "menu_item_costs_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: true
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_item_costs_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_item_modifier_groups: {
        Row: {
          group_id: string
          item_id: string
          sort_order: number
        }
        Insert: {
          group_id: string
          item_id: string
          sort_order?: number
        }
        Update: {
          group_id?: string
          item_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "menu_item_modifier_groups_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "modifier_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_item_modifier_groups_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_item_variants: {
        Row: {
          barcode: string | null
          id: string
          is_default: boolean
          item_id: string
          name_ar: string
          name_en: string
          price_iqd: number
          sku: string | null
          sort_order: number
        }
        Insert: {
          barcode?: string | null
          id?: string
          is_default?: boolean
          item_id: string
          name_ar: string
          name_en: string
          price_iqd: number
          sku?: string | null
          sort_order?: number
        }
        Update: {
          barcode?: string | null
          id?: string
          is_default?: boolean
          item_id?: string
          name_ar?: string
          name_en?: string
          price_iqd?: number
          sku?: string | null
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "menu_item_variants_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_items: {
        Row: {
          category_id: string
          description_ar: string | null
          description_en: string | null
          highlight: string
          hook_ar: string
          hook_en: string
          id: string
          is_active: boolean
          launched_at: string | null
          name_ar: string
          name_en: string
          photo_blur: string | null
          photo_path: string | null
          release_run_id: string | null
          serve_temp: string
          sold_out: boolean
          sort_order: number
          unavailable_on: string | null
          venue_id: string
        }
        Insert: {
          category_id: string
          description_ar?: string | null
          description_en?: string | null
          highlight?: string
          hook_ar?: string
          hook_en?: string
          id?: string
          is_active?: boolean
          launched_at?: string | null
          name_ar: string
          name_en: string
          photo_blur?: string | null
          photo_path?: string | null
          release_run_id?: string | null
          serve_temp?: string
          sold_out?: boolean
          sort_order?: number
          unavailable_on?: string | null
          venue_id?: string
        }
        Update: {
          category_id?: string
          description_ar?: string | null
          description_en?: string | null
          highlight?: string
          hook_ar?: string
          hook_en?: string
          id?: string
          is_active?: boolean
          launched_at?: string | null
          name_ar?: string
          name_en?: string
          photo_blur?: string | null
          photo_path?: string | null
          release_run_id?: string | null
          serve_temp?: string
          sold_out?: boolean
          sort_order?: number
          unavailable_on?: string | null
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "menu_items_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "menu_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_items_release_run_id_fkey"
            columns: ["release_run_id"]
            isOneToOne: false
            referencedRelation: "protocol_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_items_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      modifier_groups: {
        Row: {
          id: string
          max_select: number
          min_select: number
          name_ar: string
          name_en: string
          venue_id: string
        }
        Insert: {
          id?: string
          max_select?: number
          min_select?: number
          name_ar: string
          name_en: string
          venue_id?: string
        }
        Update: {
          id?: string
          max_select?: number
          min_select?: number
          name_ar?: string
          name_en?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "modifier_groups_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      modifier_reveals: {
        Row: {
          group_id: string
          modifier_id: string
          sort_order: number
        }
        Insert: {
          group_id: string
          modifier_id: string
          sort_order?: number
        }
        Update: {
          group_id?: string
          modifier_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "modifier_reveals_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "modifier_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "modifier_reveals_modifier_id_fkey"
            columns: ["modifier_id"]
            isOneToOne: false
            referencedRelation: "modifiers"
            referencedColumns: ["id"]
          },
        ]
      }
      modifiers: {
        Row: {
          group_id: string
          id: string
          is_active: boolean
          launched_at: string | null
          name_ar: string
          name_en: string
          price_delta_iqd: number
          sort_order: number
        }
        Insert: {
          group_id: string
          id?: string
          is_active?: boolean
          launched_at?: string | null
          name_ar: string
          name_en: string
          price_delta_iqd?: number
          sort_order?: number
        }
        Update: {
          group_id?: string
          id?: string
          is_active?: boolean
          launched_at?: string | null
          name_ar?: string
          name_en?: string
          price_delta_iqd?: number
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "modifiers_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "modifier_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_outbox: {
        Row: {
          attempts: number
          claimed_at: string | null
          created_at: string
          id: number
          kind: string
          last_error: string | null
          payload: Json
          profile_id: string
          scheduled_for: string
          sent_at: string | null
        }
        Insert: {
          attempts?: number
          claimed_at?: string | null
          created_at?: string
          id?: never
          kind: string
          last_error?: string | null
          payload: Json
          profile_id: string
          scheduled_for?: string
          sent_at?: string | null
        }
        Update: {
          attempts?: number
          claimed_at?: string | null
          created_at?: string
          id?: never
          kind?: string
          last_error?: string | null
          payload?: Json
          profile_id?: string
          scheduled_for?: string
          sent_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notification_outbox_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      order_item_modifiers: {
        Row: {
          modifier_id: string
          order_item_id: string
          price_delta_iqd: number
          qty: number
        }
        Insert: {
          modifier_id: string
          order_item_id: string
          price_delta_iqd: number
          qty?: number
        }
        Update: {
          modifier_id?: string
          order_item_id?: string
          price_delta_iqd?: number
          qty?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_item_modifiers_modifier_id_fkey"
            columns: ["modifier_id"]
            isOneToOne: false
            referencedRelation: "modifiers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_item_modifiers_order_item_id_fkey"
            columns: ["order_item_id"]
            isOneToOne: false
            referencedRelation: "order_items"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          cost_iqd: number | null
          discount_pct: number
          discount_source: string | null
          id: string
          line_no: number
          line_total_iqd: number
          list_price_iqd: number | null
          menu_item_id: string
          notes: string | null
          order_id: string
          qty: number
          ready_at: string | null
          unit_price_iqd: number
          variant_id: string
          void_reason_code: string | null
          voided: boolean
        }
        Insert: {
          cost_iqd?: number | null
          discount_pct?: number
          discount_source?: string | null
          id?: string
          line_no: number
          line_total_iqd: number
          list_price_iqd?: number | null
          menu_item_id: string
          notes?: string | null
          order_id: string
          qty: number
          ready_at?: string | null
          unit_price_iqd: number
          variant_id: string
          void_reason_code?: string | null
          voided?: boolean
        }
        Update: {
          cost_iqd?: number | null
          discount_pct?: number
          discount_source?: string | null
          id?: string
          line_no?: number
          line_total_iqd?: number
          list_price_iqd?: number | null
          menu_item_id?: string
          notes?: string | null
          order_id?: string
          qty?: number
          ready_at?: string | null
          unit_price_iqd?: number
          variant_id?: string
          void_reason_code?: string | null
          voided?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "order_items_menu_item_id_fkey"
            columns: ["menu_item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "menu_item_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "v_item_cogs"
            referencedColumns: ["variant_id"]
          },
          {
            foreignKeyName: "order_items_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "v_item_margin"
            referencedColumns: ["variant_id"]
          },
        ]
      }
      order_slip_lines: {
        Row: {
          confidence: number | null
          flags: string[]
          id: string
          line_no: number
          match_source: string
          notes_read: string | null
          qty_read: number | null
          slip_id: string
          text_read: string
          variant_id: string | null
        }
        Insert: {
          confidence?: number | null
          flags?: string[]
          id?: string
          line_no: number
          match_source?: string
          notes_read?: string | null
          qty_read?: number | null
          slip_id: string
          text_read: string
          variant_id?: string | null
        }
        Update: {
          confidence?: number | null
          flags?: string[]
          id?: string
          line_no?: number
          match_source?: string
          notes_read?: string | null
          qty_read?: number | null
          slip_id?: string
          text_read?: string
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_slip_lines_slip_id_fkey"
            columns: ["slip_id"]
            isOneToOne: false
            referencedRelation: "order_slips"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_slip_lines_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "menu_item_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_slip_lines_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "v_item_cogs"
            referencedColumns: ["variant_id"]
          },
          {
            foreignKeyName: "order_slip_lines_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "v_item_margin"
            referencedColumns: ["variant_id"]
          },
        ]
      }
      order_slips: {
        Row: {
          created_at: string
          error_code: string | null
          id: string
          model: string | null
          order_id: string | null
          read_at: string | null
          reading_started_at: string | null
          reading_token: string | null
          rejected_at: string | null
          rejected_by: string | null
          rejected_reason: string | null
          sent_at: string | null
          sent_by: string | null
          status: string
          storage_path: string
          tab_id: string | null
          table_id: string | null
          table_number_read: string | null
          uploaded_by: string
          venue_id: string
        }
        Insert: {
          created_at?: string
          error_code?: string | null
          id?: string
          model?: string | null
          order_id?: string | null
          read_at?: string | null
          reading_started_at?: string | null
          reading_token?: string | null
          rejected_at?: string | null
          rejected_by?: string | null
          rejected_reason?: string | null
          sent_at?: string | null
          sent_by?: string | null
          status?: string
          storage_path: string
          tab_id?: string | null
          table_id?: string | null
          table_number_read?: string | null
          uploaded_by: string
          venue_id: string
        }
        Update: {
          created_at?: string
          error_code?: string | null
          id?: string
          model?: string | null
          order_id?: string | null
          read_at?: string | null
          reading_started_at?: string | null
          reading_token?: string | null
          rejected_at?: string | null
          rejected_by?: string | null
          rejected_reason?: string | null
          sent_at?: string | null
          sent_by?: string | null
          status?: string
          storage_path?: string
          tab_id?: string | null
          table_id?: string | null
          table_number_read?: string | null
          uploaded_by?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_slips_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_slips_rejected_by_fkey"
            columns: ["rejected_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_slips_sent_by_fkey"
            columns: ["sent_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_slips_tab_id_fkey"
            columns: ["tab_id"]
            isOneToOne: false
            referencedRelation: "tabs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_slips_table_id_fkey"
            columns: ["table_id"]
            isOneToOne: false
            referencedRelation: "cafe_tables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_slips_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_slips_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          device_id: string | null
          guest_session_id: string | null
          id: string
          idempotency_key: string | null
          placed_at: string
          placed_by_staff_id: string | null
          source: Database["public"]["Enums"]["order_source"]
          status: Database["public"]["Enums"]["order_status"]
          tab_id: string
          venue_id: string
        }
        Insert: {
          device_id?: string | null
          guest_session_id?: string | null
          id?: string
          idempotency_key?: string | null
          placed_at?: string
          placed_by_staff_id?: string | null
          source: Database["public"]["Enums"]["order_source"]
          status?: Database["public"]["Enums"]["order_status"]
          tab_id: string
          venue_id?: string
        }
        Update: {
          device_id?: string | null
          guest_session_id?: string | null
          id?: string
          idempotency_key?: string | null
          placed_at?: string
          placed_by_staff_id?: string | null
          source?: Database["public"]["Enums"]["order_source"]
          status?: Database["public"]["Enums"]["order_status"]
          tab_id?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_guest_session_id_fkey"
            columns: ["guest_session_id"]
            isOneToOne: false
            referencedRelation: "guest_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_placed_by_staff_id_fkey"
            columns: ["placed_by_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_tab_id_fkey"
            columns: ["tab_id"]
            isOneToOne: false
            referencedRelation: "tabs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_tab_venue_fkey"
            columns: ["tab_id", "venue_id"]
            isOneToOne: false
            referencedRelation: "tabs"
            referencedColumns: ["id", "venue_id"]
          },
          {
            foreignKeyName: "orders_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_match_seats: {
        Row: {
          amount_iqd: number
          created_at: string
          linked_by: string
          match_seat_id: string
          payment_id: string
          venue_id: string
        }
        Insert: {
          amount_iqd: number
          created_at?: string
          linked_by: string
          match_seat_id: string
          payment_id: string
          venue_id: string
        }
        Update: {
          amount_iqd?: number
          created_at?: string
          linked_by?: string
          match_seat_id?: string
          payment_id?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_match_seats_linked_by_fkey"
            columns: ["linked_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_match_seats_match_seat_id_fkey"
            columns: ["match_seat_id"]
            isOneToOne: false
            referencedRelation: "match_seats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_match_seats_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_match_seats_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount_iqd: number
          change_iqd: number | null
          created_at: string
          day_session_id: string
          device_id: string | null
          id: string
          idempotency_key: string | null
          method: Database["public"]["Enums"]["payment_method"]
          recorded_by: string
          tab_id: string
          tendered_iqd: number | null
          till_shift_id: string | null
          venue_id: string
        }
        Insert: {
          amount_iqd: number
          change_iqd?: number | null
          created_at?: string
          day_session_id: string
          device_id?: string | null
          id?: string
          idempotency_key?: string | null
          method: Database["public"]["Enums"]["payment_method"]
          recorded_by: string
          tab_id: string
          tendered_iqd?: number | null
          till_shift_id?: string | null
          venue_id?: string
        }
        Update: {
          amount_iqd?: number
          change_iqd?: number | null
          created_at?: string
          day_session_id?: string
          device_id?: string | null
          id?: string
          idempotency_key?: string | null
          method?: Database["public"]["Enums"]["payment_method"]
          recorded_by?: string
          tab_id?: string
          tendered_iqd?: number | null
          till_shift_id?: string | null
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_day_session_id_fkey"
            columns: ["day_session_id"]
            isOneToOne: false
            referencedRelation: "day_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_day_session_id_fkey"
            columns: ["day_session_id"]
            isOneToOne: false
            referencedRelation: "v_day_close_summary"
            referencedColumns: ["day_session_id"]
          },
          {
            foreignKeyName: "payments_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_tab_id_fkey"
            columns: ["tab_id"]
            isOneToOne: false
            referencedRelation: "tabs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_till_shift_fkey"
            columns: ["till_shift_id"]
            isOneToOne: false
            referencedRelation: "till_shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_settings: {
        Row: {
          currency: string
          hold_strikes_since: string | null
          id: boolean
          lesson_terms_version: string | null
          llm_cost_micros_per_mtok: number
          llm_daily_request_limit: number
          llm_default_model: string
          llm_monthly_cost_cap_micros: number
          llm_pricing: Json
          match_terms_version: string | null
          match_ticket_price_iqd: number
          max_filling_matches_per_guest: number
          max_live_holds_per_guest: number
          timezone: string
          updated_at: string
        }
        Insert: {
          currency?: string
          hold_strikes_since?: string | null
          id?: boolean
          lesson_terms_version?: string | null
          llm_cost_micros_per_mtok?: number
          llm_daily_request_limit?: number
          llm_default_model?: string
          llm_monthly_cost_cap_micros?: number
          llm_pricing?: Json
          match_terms_version?: string | null
          match_ticket_price_iqd?: number
          max_filling_matches_per_guest?: number
          max_live_holds_per_guest?: number
          timezone?: string
          updated_at?: string
        }
        Update: {
          currency?: string
          hold_strikes_since?: string | null
          id?: boolean
          lesson_terms_version?: string | null
          llm_cost_micros_per_mtok?: number
          llm_daily_request_limit?: number
          llm_default_model?: string
          llm_monthly_cost_cap_micros?: number
          llm_pricing?: Json
          match_terms_version?: string | null
          match_ticket_price_iqd?: number
          max_filling_matches_per_guest?: number
          max_live_holds_per_guest?: number
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          deleted_at: string | null
          expo_push_token: string | null
          family_name: string | null
          full_name: string
          gender: string | null
          gender_set_at: string | null
          gender_set_by: string | null
          given_name: string | null
          id: string
          payment_sandbox: boolean
          phone: string | null
          preferred_lang: string
          terms_accepted_at: string | null
          terms_version: string | null
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          expo_push_token?: string | null
          family_name?: string | null
          full_name: string
          gender?: string | null
          gender_set_at?: string | null
          gender_set_by?: string | null
          given_name?: string | null
          id: string
          payment_sandbox?: boolean
          phone?: string | null
          preferred_lang?: string
          terms_accepted_at?: string | null
          terms_version?: string | null
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          expo_push_token?: string | null
          family_name?: string | null
          full_name?: string
          gender?: string | null
          gender_set_at?: string | null
          gender_set_by?: string | null
          given_name?: string | null
          id?: string
          payment_sandbox?: boolean
          phone?: string | null
          preferred_lang?: string
          terms_accepted_at?: string | null
          terms_version?: string | null
        }
        Relationships: []
      }
      promotion_redemptions: {
        Row: {
          adjustment_id: string
          amount_iqd: number
          code_used: string | null
          customer_id: string | null
          id: string
          idempotency_key: string | null
          promotion_id: string
          redeemed_at: string
          redeemed_by: string
          tab_id: string
        }
        Insert: {
          adjustment_id: string
          amount_iqd: number
          code_used?: string | null
          customer_id?: string | null
          id?: string
          idempotency_key?: string | null
          promotion_id: string
          redeemed_at?: string
          redeemed_by: string
          tab_id: string
        }
        Update: {
          adjustment_id?: string
          amount_iqd?: number
          code_used?: string | null
          customer_id?: string | null
          id?: string
          idempotency_key?: string | null
          promotion_id?: string
          redeemed_at?: string
          redeemed_by?: string
          tab_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "promotion_redemptions_adjustment_id_fkey"
            columns: ["adjustment_id"]
            isOneToOne: false
            referencedRelation: "tab_adjustments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promotion_redemptions_adjustment_id_fkey"
            columns: ["adjustment_id"]
            isOneToOne: false
            referencedRelation: "v_day_close_adjustments"
            referencedColumns: ["adjustment_id"]
          },
          {
            foreignKeyName: "promotion_redemptions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promotion_redemptions_promotion_id_fkey"
            columns: ["promotion_id"]
            isOneToOne: false
            referencedRelation: "promotions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promotion_redemptions_redeemed_by_fkey"
            columns: ["redeemed_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promotion_redemptions_tab_id_fkey"
            columns: ["tab_id"]
            isOneToOne: false
            referencedRelation: "tabs"
            referencedColumns: ["id"]
          },
        ]
      }
      promotions: {
        Row: {
          auto: boolean
          code_single_use: boolean
          created_at: string
          created_by: string
          enabled: boolean
          ends_at: string | null
          hour_from: string | null
          hour_to: string | null
          id: string
          limits: Json
          name_ar: string
          name_en: string
          public_code: string | null
          scope: Json
          starts_at: string | null
          type: string
          updated_at: string
          value: number
          venue_id: string | null
          weekdays: number[]
        }
        Insert: {
          auto?: boolean
          code_single_use?: boolean
          created_at?: string
          created_by: string
          enabled?: boolean
          ends_at?: string | null
          hour_from?: string | null
          hour_to?: string | null
          id?: string
          limits?: Json
          name_ar: string
          name_en: string
          public_code?: string | null
          scope?: Json
          starts_at?: string | null
          type: string
          updated_at?: string
          value: number
          venue_id?: string | null
          weekdays?: number[]
        }
        Update: {
          auto?: boolean
          code_single_use?: boolean
          created_at?: string
          created_by?: string
          enabled?: boolean
          ends_at?: string | null
          hour_from?: string | null
          hour_to?: string | null
          id?: string
          limits?: Json
          name_ar?: string
          name_en?: string
          public_code?: string | null
          scope?: Json
          starts_at?: string | null
          type?: string
          updated_at?: string
          value?: number
          venue_id?: string | null
          weekdays?: number[]
        }
        Relationships: [
          {
            foreignKeyName: "promotions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promotions_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      protocol_run_items: {
        Row: {
          done_at: string | null
          done_by: string | null
          id: string
          position: number
          run_step_id: string
          text_ar: string
          text_en: string
        }
        Insert: {
          done_at?: string | null
          done_by?: string | null
          id?: string
          position: number
          run_step_id: string
          text_ar: string
          text_en: string
        }
        Update: {
          done_at?: string | null
          done_by?: string | null
          id?: string
          position?: number
          run_step_id?: string
          text_ar?: string
          text_en?: string
        }
        Relationships: [
          {
            foreignKeyName: "protocol_run_items_done_by_fkey"
            columns: ["done_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "protocol_run_items_run_step_id_fkey"
            columns: ["run_step_id"]
            isOneToOne: false
            referencedRelation: "protocol_run_steps"
            referencedColumns: ["id"]
          },
        ]
      }
      protocol_run_steps: {
        Row: {
          actor_roles: Database["public"]["Enums"]["staff_role"][]
          after_keys: string[]
          assigned_to: string | null
          id: string
          name_ar: string
          name_en: string
          needs_owner_ok: boolean
          opened_at: string | null
          optional: boolean
          passed_at: string | null
          position: number
          round: number
          run_id: string
          skip_note: string | null
          skipped_at: string | null
          skipped_by: string | null
          status: string
          step_key: string | null
        }
        Insert: {
          actor_roles: Database["public"]["Enums"]["staff_role"][]
          after_keys?: string[]
          assigned_to?: string | null
          id?: string
          name_ar: string
          name_en: string
          needs_owner_ok: boolean
          opened_at?: string | null
          optional: boolean
          passed_at?: string | null
          position: number
          round?: number
          run_id: string
          skip_note?: string | null
          skipped_at?: string | null
          skipped_by?: string | null
          status?: string
          step_key?: string | null
        }
        Update: {
          actor_roles?: Database["public"]["Enums"]["staff_role"][]
          after_keys?: string[]
          assigned_to?: string | null
          id?: string
          name_ar?: string
          name_en?: string
          needs_owner_ok?: boolean
          opened_at?: string | null
          optional?: boolean
          passed_at?: string | null
          position?: number
          round?: number
          run_id?: string
          skip_note?: string | null
          skipped_at?: string | null
          skipped_by?: string | null
          status?: string
          step_key?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "protocol_run_steps_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "protocol_run_steps_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "protocol_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "protocol_run_steps_skipped_by_fkey"
            columns: ["skipped_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      protocol_runs: {
        Row: {
          data: Json
          finished_at: string | null
          id: string
          kind: string
          live_at: string | null
          menu_item_id: string | null
          photos_purged_at: string | null
          promotion_id: string | null
          scheduled_for: string | null
          started_at: string
          started_by: string
          status: string
          stop_reason: string | null
          template_id: string
          template_version: number
          title_ar: string | null
          title_en: string | null
          variant: string | null
          venue_id: string
        }
        Insert: {
          data?: Json
          finished_at?: string | null
          id?: string
          kind: string
          live_at?: string | null
          menu_item_id?: string | null
          photos_purged_at?: string | null
          promotion_id?: string | null
          scheduled_for?: string | null
          started_at?: string
          started_by: string
          status?: string
          stop_reason?: string | null
          template_id: string
          template_version: number
          title_ar?: string | null
          title_en?: string | null
          variant?: string | null
          venue_id: string
        }
        Update: {
          data?: Json
          finished_at?: string | null
          id?: string
          kind?: string
          live_at?: string | null
          menu_item_id?: string | null
          photos_purged_at?: string | null
          promotion_id?: string | null
          scheduled_for?: string | null
          started_at?: string
          started_by?: string
          status?: string
          stop_reason?: string | null
          template_id?: string
          template_version?: number
          title_ar?: string | null
          title_en?: string | null
          variant?: string | null
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "protocol_runs_menu_item_id_fkey"
            columns: ["menu_item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "protocol_runs_promotion_id_fkey"
            columns: ["promotion_id"]
            isOneToOne: false
            referencedRelation: "promotions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "protocol_runs_started_by_fkey"
            columns: ["started_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "protocol_runs_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "protocol_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "protocol_runs_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      protocol_submissions: {
        Row: {
          decided_at: string | null
          decided_by: string | null
          decision: string | null
          decision_note: string | null
          id: string
          photos: string[]
          record: Json
          round: number
          run_id: string
          run_step_id: string
          send_back_to: string | null
          submitted_at: string
          submitted_by: string
          superseded_at: string | null
          withdrawn_at: string | null
        }
        Insert: {
          decided_at?: string | null
          decided_by?: string | null
          decision?: string | null
          decision_note?: string | null
          id?: string
          photos?: string[]
          record: Json
          round: number
          run_id: string
          run_step_id: string
          send_back_to?: string | null
          submitted_at?: string
          submitted_by: string
          superseded_at?: string | null
          withdrawn_at?: string | null
        }
        Update: {
          decided_at?: string | null
          decided_by?: string | null
          decision?: string | null
          decision_note?: string | null
          id?: string
          photos?: string[]
          record?: Json
          round?: number
          run_id?: string
          run_step_id?: string
          send_back_to?: string | null
          submitted_at?: string
          submitted_by?: string
          superseded_at?: string | null
          withdrawn_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "protocol_submissions_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "protocol_submissions_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "protocol_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "protocol_submissions_run_step_id_fkey"
            columns: ["run_step_id"]
            isOneToOne: false
            referencedRelation: "protocol_run_steps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "protocol_submissions_send_back_to_fkey"
            columns: ["send_back_to"]
            isOneToOne: false
            referencedRelation: "protocol_run_steps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "protocol_submissions_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      protocol_template_items: {
        Row: {
          id: string
          position: number
          step_id: string
          text_ar: string
          text_en: string
        }
        Insert: {
          id?: string
          position: number
          step_id: string
          text_ar: string
          text_en: string
        }
        Update: {
          id?: string
          position?: number
          step_id?: string
          text_ar?: string
          text_en?: string
        }
        Relationships: [
          {
            foreignKeyName: "protocol_template_items_step_id_fkey"
            columns: ["step_id"]
            isOneToOne: false
            referencedRelation: "protocol_template_steps"
            referencedColumns: ["id"]
          },
        ]
      }
      protocol_template_steps: {
        Row: {
          actor_roles: Database["public"]["Enums"]["staff_role"][]
          id: string
          name_ar: string
          name_en: string
          needs_owner_ok: boolean
          optional: boolean
          position: number
          step_key: string | null
          template_id: string
        }
        Insert: {
          actor_roles: Database["public"]["Enums"]["staff_role"][]
          id?: string
          name_ar: string
          name_en: string
          needs_owner_ok?: boolean
          optional?: boolean
          position: number
          step_key?: string | null
          template_id: string
        }
        Update: {
          actor_roles?: Database["public"]["Enums"]["staff_role"][]
          id?: string
          name_ar?: string
          name_en?: string
          needs_owner_ok?: boolean
          optional?: boolean
          position?: number
          step_key?: string | null
          template_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "protocol_template_steps_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "protocol_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      protocol_templates: {
        Row: {
          id: string
          kind: string
          name_ar: string
          name_en: string
          updated_at: string
          updated_by: string | null
          variant: string | null
          venue_id: string
          version: number
        }
        Insert: {
          id?: string
          kind: string
          name_ar: string
          name_en: string
          updated_at?: string
          updated_by?: string | null
          variant?: string | null
          venue_id: string
          version?: number
        }
        Update: {
          id?: string
          kind?: string
          name_ar?: string
          name_en?: string
          updated_at?: string
          updated_by?: string | null
          variant?: string | null
          venue_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "protocol_templates_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "protocol_templates_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_lines: {
        Row: {
          id: string
          ingredient_id: string | null
          label: string | null
          price_iqd: number
          purchase_id: string
          qty: number
          shopping_item_id: string | null
          status: string
        }
        Insert: {
          id?: string
          ingredient_id?: string | null
          label?: string | null
          price_iqd: number
          purchase_id: string
          qty: number
          shopping_item_id?: string | null
          status?: string
        }
        Update: {
          id?: string
          ingredient_id?: string | null
          label?: string | null
          price_iqd?: number
          purchase_id?: string
          qty?: number
          shopping_item_id?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_lines_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_lines_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "v_ingredient_on_hand"
            referencedColumns: ["ingredient_id"]
          },
          {
            foreignKeyName: "purchase_lines_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "v_stock_by_location"
            referencedColumns: ["ingredient_id"]
          },
          {
            foreignKeyName: "purchase_lines_purchase_id_fkey"
            columns: ["purchase_id"]
            isOneToOne: false
            referencedRelation: "purchases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_lines_shopping_item_id_fkey"
            columns: ["shopping_item_id"]
            isOneToOne: false
            referencedRelation: "shopping_items"
            referencedColumns: ["id"]
          },
        ]
      }
      purchases: {
        Row: {
          bought_at: string
          created_at: string
          delivered_at: string | null
          delivered_by: string | null
          delivery_id: string | null
          id: string
          receipt_path: string | null
          received_at: string | null
          received_by: string | null
          shop_name: string | null
          staff_id: string
          status: string
          total_iqd: number
          venue_id: string
        }
        Insert: {
          bought_at: string
          created_at?: string
          delivered_at?: string | null
          delivered_by?: string | null
          delivery_id?: string | null
          id?: string
          receipt_path?: string | null
          received_at?: string | null
          received_by?: string | null
          shop_name?: string | null
          staff_id: string
          status?: string
          total_iqd: number
          venue_id: string
        }
        Update: {
          bought_at?: string
          created_at?: string
          delivered_at?: string | null
          delivered_by?: string | null
          delivery_id?: string | null
          id?: string
          receipt_path?: string | null
          received_at?: string | null
          received_by?: string | null
          shop_name?: string | null
          staff_id?: string
          status?: string
          total_iqd?: number
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchases_delivered_by_fkey"
            columns: ["delivered_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchases_delivery_id_fkey"
            columns: ["delivery_id"]
            isOneToOne: false
            referencedRelation: "deliveries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchases_received_by_fkey"
            columns: ["received_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchases_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchases_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      rate_rule_prices: {
        Row: {
          duration_min: number
          price_iqd: number
          rule_id: string
        }
        Insert: {
          duration_min: number
          price_iqd: number
          rule_id: string
        }
        Update: {
          duration_min?: number
          price_iqd?: number
          rule_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rate_rule_prices_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "rate_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      rate_rules: {
        Row: {
          court_id: string | null
          days_of_week: number[]
          end_time: string
          id: string
          is_active: boolean
          name: string
          priority: number
          start_time: string
          valid_from: string | null
          valid_to: string | null
          venue_id: string
        }
        Insert: {
          court_id?: string | null
          days_of_week: number[]
          end_time: string
          id?: string
          is_active?: boolean
          name: string
          priority?: number
          start_time: string
          valid_from?: string | null
          valid_to?: string | null
          venue_id?: string
        }
        Update: {
          court_id?: string | null
          days_of_week?: number[]
          end_time?: string
          id?: string
          is_active?: boolean
          name?: string
          priority?: number
          start_time?: string
          valid_from?: string | null
          valid_to?: string | null
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rate_rules_court_id_fkey"
            columns: ["court_id"]
            isOneToOne: false
            referencedRelation: "courts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rate_rules_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      recipe_change_requests: {
        Row: {
          after: Json
          before: Json
          decided_at: string | null
          decided_by: string | null
          decline_reason: string | null
          id: string
          note: string | null
          ops: Json
          output_ingredient_id: string | null
          requested_at: string
          requested_by: string
          status: string
          target: string
          variant_id: string | null
          venue_id: string
        }
        Insert: {
          after: Json
          before: Json
          decided_at?: string | null
          decided_by?: string | null
          decline_reason?: string | null
          id?: string
          note?: string | null
          ops: Json
          output_ingredient_id?: string | null
          requested_at?: string
          requested_by: string
          status?: string
          target: string
          variant_id?: string | null
          venue_id: string
        }
        Update: {
          after?: Json
          before?: Json
          decided_at?: string | null
          decided_by?: string | null
          decline_reason?: string | null
          id?: string
          note?: string | null
          ops?: Json
          output_ingredient_id?: string | null
          requested_at?: string
          requested_by?: string
          status?: string
          target?: string
          variant_id?: string | null
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "recipe_change_requests_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_change_requests_output_ingredient_id_fkey"
            columns: ["output_ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_change_requests_output_ingredient_id_fkey"
            columns: ["output_ingredient_id"]
            isOneToOne: false
            referencedRelation: "v_ingredient_on_hand"
            referencedColumns: ["ingredient_id"]
          },
          {
            foreignKeyName: "recipe_change_requests_output_ingredient_id_fkey"
            columns: ["output_ingredient_id"]
            isOneToOne: false
            referencedRelation: "v_stock_by_location"
            referencedColumns: ["ingredient_id"]
          },
          {
            foreignKeyName: "recipe_change_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_change_requests_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "menu_item_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_change_requests_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "v_item_cogs"
            referencedColumns: ["variant_id"]
          },
          {
            foreignKeyName: "recipe_change_requests_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "v_item_margin"
            referencedColumns: ["variant_id"]
          },
          {
            foreignKeyName: "recipe_change_requests_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      recipe_lines: {
        Row: {
          id: string
          ingredient_id: string
          modifier_id: string | null
          output_ingredient_id: string | null
          qty: number
          variant_id: string | null
        }
        Insert: {
          id?: string
          ingredient_id: string
          modifier_id?: string | null
          output_ingredient_id?: string | null
          qty: number
          variant_id?: string | null
        }
        Update: {
          id?: string
          ingredient_id?: string
          modifier_id?: string | null
          output_ingredient_id?: string | null
          qty?: number
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "recipe_lines_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_lines_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "v_ingredient_on_hand"
            referencedColumns: ["ingredient_id"]
          },
          {
            foreignKeyName: "recipe_lines_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "v_stock_by_location"
            referencedColumns: ["ingredient_id"]
          },
          {
            foreignKeyName: "recipe_lines_modifier_id_fkey"
            columns: ["modifier_id"]
            isOneToOne: false
            referencedRelation: "modifiers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_lines_output_ingredient_id_fkey"
            columns: ["output_ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_lines_output_ingredient_id_fkey"
            columns: ["output_ingredient_id"]
            isOneToOne: false
            referencedRelation: "v_ingredient_on_hand"
            referencedColumns: ["ingredient_id"]
          },
          {
            foreignKeyName: "recipe_lines_output_ingredient_id_fkey"
            columns: ["output_ingredient_id"]
            isOneToOne: false
            referencedRelation: "v_stock_by_location"
            referencedColumns: ["ingredient_id"]
          },
          {
            foreignKeyName: "recipe_lines_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "menu_item_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_lines_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "v_item_cogs"
            referencedColumns: ["variant_id"]
          },
          {
            foreignKeyName: "recipe_lines_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "v_item_margin"
            referencedColumns: ["variant_id"]
          },
        ]
      }
      refund_items: {
        Row: {
          order_item_id: string
          qty: number
          refund_id: string
        }
        Insert: {
          order_item_id: string
          qty: number
          refund_id: string
        }
        Update: {
          order_item_id?: string
          qty?: number
          refund_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "refund_items_order_item_id_fkey"
            columns: ["order_item_id"]
            isOneToOne: false
            referencedRelation: "order_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refund_items_refund_id_fkey"
            columns: ["refund_id"]
            isOneToOne: false
            referencedRelation: "refunds"
            referencedColumns: ["id"]
          },
        ]
      }
      refunds: {
        Row: {
          amount_iqd: number
          created_at: string
          device_id: string | null
          id: string
          payment_id: string
          reason_code: string
          refunded_by: string
          till_shift_id: string | null
          venue_id: string
        }
        Insert: {
          amount_iqd: number
          created_at?: string
          device_id?: string | null
          id?: string
          payment_id: string
          reason_code: string
          refunded_by: string
          till_shift_id?: string | null
          venue_id?: string
        }
        Update: {
          amount_iqd?: number
          created_at?: string
          device_id?: string | null
          id?: string
          payment_id?: string
          reason_code?: string
          refunded_by?: string
          till_shift_id?: string | null
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "refunds_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refunds_refunded_by_fkey"
            columns: ["refunded_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refunds_till_shift_fkey"
            columns: ["till_shift_id"]
            isOneToOne: false
            referencedRelation: "till_shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refunds_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      release_ideas: {
        Row: {
          author_id: string
          decided_at: string | null
          decided_by: string | null
          decline_reason: string | null
          id: string
          photos: string[]
          record: Json
          run_id: string | null
          status: string
          submitted_at: string
          team: string
          venue_id: string
        }
        Insert: {
          author_id: string
          decided_at?: string | null
          decided_by?: string | null
          decline_reason?: string | null
          id?: string
          photos?: string[]
          record: Json
          run_id?: string | null
          status?: string
          submitted_at?: string
          team: string
          venue_id: string
        }
        Update: {
          author_id?: string
          decided_at?: string | null
          decided_by?: string | null
          decline_reason?: string | null
          id?: string
          photos?: string[]
          record?: Json
          run_id?: string | null
          status?: string
          submitted_at?: string
          team?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "release_ideas_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "release_ideas_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "release_ideas_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "protocol_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "release_ideas_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      release_notes: {
        Row: {
          author_id: string
          body: string
          created_at: string
          id: string
          menu_item_id: string
          run_id: string | null
          venue_id: string
        }
        Insert: {
          author_id: string
          body: string
          created_at?: string
          id?: string
          menu_item_id: string
          run_id?: string | null
          venue_id: string
        }
        Update: {
          author_id?: string
          body?: string
          created_at?: string
          id?: string
          menu_item_id?: string
          run_id?: string | null
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "release_notes_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "release_notes_menu_item_id_fkey"
            columns: ["menu_item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "release_notes_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "protocol_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "release_notes_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      release_reviews: {
        Row: {
          created_at: string
          menu_item_id: string | null
          model: string | null
          numbers: Json
          run_id: string
          status: string
          venue_id: string
          write_up: Json | null
          written_at: string | null
        }
        Insert: {
          created_at?: string
          menu_item_id?: string | null
          model?: string | null
          numbers: Json
          run_id: string
          status: string
          venue_id: string
          write_up?: Json | null
          written_at?: string | null
        }
        Update: {
          created_at?: string
          menu_item_id?: string | null
          model?: string | null
          numbers?: Json
          run_id?: string
          status?: string
          venue_id?: string
          write_up?: Json | null
          written_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "release_reviews_menu_item_id_fkey"
            columns: ["menu_item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "release_reviews_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: true
            referencedRelation: "protocol_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "release_reviews_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      reservation_series: {
        Row: {
          cancelled_at: string | null
          cancelled_reason: string | null
          court_id: string
          created_at: string
          created_by_staff_id: string | null
          duration_min: number
          ends_on: string
          guest_id: string | null
          guest_name: string | null
          guest_phone: string | null
          id: string
          idempotency_key: string | null
          notes: string | null
          pattern: string
          start_time: string
          starts_on: string
          venue_id: string
          weekdays: number[]
        }
        Insert: {
          cancelled_at?: string | null
          cancelled_reason?: string | null
          court_id: string
          created_at?: string
          created_by_staff_id?: string | null
          duration_min: number
          ends_on: string
          guest_id?: string | null
          guest_name?: string | null
          guest_phone?: string | null
          id?: string
          idempotency_key?: string | null
          notes?: string | null
          pattern: string
          start_time: string
          starts_on: string
          venue_id?: string
          weekdays?: number[]
        }
        Update: {
          cancelled_at?: string | null
          cancelled_reason?: string | null
          court_id?: string
          created_at?: string
          created_by_staff_id?: string | null
          duration_min?: number
          ends_on?: string
          guest_id?: string | null
          guest_name?: string | null
          guest_phone?: string | null
          id?: string
          idempotency_key?: string | null
          notes?: string | null
          pattern?: string
          start_time?: string
          starts_on?: string
          venue_id?: string
          weekdays?: number[]
        }
        Relationships: [
          {
            foreignKeyName: "reservation_series_court_id_fkey"
            columns: ["court_id"]
            isOneToOne: false
            referencedRelation: "courts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservation_series_created_by_staff_id_fkey"
            columns: ["created_by_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservation_series_guest_id_fkey"
            columns: ["guest_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservation_series_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      reservations: {
        Row: {
          block_purpose: string | null
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: Database["public"]["Enums"]["cancellation_actor"] | null
          client_ref: string | null
          court_id: string
          created_at: string
          created_by_staff_id: string | null
          device_id: string | null
          end_at: string
          guest_id: string | null
          guest_name: string | null
          guest_phone: string | null
          hold_expires_at: string | null
          id: string
          idempotency_key: string | null
          kind: Database["public"]["Enums"]["reservation_kind"]
          lesson_id: string | null
          notes: string | null
          period: unknown
          price_iqd: number | null
          protocol_run_id: string | null
          rate_rule_id: string | null
          series_id: string | null
          source: Database["public"]["Enums"]["reservation_source"]
          start_at: string
          status: Database["public"]["Enums"]["reservation_status"]
          venue_id: string
        }
        Insert: {
          block_purpose?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?:
            | Database["public"]["Enums"]["cancellation_actor"]
            | null
          client_ref?: string | null
          court_id: string
          created_at?: string
          created_by_staff_id?: string | null
          device_id?: string | null
          end_at: string
          guest_id?: string | null
          guest_name?: string | null
          guest_phone?: string | null
          hold_expires_at?: string | null
          id?: string
          idempotency_key?: string | null
          kind: Database["public"]["Enums"]["reservation_kind"]
          lesson_id?: string | null
          notes?: string | null
          period?: unknown
          price_iqd?: number | null
          protocol_run_id?: string | null
          rate_rule_id?: string | null
          series_id?: string | null
          source: Database["public"]["Enums"]["reservation_source"]
          start_at: string
          status?: Database["public"]["Enums"]["reservation_status"]
          venue_id?: string
        }
        Update: {
          block_purpose?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?:
            | Database["public"]["Enums"]["cancellation_actor"]
            | null
          client_ref?: string | null
          court_id?: string
          created_at?: string
          created_by_staff_id?: string | null
          device_id?: string | null
          end_at?: string
          guest_id?: string | null
          guest_name?: string | null
          guest_phone?: string | null
          hold_expires_at?: string | null
          id?: string
          idempotency_key?: string | null
          kind?: Database["public"]["Enums"]["reservation_kind"]
          lesson_id?: string | null
          notes?: string | null
          period?: unknown
          price_iqd?: number | null
          protocol_run_id?: string | null
          rate_rule_id?: string | null
          series_id?: string | null
          source?: Database["public"]["Enums"]["reservation_source"]
          start_at?: string
          status?: Database["public"]["Enums"]["reservation_status"]
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reservations_court_id_fkey"
            columns: ["court_id"]
            isOneToOne: false
            referencedRelation: "courts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservations_court_venue_fkey"
            columns: ["court_id", "venue_id"]
            isOneToOne: false
            referencedRelation: "courts"
            referencedColumns: ["id", "venue_id"]
          },
          {
            foreignKeyName: "reservations_created_by_staff_id_fkey"
            columns: ["created_by_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservations_guest_id_fkey"
            columns: ["guest_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservations_lesson_id_fkey"
            columns: ["lesson_id"]
            isOneToOne: false
            referencedRelation: "lessons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservations_protocol_run_id_fkey"
            columns: ["protocol_run_id"]
            isOneToOne: false
            referencedRelation: "protocol_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservations_rate_rule_id_fkey"
            columns: ["rate_rule_id"]
            isOneToOne: false
            referencedRelation: "rate_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservations_series_id_fkey"
            columns: ["series_id"]
            isOneToOne: false
            referencedRelation: "reservation_series"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservations_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      salary_deductions: {
        Row: {
          amount_iqd: number
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          decided_at: string | null
          decided_by: string | null
          decision_note: string | null
          deduction_date: string
          id: string
          pay_month: string | null
          proposed_at: string
          proposed_by: string
          reason: string
          staff_id: string
          status: string
          venue_id: string
        }
        Insert: {
          amount_iqd: number
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          deduction_date: string
          id?: string
          pay_month?: string | null
          proposed_at?: string
          proposed_by: string
          reason: string
          staff_id: string
          status?: string
          venue_id: string
        }
        Update: {
          amount_iqd?: number
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          deduction_date?: string
          id?: string
          pay_month?: string | null
          proposed_at?: string
          proposed_by?: string
          reason?: string
          staff_id?: string
          status?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "salary_deductions_cancelled_by_fkey"
            columns: ["cancelled_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salary_deductions_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salary_deductions_proposed_by_fkey"
            columns: ["proposed_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salary_deductions_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salary_deductions_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      scan_reads: {
        Row: {
          created_at: string
          id: string
          kind: string
          paper_id: string
          requested_by: string | null
          venue_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          kind: string
          paper_id: string
          requested_by?: string | null
          venue_id: string
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          paper_id?: string
          requested_by?: string | null
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "scan_reads_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scan_reads_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      shopping_items: {
        Row: {
          cancelled_at: string | null
          cancelled_by: string | null
          decided_at: string | null
          decided_by: string | null
          decline_reason: string | null
          id: string
          ingredient_id: string | null
          label: string | null
          note: string | null
          purchase_id: string | null
          qty: number
          requested_at: string
          requested_by: string
          status: string
          unit: string
          venue_id: string
        }
        Insert: {
          cancelled_at?: string | null
          cancelled_by?: string | null
          decided_at?: string | null
          decided_by?: string | null
          decline_reason?: string | null
          id?: string
          ingredient_id?: string | null
          label?: string | null
          note?: string | null
          purchase_id?: string | null
          qty: number
          requested_at?: string
          requested_by: string
          status?: string
          unit: string
          venue_id: string
        }
        Update: {
          cancelled_at?: string | null
          cancelled_by?: string | null
          decided_at?: string | null
          decided_by?: string | null
          decline_reason?: string | null
          id?: string
          ingredient_id?: string | null
          label?: string | null
          note?: string | null
          purchase_id?: string | null
          qty?: number
          requested_at?: string
          requested_by?: string
          status?: string
          unit?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shopping_items_cancelled_by_fkey"
            columns: ["cancelled_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shopping_items_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shopping_items_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shopping_items_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "v_ingredient_on_hand"
            referencedColumns: ["ingredient_id"]
          },
          {
            foreignKeyName: "shopping_items_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "v_stock_by_location"
            referencedColumns: ["ingredient_id"]
          },
          {
            foreignKeyName: "shopping_items_purchase_id_fkey"
            columns: ["purchase_id"]
            isOneToOne: false
            referencedRelation: "purchases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shopping_items_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shopping_items_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      staff: {
        Row: {
          created_at: string
          created_by: string | null
          display_name: string
          id: string
          is_active: boolean
          pin_hash: string | null
          role: Database["public"]["Enums"]["staff_role"]
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          display_name: string
          id: string
          is_active?: boolean
          pin_hash?: string | null
          role: Database["public"]["Enums"]["staff_role"]
        }
        Update: {
          created_at?: string
          created_by?: string | null
          display_name?: string
          id?: string
          is_active?: boolean
          pin_hash?: string | null
          role?: Database["public"]["Enums"]["staff_role"]
        }
        Relationships: [
          {
            foreignKeyName: "staff_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_attendance: {
        Row: {
          early_leave_minutes: number
          grace_minutes: number
          id: string
          late_minutes: number
          note: string | null
          pay_month: string
          penalty_iqd: number | null
          penalty_rule_iqd: number
          recorded_at: string
          recorded_by: string
          staff_id: string
          venue_id: string
          work_date: string
        }
        Insert: {
          early_leave_minutes?: number
          grace_minutes: number
          id?: string
          late_minutes?: number
          note?: string | null
          pay_month: string
          penalty_iqd?: number | null
          penalty_rule_iqd: number
          recorded_at?: string
          recorded_by: string
          staff_id: string
          venue_id: string
          work_date: string
        }
        Update: {
          early_leave_minutes?: number
          grace_minutes?: number
          id?: string
          late_minutes?: number
          note?: string | null
          pay_month?: string
          penalty_iqd?: number | null
          penalty_rule_iqd?: number
          recorded_at?: string
          recorded_by?: string
          staff_id?: string
          venue_id?: string
          work_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_attendance_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_attendance_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_attendance_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_breaks: {
        Row: {
          business_date: string
          cover_started_at: string | null
          covered_by: string | null
          ended_at: string | null
          id: string
          staff_id: string
          started_at: string
          station_id: string
          venue_id: string
        }
        Insert: {
          business_date: string
          cover_started_at?: string | null
          covered_by?: string | null
          ended_at?: string | null
          id?: string
          staff_id: string
          started_at?: string
          station_id: string
          venue_id?: string
        }
        Update: {
          business_date?: string
          cover_started_at?: string | null
          covered_by?: string | null
          ended_at?: string | null
          id?: string
          staff_id?: string
          started_at?: string
          station_id?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_breaks_covered_by_fkey"
            columns: ["covered_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_breaks_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_breaks_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_media_uploads: {
        Row: {
          created_at: string
          folder: string
          path: string
          uploader: string
          used_at: string | null
          used_by: string | null
          venue_id: string
        }
        Insert: {
          created_at?: string
          folder: string
          path: string
          uploader: string
          used_at?: string | null
          used_by?: string | null
          venue_id: string
        }
        Update: {
          created_at?: string
          folder?: string
          path?: string
          uploader?: string
          used_at?: string | null
          used_by?: string | null
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_media_uploads_uploader_fkey"
            columns: ["uploader"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_media_uploads_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_requests: {
        Row: {
          amount_iqd: number | null
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decision_note: string | null
          from_date: string | null
          id: string
          kind: Database["public"]["Enums"]["staff_request_kind"]
          note: string
          staff_id: string
          status: Database["public"]["Enums"]["staff_request_status"]
          to_date: string | null
        }
        Insert: {
          amount_iqd?: number | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          from_date?: string | null
          id?: string
          kind: Database["public"]["Enums"]["staff_request_kind"]
          note?: string
          staff_id: string
          status?: Database["public"]["Enums"]["staff_request_status"]
          to_date?: string | null
        }
        Update: {
          amount_iqd?: number | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          from_date?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["staff_request_kind"]
          note?: string
          staff_id?: string
          status?: Database["public"]["Enums"]["staff_request_status"]
          to_date?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "staff_requests_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_requests_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_suggestions: {
        Row: {
          author_id: string
          body: string
          created_at: string
          id: string
          seen_at: string | null
          seen_by: string | null
          venue_id: string
        }
        Insert: {
          author_id: string
          body: string
          created_at?: string
          id?: string
          seen_at?: string | null
          seen_by?: string | null
          venue_id: string
        }
        Update: {
          author_id?: string
          body?: string
          created_at?: string
          id?: string
          seen_at?: string | null
          seen_by?: string | null
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_suggestions_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_suggestions_seen_by_fkey"
            columns: ["seen_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_suggestions_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_venues: {
        Row: {
          created_at: string
          created_by: string | null
          role: Database["public"]["Enums"]["staff_role"]
          staff_id: string
          venue_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          role: Database["public"]["Enums"]["staff_role"]
          staff_id: string
          venue_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          role?: Database["public"]["Enums"]["staff_role"]
          staff_id?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_venues_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_venues_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_venues_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_wages: {
        Row: {
          effective_month: string
          id: string
          pay_day: number
          salary_iqd: number
          set_at: string
          set_by: string
          staff_id: string
          venue_id: string
        }
        Insert: {
          effective_month: string
          id?: string
          pay_day: number
          salary_iqd: number
          set_at?: string
          set_by: string
          staff_id: string
          venue_id: string
        }
        Update: {
          effective_month?: string
          id?: string
          pay_day?: number
          salary_iqd?: number
          set_at?: string
          set_by?: string
          staff_id?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_wages_set_by_fkey"
            columns: ["set_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_wages_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_wages_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      station_staff: {
        Row: {
          created_at: string
          created_by: string | null
          staff_id: string
          station_id: string
          venue_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          staff_id: string
          station_id: string
          venue_id?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          staff_id?: string
          station_id?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "station_staff_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "station_staff_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "station_staff_station_fkey"
            columns: ["station_id"]
            isOneToOne: false
            referencedRelation: "stations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "station_staff_station_venue_fkey"
            columns: ["station_id", "venue_id"]
            isOneToOne: false
            referencedRelation: "stations"
            referencedColumns: ["id", "venue_id"]
          },
          {
            foreignKeyName: "station_staff_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      stations: {
        Row: {
          id: string
          is_till: boolean
          mode: string | null
          registered_at: string
          registered_by: string | null
          retired_at: string | null
          venue_id: string
        }
        Insert: {
          id: string
          is_till?: boolean
          mode?: string | null
          registered_at?: string
          registered_by?: string | null
          retired_at?: string | null
          venue_id: string
        }
        Update: {
          id?: string
          is_till?: boolean
          mode?: string | null
          registered_at?: string
          registered_by?: string | null
          retired_at?: string | null
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stations_registered_by_fkey"
            columns: ["registered_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stations_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_batches: {
        Row: {
          delivery_line_id: string | null
          expiry_date: string | null
          id: string
          ingredient_id: string
          location: Database["public"]["Enums"]["stock_location"]
          origin_batch_id: string | null
          qty_received: number
          qty_remaining: number
          received_at: string
          unit_cost_iqd: number
          venue_id: string
        }
        Insert: {
          delivery_line_id?: string | null
          expiry_date?: string | null
          id?: string
          ingredient_id: string
          location?: Database["public"]["Enums"]["stock_location"]
          origin_batch_id?: string | null
          qty_received: number
          qty_remaining: number
          received_at?: string
          unit_cost_iqd: number
          venue_id?: string
        }
        Update: {
          delivery_line_id?: string | null
          expiry_date?: string | null
          id?: string
          ingredient_id?: string
          location?: Database["public"]["Enums"]["stock_location"]
          origin_batch_id?: string | null
          qty_received?: number
          qty_remaining?: number
          received_at?: string
          unit_cost_iqd?: number
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_batches_delivery_line_id_fkey"
            columns: ["delivery_line_id"]
            isOneToOne: false
            referencedRelation: "delivery_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_batches_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_batches_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "v_ingredient_on_hand"
            referencedColumns: ["ingredient_id"]
          },
          {
            foreignKeyName: "stock_batches_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "v_stock_by_location"
            referencedColumns: ["ingredient_id"]
          },
          {
            foreignKeyName: "stock_batches_origin_batch_id_fkey"
            columns: ["origin_batch_id"]
            isOneToOne: false
            referencedRelation: "stock_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_batches_origin_batch_id_fkey"
            columns: ["origin_batch_id"]
            isOneToOne: false
            referencedRelation: "v_expired"
            referencedColumns: ["batch_id"]
          },
          {
            foreignKeyName: "stock_batches_origin_batch_id_fkey"
            columns: ["origin_batch_id"]
            isOneToOne: false
            referencedRelation: "v_expiring_soon"
            referencedColumns: ["batch_id"]
          },
          {
            foreignKeyName: "stock_batches_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_count_lines: {
        Row: {
          count_id: string
          counted_qty: number
          ingredient_id: string
          theoretical_qty: number
        }
        Insert: {
          count_id: string
          counted_qty: number
          ingredient_id: string
          theoretical_qty: number
        }
        Update: {
          count_id?: string
          counted_qty?: number
          ingredient_id?: string
          theoretical_qty?: number
        }
        Relationships: [
          {
            foreignKeyName: "stock_count_lines_count_id_fkey"
            columns: ["count_id"]
            isOneToOne: false
            referencedRelation: "stock_counts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_count_lines_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_count_lines_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "v_ingredient_on_hand"
            referencedColumns: ["ingredient_id"]
          },
          {
            foreignKeyName: "stock_count_lines_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "v_stock_by_location"
            referencedColumns: ["ingredient_id"]
          },
        ]
      }
      stock_counts: {
        Row: {
          counted_by: string
          finalized_at: string | null
          id: string
          location: Database["public"]["Enums"]["stock_location"]
          source: string
          started_at: string
          venue_id: string
        }
        Insert: {
          counted_by: string
          finalized_at?: string | null
          id?: string
          location?: Database["public"]["Enums"]["stock_location"]
          source?: string
          started_at?: string
          venue_id?: string
        }
        Update: {
          counted_by?: string
          finalized_at?: string | null
          id?: string
          location?: Database["public"]["Enums"]["stock_location"]
          source?: string
          started_at?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_counts_counted_by_fkey"
            columns: ["counted_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_counts_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_movements: {
        Row: {
          at: string
          batch_id: string | null
          count_id: string | null
          delivery_line_id: string | null
          device_id: string | null
          id: number
          ingredient_id: string
          location: Database["public"]["Enums"]["stock_location"]
          movement_type: Database["public"]["Enums"]["movement_type"]
          order_item_id: string | null
          qty_delta: number
          reason_code: string | null
          refund_id: string | null
          staff_id: string | null
          ticket_id: string | null
          unit_cost_iqd: number | null
          venue_id: string
        }
        Insert: {
          at?: string
          batch_id?: string | null
          count_id?: string | null
          delivery_line_id?: string | null
          device_id?: string | null
          id?: never
          ingredient_id: string
          location?: Database["public"]["Enums"]["stock_location"]
          movement_type: Database["public"]["Enums"]["movement_type"]
          order_item_id?: string | null
          qty_delta: number
          reason_code?: string | null
          refund_id?: string | null
          staff_id?: string | null
          ticket_id?: string | null
          unit_cost_iqd?: number | null
          venue_id?: string
        }
        Update: {
          at?: string
          batch_id?: string | null
          count_id?: string | null
          delivery_line_id?: string | null
          device_id?: string | null
          id?: never
          ingredient_id?: string
          location?: Database["public"]["Enums"]["stock_location"]
          movement_type?: Database["public"]["Enums"]["movement_type"]
          order_item_id?: string | null
          qty_delta?: number
          reason_code?: string | null
          refund_id?: string | null
          staff_id?: string | null
          ticket_id?: string | null
          unit_cost_iqd?: number | null
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_movements_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "stock_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "v_expired"
            referencedColumns: ["batch_id"]
          },
          {
            foreignKeyName: "stock_movements_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "v_expiring_soon"
            referencedColumns: ["batch_id"]
          },
          {
            foreignKeyName: "stock_movements_count_id_fkey"
            columns: ["count_id"]
            isOneToOne: false
            referencedRelation: "stock_counts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_delivery_line_id_fkey"
            columns: ["delivery_line_id"]
            isOneToOne: false
            referencedRelation: "delivery_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "v_ingredient_on_hand"
            referencedColumns: ["ingredient_id"]
          },
          {
            foreignKeyName: "stock_movements_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "v_stock_by_location"
            referencedColumns: ["ingredient_id"]
          },
          {
            foreignKeyName: "stock_movements_order_item_id_fkey"
            columns: ["order_item_id"]
            isOneToOne: false
            referencedRelation: "order_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_refund_id_fkey"
            columns: ["refund_id"]
            isOneToOne: false
            referencedRelation: "refunds"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_transfer_lines: {
        Row: {
          ingredient_id: string
          qty: number
          transfer_id: string
        }
        Insert: {
          ingredient_id: string
          qty: number
          transfer_id: string
        }
        Update: {
          ingredient_id?: string
          qty?: number
          transfer_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_transfer_lines_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_transfer_lines_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "v_ingredient_on_hand"
            referencedColumns: ["ingredient_id"]
          },
          {
            foreignKeyName: "stock_transfer_lines_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "v_stock_by_location"
            referencedColumns: ["ingredient_id"]
          },
          {
            foreignKeyName: "stock_transfer_lines_transfer_id_fkey"
            columns: ["transfer_id"]
            isOneToOne: false
            referencedRelation: "stock_transfers"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_transfers: {
        Row: {
          from_location: Database["public"]["Enums"]["stock_location"]
          id: string
          moved_at: string
          moved_by: string
          to_location: Database["public"]["Enums"]["stock_location"]
          venue_id: string
        }
        Insert: {
          from_location: Database["public"]["Enums"]["stock_location"]
          id?: string
          moved_at?: string
          moved_by: string
          to_location: Database["public"]["Enums"]["stock_location"]
          venue_id: string
        }
        Update: {
          from_location?: Database["public"]["Enums"]["stock_location"]
          id?: string
          moved_at?: string
          moved_by?: string
          to_location?: Database["public"]["Enums"]["stock_location"]
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_transfers_moved_by_fkey"
            columns: ["moved_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_transfers_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_receipt_lines: {
        Row: {
          confidence: number | null
          expiry_read: string | null
          flags: string[]
          id: string
          ingredient_id: string | null
          line_no: number
          line_total_iqd_read: number | null
          match_source: string
          qty_read: number | null
          receipt_id: string
          text_read: string
          unit_price_iqd_read: number | null
          unit_read: string | null
        }
        Insert: {
          confidence?: number | null
          expiry_read?: string | null
          flags?: string[]
          id?: string
          ingredient_id?: string | null
          line_no: number
          line_total_iqd_read?: number | null
          match_source?: string
          qty_read?: number | null
          receipt_id: string
          text_read: string
          unit_price_iqd_read?: number | null
          unit_read?: string | null
        }
        Update: {
          confidence?: number | null
          expiry_read?: string | null
          flags?: string[]
          id?: string
          ingredient_id?: string | null
          line_no?: number
          line_total_iqd_read?: number | null
          match_source?: string
          qty_read?: number | null
          receipt_id?: string
          text_read?: string
          unit_price_iqd_read?: number | null
          unit_read?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "supplier_receipt_lines_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_receipt_lines_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "v_ingredient_on_hand"
            referencedColumns: ["ingredient_id"]
          },
          {
            foreignKeyName: "supplier_receipt_lines_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "v_stock_by_location"
            referencedColumns: ["ingredient_id"]
          },
          {
            foreignKeyName: "supplier_receipt_lines_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: false
            referencedRelation: "supplier_receipts"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_receipts: {
        Row: {
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string
          delivery_id: string | null
          error_code: string | null
          id: string
          model: string | null
          read_at: string | null
          reading_started_at: string | null
          reading_token: string | null
          receipt_date: string | null
          rejected_at: string | null
          rejected_by: string | null
          rejected_reason: string | null
          source: string
          status: string
          storage_path: string
          supplier_id: string | null
          supplier_name_read: string | null
          total_iqd_read: number | null
          uploaded_by: string
          venue_id: string
        }
        Insert: {
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          delivery_id?: string | null
          error_code?: string | null
          id?: string
          model?: string | null
          read_at?: string | null
          reading_started_at?: string | null
          reading_token?: string | null
          receipt_date?: string | null
          rejected_at?: string | null
          rejected_by?: string | null
          rejected_reason?: string | null
          source: string
          status?: string
          storage_path: string
          supplier_id?: string | null
          supplier_name_read?: string | null
          total_iqd_read?: number | null
          uploaded_by: string
          venue_id: string
        }
        Update: {
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          delivery_id?: string | null
          error_code?: string | null
          id?: string
          model?: string | null
          read_at?: string | null
          reading_started_at?: string | null
          reading_token?: string | null
          receipt_date?: string | null
          rejected_at?: string | null
          rejected_by?: string | null
          rejected_reason?: string | null
          source?: string
          status?: string
          storage_path?: string
          supplier_id?: string | null
          supplier_name_read?: string | null
          total_iqd_read?: number | null
          uploaded_by?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplier_receipts_confirmed_by_fkey"
            columns: ["confirmed_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_receipts_delivery_id_fkey"
            columns: ["delivery_id"]
            isOneToOne: false
            referencedRelation: "deliveries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_receipts_rejected_by_fkey"
            columns: ["rejected_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_receipts_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_receipts_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_receipts_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          notes: string | null
          phone: string | null
          venue_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          notes?: string | null
          phone?: string | null
          venue_id?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          notes?: string | null
          phone?: string | null
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "suppliers_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      sync_replays: {
        Row: {
          conflict_detail: Json | null
          device_id: string
          entity: string
          id: number
          idempotency_key: string
          replayed_at: string
          result: string
        }
        Insert: {
          conflict_detail?: Json | null
          device_id: string
          entity: string
          id?: never
          idempotency_key: string
          replayed_at?: string
          result: string
        }
        Update: {
          conflict_detail?: Json | null
          device_id?: string
          entity?: string
          id?: never
          idempotency_key?: string
          replayed_at?: string
          result?: string
        }
        Relationships: []
      }
      tab_adjustments: {
        Row: {
          amount_iqd: number
          applied_by: string
          authorized_by: string
          created_at: string
          id: string
          kind: Database["public"]["Enums"]["adjustment_kind"]
          order_item_id: string | null
          promotion_id: string | null
          reason_code: string
          tab_id: string
          value: number
        }
        Insert: {
          amount_iqd: number
          applied_by: string
          authorized_by: string
          created_at?: string
          id?: string
          kind: Database["public"]["Enums"]["adjustment_kind"]
          order_item_id?: string | null
          promotion_id?: string | null
          reason_code: string
          tab_id: string
          value: number
        }
        Update: {
          amount_iqd?: number
          applied_by?: string
          authorized_by?: string
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["adjustment_kind"]
          order_item_id?: string | null
          promotion_id?: string | null
          reason_code?: string
          tab_id?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "tab_adjustments_applied_by_fkey"
            columns: ["applied_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tab_adjustments_authorized_by_fkey"
            columns: ["authorized_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tab_adjustments_order_item_id_fkey"
            columns: ["order_item_id"]
            isOneToOne: false
            referencedRelation: "order_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tab_adjustments_promotion_id_fkey"
            columns: ["promotion_id"]
            isOneToOne: false
            referencedRelation: "promotions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tab_adjustments_tab_id_fkey"
            columns: ["tab_id"]
            isOneToOne: false
            referencedRelation: "tabs"
            referencedColumns: ["id"]
          },
        ]
      }
      tabs: {
        Row: {
          court_cap_iqd: number | null
          court_iqd: number
          day_session_id: string
          device_id: string | null
          discount_iqd: number | null
          id: string
          idempotency_key: string | null
          kind: string
          label: string | null
          lesson_enrolment_id: string | null
          lesson_iqd: number
          merged_into_tab_id: string | null
          opened_at: string
          opened_by_staff_id: string | null
          reservation_id: string | null
          settled_at: string | null
          status: Database["public"]["Enums"]["tab_status"]
          subtotal_iqd: number | null
          table_id: string | null
          tax_iqd: number | null
          total_iqd: number | null
          venue_id: string
        }
        Insert: {
          court_cap_iqd?: number | null
          court_iqd?: number
          day_session_id: string
          device_id?: string | null
          discount_iqd?: number | null
          id?: string
          idempotency_key?: string | null
          kind?: string
          label?: string | null
          lesson_enrolment_id?: string | null
          lesson_iqd?: number
          merged_into_tab_id?: string | null
          opened_at?: string
          opened_by_staff_id?: string | null
          reservation_id?: string | null
          settled_at?: string | null
          status?: Database["public"]["Enums"]["tab_status"]
          subtotal_iqd?: number | null
          table_id?: string | null
          tax_iqd?: number | null
          total_iqd?: number | null
          venue_id?: string
        }
        Update: {
          court_cap_iqd?: number | null
          court_iqd?: number
          day_session_id?: string
          device_id?: string | null
          discount_iqd?: number | null
          id?: string
          idempotency_key?: string | null
          kind?: string
          label?: string | null
          lesson_enrolment_id?: string | null
          lesson_iqd?: number
          merged_into_tab_id?: string | null
          opened_at?: string
          opened_by_staff_id?: string | null
          reservation_id?: string | null
          settled_at?: string | null
          status?: Database["public"]["Enums"]["tab_status"]
          subtotal_iqd?: number | null
          table_id?: string | null
          tax_iqd?: number | null
          total_iqd?: number | null
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tabs_day_session_id_fkey"
            columns: ["day_session_id"]
            isOneToOne: false
            referencedRelation: "day_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tabs_day_session_id_fkey"
            columns: ["day_session_id"]
            isOneToOne: false
            referencedRelation: "v_day_close_summary"
            referencedColumns: ["day_session_id"]
          },
          {
            foreignKeyName: "tabs_lesson_enrolment_fkey"
            columns: ["lesson_enrolment_id"]
            isOneToOne: false
            referencedRelation: "lesson_enrolments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tabs_merged_into_tab_id_fkey"
            columns: ["merged_into_tab_id"]
            isOneToOne: false
            referencedRelation: "tabs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tabs_opened_by_staff_id_fkey"
            columns: ["opened_by_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tabs_reservation_id_fkey"
            columns: ["reservation_id"]
            isOneToOne: false
            referencedRelation: "reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tabs_reservation_venue_fkey"
            columns: ["reservation_id", "venue_id"]
            isOneToOne: false
            referencedRelation: "reservations"
            referencedColumns: ["id", "venue_id"]
          },
          {
            foreignKeyName: "tabs_table_id_fkey"
            columns: ["table_id"]
            isOneToOne: false
            referencedRelation: "cafe_tables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tabs_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      tax_groups: {
        Row: {
          id: string
          is_active: boolean
          name_ar: string
          name_en: string
          rate_bp: number
          venue_id: string
        }
        Insert: {
          id?: string
          is_active?: boolean
          name_ar: string
          name_en: string
          rate_bp?: number
          venue_id?: string
        }
        Update: {
          id?: string
          is_active?: boolean
          name_ar?: string
          name_en?: string
          rate_bp?: number
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tax_groups_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      teachings: {
        Row: {
          archived_at: string | null
          archived_by: string | null
          author_id: string
          body: string
          created_at: string
          id: string
          photos: string[]
          team: string
          title: string
          updated_at: string
          venue_id: string
        }
        Insert: {
          archived_at?: string | null
          archived_by?: string | null
          author_id: string
          body: string
          created_at?: string
          id?: string
          photos?: string[]
          team: string
          title: string
          updated_at?: string
          venue_id: string
        }
        Update: {
          archived_at?: string | null
          archived_by?: string | null
          author_id?: string
          body?: string
          created_at?: string
          id?: string
          photos?: string[]
          team?: string
          title?: string
          updated_at?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "teachings_archived_by_fkey"
            columns: ["archived_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teachings_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teachings_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      telegram_actions: {
        Row: {
          action: string
          at: string
          detail: string | null
          id: number
          ref_id: string
          result: string
          tg_first_name: string
          tg_user_id: number
          tg_username: string | null
          venue_id: string
        }
        Insert: {
          action: string
          at?: string
          detail?: string | null
          id?: never
          ref_id: string
          result: string
          tg_first_name: string
          tg_user_id: number
          tg_username?: string | null
          venue_id?: string
        }
        Update: {
          action?: string
          at?: string
          detail?: string | null
          id?: never
          ref_id?: string
          result?: string
          tg_first_name?: string
          tg_user_id?: number
          tg_username?: string | null
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "telegram_actions_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      telegram_chats: {
        Row: {
          bot_status: string
          chat_id: string
          title: string | null
          type: string
          updated_at: string
        }
        Insert: {
          bot_status: string
          chat_id: string
          title?: string | null
          type: string
          updated_at?: string
        }
        Update: {
          bot_status?: string
          chat_id?: string
          title?: string | null
          type?: string
          updated_at?: string
        }
        Relationships: []
      }
      telegram_outbox: {
        Row: {
          attempts: number
          chat_id: string
          created_at: string
          id: number
          kind: string
          last_error: string | null
          payload: Json
          ref_id: string | null
          reply_markup: Json | null
          scheduled_for: string
          sent_at: string | null
          status: string
          telegram_message_id: number | null
          text: string | null
          venue_id: string
        }
        Insert: {
          attempts?: number
          chat_id: string
          created_at?: string
          id?: never
          kind: string
          last_error?: string | null
          payload: Json
          ref_id?: string | null
          reply_markup?: Json | null
          scheduled_for?: string
          sent_at?: string | null
          status?: string
          telegram_message_id?: number | null
          text?: string | null
          venue_id?: string
        }
        Update: {
          attempts?: number
          chat_id?: string
          created_at?: string
          id?: never
          kind?: string
          last_error?: string | null
          payload?: Json
          ref_id?: string | null
          reply_markup?: Json | null
          scheduled_for?: string
          sent_at?: string | null
          status?: string
          telegram_message_id?: number | null
          text?: string | null
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "telegram_outbox_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      telegram_staff: {
        Row: {
          added_by: string | null
          can_void: boolean
          created_at: string
          is_active: boolean
          label: string | null
          staff_id: string
          tg_user_id: number
        }
        Insert: {
          added_by?: string | null
          can_void?: boolean
          created_at?: string
          is_active?: boolean
          label?: string | null
          staff_id: string
          tg_user_id: number
        }
        Update: {
          added_by?: string | null
          can_void?: boolean
          created_at?: string
          is_active?: boolean
          label?: string | null
          staff_id?: string
          tg_user_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "telegram_staff_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "telegram_staff_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      tickets: {
        Row: {
          actual_prep_seconds: number | null
          completed_at: string | null
          created_at: string
          device_id: string | null
          id: string
          idempotency_key: string | null
          last_actor_label: string | null
          order_id: string
          ready_at: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["ticket_status"]
          target_seconds: number
          venue_id: string
        }
        Insert: {
          actual_prep_seconds?: number | null
          completed_at?: string | null
          created_at?: string
          device_id?: string | null
          id?: string
          idempotency_key?: string | null
          last_actor_label?: string | null
          order_id: string
          ready_at?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["ticket_status"]
          target_seconds?: number
          venue_id?: string
        }
        Update: {
          actual_prep_seconds?: number | null
          completed_at?: string | null
          created_at?: string
          device_id?: string | null
          id?: string
          idempotency_key?: string | null
          last_actor_label?: string | null
          order_id?: string
          ready_at?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["ticket_status"]
          target_seconds?: number
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tickets_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      till_shifts: {
        Row: {
          authorized_by: string | null
          card_payments_iqd: number | null
          card_refunds_iqd: number | null
          cash_counted_iqd: number | null
          cash_expected_iqd: number | null
          cash_payments_iqd: number | null
          cash_refunds_iqd: number | null
          cash_variance_iqd: number | null
          close_note: string | null
          closed_at: string | null
          closed_by: string | null
          closed_via: string | null
          day_session_id: string
          drawer_open_count: number | null
          handover_difference_iqd: number | null
          handover_from_shift_id: string | null
          id: string
          open_note: string | null
          opened_at: string
          opening_float_iqd: number
          payment_count: number | null
          refund_count: number | null
          staff_id: string
          station_id: string
          venue_id: string
        }
        Insert: {
          authorized_by?: string | null
          card_payments_iqd?: number | null
          card_refunds_iqd?: number | null
          cash_counted_iqd?: number | null
          cash_expected_iqd?: number | null
          cash_payments_iqd?: number | null
          cash_refunds_iqd?: number | null
          cash_variance_iqd?: number | null
          close_note?: string | null
          closed_at?: string | null
          closed_by?: string | null
          closed_via?: string | null
          day_session_id: string
          drawer_open_count?: number | null
          handover_difference_iqd?: number | null
          handover_from_shift_id?: string | null
          id?: string
          open_note?: string | null
          opened_at?: string
          opening_float_iqd: number
          payment_count?: number | null
          refund_count?: number | null
          staff_id: string
          station_id: string
          venue_id: string
        }
        Update: {
          authorized_by?: string | null
          card_payments_iqd?: number | null
          card_refunds_iqd?: number | null
          cash_counted_iqd?: number | null
          cash_expected_iqd?: number | null
          cash_payments_iqd?: number | null
          cash_refunds_iqd?: number | null
          cash_variance_iqd?: number | null
          close_note?: string | null
          closed_at?: string | null
          closed_by?: string | null
          closed_via?: string | null
          day_session_id?: string
          drawer_open_count?: number | null
          handover_difference_iqd?: number | null
          handover_from_shift_id?: string | null
          id?: string
          open_note?: string | null
          opened_at?: string
          opening_float_iqd?: number
          payment_count?: number | null
          refund_count?: number | null
          staff_id?: string
          station_id?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "till_shifts_authorized_by_fkey"
            columns: ["authorized_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "till_shifts_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "till_shifts_day_session_id_fkey"
            columns: ["day_session_id"]
            isOneToOne: false
            referencedRelation: "day_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "till_shifts_day_session_id_fkey"
            columns: ["day_session_id"]
            isOneToOne: false
            referencedRelation: "v_day_close_summary"
            referencedColumns: ["day_session_id"]
          },
          {
            foreignKeyName: "till_shifts_handover_from_shift_id_fkey"
            columns: ["handover_from_shift_id"]
            isOneToOne: false
            referencedRelation: "till_shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "till_shifts_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "till_shifts_station_venue_fkey"
            columns: ["station_id", "venue_id"]
            isOneToOne: false
            referencedRelation: "stations"
            referencedColumns: ["id", "venue_id"]
          },
          {
            foreignKeyName: "till_shifts_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      venue_settings: {
        Row: {
          cancellation_window_hours: number
          cash_rounding_iqd: number
          closed_dates: string[]
          coach_max_open_private: number
          coach_share_bp: number
          coaching_enabled: boolean
          currency: string
          deposit_forfeit_no_show: boolean
          deposit_max_iqd: number | null
          deposit_min_iqd: number
          deposit_mode: string
          deposit_percent_bp: number
          deposit_window_seconds: number
          expiring_soon_days: number
          guest_items_per_order: number
          guest_orders_per_minute: number
          heartbeat_stale_seconds: number
          hold_ttl_seconds: number
          id: boolean
          lesson_payment_mode: string
          lesson_prices_public: boolean
          llm_cost_micros_per_mtok: number
          llm_daily_request_limit: number
          llm_default_model: string
          llm_monthly_cost_cap_micros: number
          llm_pricing: Json
          match_fill_deadline_minutes: number
          matches_enabled: boolean
          max_booking_horizon_days: number
          max_live_holds_per_guest: number
          offline_mode_enabled: boolean
          opening_hours: Json
          phone: string | null
          protected_horizon_hours: number
          tab_confirm_threshold_iqd: number
          table_token_ttl_minutes: number
          tax_inclusive: boolean
          timezone: string
          venue_id: string
          venue_name: string
          waiter_call_cooldown_seconds: number
        }
        Insert: {
          cancellation_window_hours?: number
          cash_rounding_iqd?: number
          closed_dates?: string[]
          coach_max_open_private?: number
          coach_share_bp?: number
          coaching_enabled?: boolean
          currency?: string
          deposit_forfeit_no_show?: boolean
          deposit_max_iqd?: number | null
          deposit_min_iqd?: number
          deposit_mode?: string
          deposit_percent_bp?: number
          deposit_window_seconds?: number
          expiring_soon_days?: number
          guest_items_per_order?: number
          guest_orders_per_minute?: number
          heartbeat_stale_seconds?: number
          hold_ttl_seconds?: number
          id?: boolean
          lesson_payment_mode?: string
          lesson_prices_public?: boolean
          llm_cost_micros_per_mtok?: number
          llm_daily_request_limit?: number
          llm_default_model?: string
          llm_monthly_cost_cap_micros?: number
          llm_pricing?: Json
          match_fill_deadline_minutes?: number
          matches_enabled?: boolean
          max_booking_horizon_days?: number
          max_live_holds_per_guest?: number
          offline_mode_enabled?: boolean
          opening_hours: Json
          phone?: string | null
          protected_horizon_hours?: number
          tab_confirm_threshold_iqd?: number
          table_token_ttl_minutes?: number
          tax_inclusive?: boolean
          timezone?: string
          venue_id?: string
          venue_name: string
          waiter_call_cooldown_seconds?: number
        }
        Update: {
          cancellation_window_hours?: number
          cash_rounding_iqd?: number
          closed_dates?: string[]
          coach_max_open_private?: number
          coach_share_bp?: number
          coaching_enabled?: boolean
          currency?: string
          deposit_forfeit_no_show?: boolean
          deposit_max_iqd?: number | null
          deposit_min_iqd?: number
          deposit_mode?: string
          deposit_percent_bp?: number
          deposit_window_seconds?: number
          expiring_soon_days?: number
          guest_items_per_order?: number
          guest_orders_per_minute?: number
          heartbeat_stale_seconds?: number
          hold_ttl_seconds?: number
          id?: boolean
          lesson_payment_mode?: string
          lesson_prices_public?: boolean
          llm_cost_micros_per_mtok?: number
          llm_daily_request_limit?: number
          llm_default_model?: string
          llm_monthly_cost_cap_micros?: number
          llm_pricing?: Json
          match_fill_deadline_minutes?: number
          matches_enabled?: boolean
          max_booking_horizon_days?: number
          max_live_holds_per_guest?: number
          offline_mode_enabled?: boolean
          opening_hours?: Json
          phone?: string | null
          protected_horizon_hours?: number
          tab_confirm_threshold_iqd?: number
          table_token_ttl_minutes?: number
          tax_inclusive?: boolean
          timezone?: string
          venue_id?: string
          venue_name?: string
          waiter_call_cooldown_seconds?: number
        }
        Relationships: []
      }
      venues: {
        Row: {
          address_ar: string | null
          address_en: string | null
          created_at: string
          id: string
          is_active: boolean
          map_url: string | null
          name_ar: string
          name_en: string
          phone: string | null
          slug: string
          status: Database["public"]["Enums"]["venue_status"]
          timezone: string
        }
        Insert: {
          address_ar?: string | null
          address_en?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          map_url?: string | null
          name_ar: string
          name_en: string
          phone?: string | null
          slug: string
          status?: Database["public"]["Enums"]["venue_status"]
          timezone?: string
        }
        Update: {
          address_ar?: string | null
          address_en?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          map_url?: string | null
          name_ar?: string
          name_en?: string
          phone?: string | null
          slug?: string
          status?: Database["public"]["Enums"]["venue_status"]
          timezone?: string
        }
        Relationships: []
      }
      wage_payments: {
        Row: {
          deduction_count: number
          deductions_iqd: number
          due_date: string
          id: string
          net_iqd: number
          paid_at: string
          paid_by: string
          paid_iqd: number
          pay_month: string
          penalties_iqd: number
          penalty_days: number
          salary_iqd: number
          staff_id: string
          status: string
          undo_reason: string | null
          undone_at: string | null
          undone_by: string | null
          venue_id: string
        }
        Insert: {
          deduction_count: number
          deductions_iqd: number
          due_date: string
          id?: string
          net_iqd: number
          paid_at?: string
          paid_by: string
          paid_iqd: number
          pay_month: string
          penalties_iqd: number
          penalty_days: number
          salary_iqd: number
          staff_id: string
          status?: string
          undo_reason?: string | null
          undone_at?: string | null
          undone_by?: string | null
          venue_id: string
        }
        Update: {
          deduction_count?: number
          deductions_iqd?: number
          due_date?: string
          id?: string
          net_iqd?: number
          paid_at?: string
          paid_by?: string
          paid_iqd?: number
          pay_month?: string
          penalties_iqd?: number
          penalty_days?: number
          salary_iqd?: number
          staff_id?: string
          status?: string
          undo_reason?: string | null
          undone_at?: string | null
          undone_by?: string | null
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wage_payments_paid_by_fkey"
            columns: ["paid_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wage_payments_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wage_payments_undone_by_fkey"
            columns: ["undone_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wage_payments_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      waiter_calls: {
        Row: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          acknowledged_label: string | null
          guest_session_id: string
          id: string
          raised_at: string
          reason: Database["public"]["Enums"]["waiter_call_reason"]
          resolved_at: string | null
          resolved_by: string | null
          resolved_label: string | null
          status: Database["public"]["Enums"]["waiter_call_status"]
          table_id: string
          venue_id: string
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          acknowledged_label?: string | null
          guest_session_id: string
          id?: string
          raised_at?: string
          reason: Database["public"]["Enums"]["waiter_call_reason"]
          resolved_at?: string | null
          resolved_by?: string | null
          resolved_label?: string | null
          status?: Database["public"]["Enums"]["waiter_call_status"]
          table_id: string
          venue_id?: string
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          acknowledged_label?: string | null
          guest_session_id?: string
          id?: string
          raised_at?: string
          reason?: Database["public"]["Enums"]["waiter_call_reason"]
          resolved_at?: string | null
          resolved_by?: string | null
          resolved_label?: string | null
          status?: Database["public"]["Enums"]["waiter_call_status"]
          table_id?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "waiter_calls_acknowledged_by_fkey"
            columns: ["acknowledged_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "waiter_calls_guest_session_id_fkey"
            columns: ["guest_session_id"]
            isOneToOne: false
            referencedRelation: "guest_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "waiter_calls_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "waiter_calls_table_id_fkey"
            columns: ["table_id"]
            isOneToOne: false
            referencedRelation: "cafe_tables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "waiter_calls_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      cafe_settings_public: {
        Row: {
          key: string | null
          value: Json | null
          venue_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cafe_settings_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      court_availability: {
        Row: {
          court_id: string | null
          end_at: string | null
          kind: Database["public"]["Enums"]["reservation_kind"] | null
          start_at: string | null
        }
        Insert: {
          court_id?: string | null
          end_at?: string | null
          kind?: never
          start_at?: string | null
        }
        Update: {
          court_id?: string | null
          end_at?: string | null
          kind?: never
          start_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reservations_court_id_fkey"
            columns: ["court_id"]
            isOneToOne: false
            referencedRelation: "courts"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_item_availability: {
        Row: {
          item_id: string | null
          orderable: boolean | null
        }
        Relationships: []
      }
      v_day_close_adjustments: {
        Row: {
          adjustment_id: string | null
          amount_iqd: number | null
          applied_by_name: string | null
          authorized_by_name: string | null
          created_at: string | null
          day_session_id: string | null
          kind: Database["public"]["Enums"]["adjustment_kind"] | null
          order_item_id: string | null
          reason_code: string | null
          tab_id: string | null
          value: number | null
        }
        Relationships: [
          {
            foreignKeyName: "tab_adjustments_order_item_id_fkey"
            columns: ["order_item_id"]
            isOneToOne: false
            referencedRelation: "order_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tab_adjustments_tab_id_fkey"
            columns: ["tab_id"]
            isOneToOne: false
            referencedRelation: "tabs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tabs_day_session_id_fkey"
            columns: ["day_session_id"]
            isOneToOne: false
            referencedRelation: "day_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tabs_day_session_id_fkey"
            columns: ["day_session_id"]
            isOneToOne: false
            referencedRelation: "v_day_close_summary"
            referencedColumns: ["day_session_id"]
          },
        ]
      }
      v_day_close_summary: {
        Row: {
          adjustment_count: number | null
          authorizer_names: string[] | null
          business_date: string | null
          card_expected_iqd: number | null
          card_payments_iqd: number | null
          card_terminal_batch_iqd: number | null
          cash_counted_iqd: number | null
          cash_expected_iqd: number | null
          cash_payments_iqd: number | null
          cash_variance_iqd: number | null
          closed_at: string | null
          day_session_id: string | null
          desk_card_iqd: number | null
          desk_cash_iqd: number | null
          discounts_iqd: number | null
          notes: string | null
          opened_at: string | null
          opening_float_iqd: number | null
          refund_count: number | null
          refunds_iqd: number | null
          status: Database["public"]["Enums"]["day_status"] | null
          voided_line_count: number | null
          voided_lines_iqd: number | null
          waste_cost_iqd: number | null
        }
        Relationships: []
      }
      v_expired: {
        Row: {
          batch_id: string | null
          days_expired: number | null
          expiry_date: string | null
          ingredient_id: string | null
          name_ar: string | null
          name_en: string | null
          qty_remaining: number | null
          unit: Database["public"]["Enums"]["stock_unit"] | null
          unit_cost_iqd: number | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_batches_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_batches_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "v_ingredient_on_hand"
            referencedColumns: ["ingredient_id"]
          },
          {
            foreignKeyName: "stock_batches_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "v_stock_by_location"
            referencedColumns: ["ingredient_id"]
          },
        ]
      }
      v_expiring_soon: {
        Row: {
          batch_id: string | null
          days_left: number | null
          expiry_date: string | null
          ingredient_id: string | null
          name_ar: string | null
          name_en: string | null
          qty_remaining: number | null
          unit: Database["public"]["Enums"]["stock_unit"] | null
          unit_cost_iqd: number | null
          venue_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_batches_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_batches_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "v_ingredient_on_hand"
            referencedColumns: ["ingredient_id"]
          },
          {
            foreignKeyName: "stock_batches_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "v_stock_by_location"
            referencedColumns: ["ingredient_id"]
          },
          {
            foreignKeyName: "stock_batches_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      v_ingredient_on_hand: {
        Row: {
          ingredient_id: string | null
          is_active: boolean | null
          kind: Database["public"]["Enums"]["ingredient_kind"] | null
          low_stock_threshold: number | null
          name_ar: string | null
          name_en: string | null
          on_hand: number | null
          par_level: number | null
          theoretical: number | null
          unit: Database["public"]["Enums"]["stock_unit"] | null
        }
        Relationships: []
      }
      v_item_cogs: {
        Row: {
          cogs_iqd: number | null
          item_id: string | null
          item_name_ar: string | null
          item_name_en: string | null
          price_iqd: number | null
          variant_id: string | null
          variant_name_ar: string | null
          variant_name_en: string | null
        }
        Relationships: [
          {
            foreignKeyName: "menu_item_variants_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
        ]
      }
      v_item_margin: {
        Row: {
          cogs_iqd: number | null
          item_id: string | null
          item_name_ar: string | null
          item_name_en: string | null
          margin_iqd: number | null
          margin_percent: number | null
          price_iqd: number | null
          variant_id: string | null
          variant_name_ar: string | null
          variant_name_en: string | null
        }
        Relationships: [
          {
            foreignKeyName: "menu_item_variants_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
        ]
      }
      v_stock_by_location: {
        Row: {
          ingredient_id: string | null
          is_active: boolean | null
          kind: Database["public"]["Enums"]["ingredient_kind"] | null
          location: Database["public"]["Enums"]["stock_location"] | null
          name_ar: string | null
          name_en: string | null
          on_hand: number | null
          theoretical: number | null
          unit: Database["public"]["Enums"]["stock_unit"] | null
          venue_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ingredients_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      v_variance_report: {
        Row: {
          count_id: string | null
          counted_qty: number | null
          expected_waste_qty: number | null
          expired_qty: number | null
          ingredient_id: string | null
          location: Database["public"]["Enums"]["stock_location"] | null
          movement_ids: number[] | null
          name_ar: string | null
          name_en: string | null
          period_end: string | null
          period_start: string | null
          product_test_qty: number | null
          recorded_waste_qty: number | null
          sold_qty: number | null
          theoretical_qty: number | null
          transfer_qty: number | null
          unit: Database["public"]["Enums"]["stock_unit"] | null
          variance_qty: number | null
          void_qty: number | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_count_lines_count_id_fkey"
            columns: ["count_id"]
            isOneToOne: false
            referencedRelation: "stock_counts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_count_lines_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_count_lines_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "v_ingredient_on_hand"
            referencedColumns: ["ingredient_id"]
          },
          {
            foreignKeyName: "stock_count_lines_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "v_stock_by_location"
            referencedColumns: ["ingredient_id"]
          },
        ]
      }
      venue_settings_public: {
        Row: {
          address_ar: string | null
          address_en: string | null
          cancellation_window_hours: number | null
          closed_dates: string[] | null
          coaching_enabled: boolean | null
          currency: string | null
          lesson_payment_mode: string | null
          lesson_prices_public: boolean | null
          map_url: string | null
          match_fill_deadline_minutes: number | null
          matches_enabled: boolean | null
          max_booking_horizon_days: number | null
          opening_hours: Json | null
          phone: string | null
          protected_horizon_hours: number | null
          table_token_ttl_minutes: number | null
          timezone: string | null
          venue_id: string | null
          venue_name: string | null
          venue_name_ar: string | null
          venue_name_en: string | null
          venue_slug: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      adjustment_kind: "discount_percent" | "discount_amount" | "price_override"
      alert_kind:
        | "negative_stock"
        | "low_stock"
        | "expiring_soon"
        | "replay_conflict"
      campaign_status: "draft" | "scheduled" | "live" | "ended" | "cancelled"
      cancellation_actor: "guest" | "staff"
      day_status: "open" | "closing" | "closed"
      ingredient_kind: "purchased" | "prepared" | "retail"
      marketing_channel: "telegram" | "guest_site" | "in_venue"
      movement_type:
        | "goods_in"
        | "production_in"
        | "sale_consumption"
        | "production_consume"
        | "waste_spill"
        | "waste_spoilage"
        | "void_after_send"
        | "expired_writeoff"
        | "count_adjustment"
        | "refund_reversal"
        | "product_test"
        | "transfer"
      order_source: "guest_web" | "till"
      order_status: "sent" | "preparing" | "ready" | "served" | "voided"
      payment_method: "cash" | "card"
      reservation_kind: "booking" | "hold" | "maintenance" | "lesson"
      reservation_source: "mobile" | "desk"
      reservation_status:
        | "pending"
        | "confirmed"
        | "arrived"
        | "completed"
        | "cancelled"
        | "no_show"
        | "expired"
      staff_request_kind: "leave" | "shift_swap" | "advance" | "correction"
      staff_request_status: "pending" | "approved" | "rejected" | "withdrawn"
      staff_role:
        | "cashier"
        | "prep"
        | "court_desk"
        | "manager"
        | "owner"
        | "head_barista"
        | "barista"
        | "head_chef"
        | "chef"
        | "driver"
        | "marketing"
        | "assistant_barista"
        | "waiter"
        | "shop_staff"
      stock_location: "cafe" | "bakery" | "shop"
      stock_unit: "g" | "ml" | "pc"
      tab_status: "open" | "awaiting_payment" | "settled" | "void"
      ticket_status: "queued" | "preparing" | "ready" | "completed" | "voided"
      venue_status: "preparing" | "open" | "closed"
      waiter_call_reason: "order" | "bill" | "water" | "assistance"
      waiter_call_status: "raised" | "acknowledged" | "resolved"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  app: {
    Enums: {},
  },
  public: {
    Enums: {
      adjustment_kind: [
        "discount_percent",
        "discount_amount",
        "price_override",
      ],
      alert_kind: [
        "negative_stock",
        "low_stock",
        "expiring_soon",
        "replay_conflict",
      ],
      campaign_status: ["draft", "scheduled", "live", "ended", "cancelled"],
      cancellation_actor: ["guest", "staff"],
      day_status: ["open", "closing", "closed"],
      ingredient_kind: ["purchased", "prepared", "retail"],
      marketing_channel: ["telegram", "guest_site", "in_venue"],
      movement_type: [
        "goods_in",
        "production_in",
        "sale_consumption",
        "production_consume",
        "waste_spill",
        "waste_spoilage",
        "void_after_send",
        "expired_writeoff",
        "count_adjustment",
        "refund_reversal",
        "product_test",
        "transfer",
      ],
      order_source: ["guest_web", "till"],
      order_status: ["sent", "preparing", "ready", "served", "voided"],
      payment_method: ["cash", "card"],
      reservation_kind: ["booking", "hold", "maintenance", "lesson"],
      reservation_source: ["mobile", "desk"],
      reservation_status: [
        "pending",
        "confirmed",
        "arrived",
        "completed",
        "cancelled",
        "no_show",
        "expired",
      ],
      staff_request_kind: ["leave", "shift_swap", "advance", "correction"],
      staff_request_status: ["pending", "approved", "rejected", "withdrawn"],
      staff_role: [
        "cashier",
        "prep",
        "court_desk",
        "manager",
        "owner",
        "head_barista",
        "barista",
        "head_chef",
        "chef",
        "driver",
        "marketing",
        "assistant_barista",
        "waiter",
        "shop_staff",
      ],
      stock_location: ["cafe", "bakery", "shop"],
      stock_unit: ["g", "ml", "pc"],
      tab_status: ["open", "awaiting_payment", "settled", "void"],
      ticket_status: ["queued", "preparing", "ready", "completed", "voided"],
      venue_status: ["preparing", "open", "closed"],
      waiter_call_reason: ["order", "bill", "water", "assistance"],
      waiter_call_status: ["raised", "acknowledged", "resolved"],
    },
  },
} as const

