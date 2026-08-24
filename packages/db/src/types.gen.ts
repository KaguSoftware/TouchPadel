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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      ack_waiter_call: { Args: { p_call_id: string }; Returns: Json }
      acknowledge_alert: { Args: { p_alert_id: string }; Returns: undefined }
      add_order_items: {
        Args: { p_items: Json; p_order_id: string }
        Returns: number
      }
      apply_discount: {
        Args: {
          p_device_id?: string
          p_kind: Database["public"]["Enums"]["adjustment_kind"]
          p_order_item_id?: string
          p_pin: string
          p_reason_code: string
          p_tab_id: string
          p_value: number
        }
        Returns: Json
      }
      assert_not_degraded_for: {
        Args: { p_start_at: string }
        Returns: undefined
      }
      b64url_decode: { Args: { p: string }; Returns: string }
      b64url_encode: { Args: { p: string }; Returns: string }
      cancel_reservation: {
        Args: { p_reason?: string; p_reservation_id: string }
        Returns: Json
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
      close_day: {
        Args: {
          p_card_batch_iqd?: number
          p_cash_counted_iqd: number
          p_device_id?: string
          p_notes?: string
        }
        Returns: Json
      }
      compute_tab_totals: {
        Args: { p_tab_id: string }
        Returns: {
          discount_iqd: number
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
      consume_for_order_item: {
        Args: { p_order_item_id: string; p_ticket_id?: string }
        Returns: undefined
      }
      create_guest_order: {
        Args: {
          p_device_id?: string
          p_idempotency_key?: string
          p_items: Json
        }
        Returns: Json
      }
      current_open_day: { Args: never; Returns: string }
      expire_stale_holds: {
        Args: { p_court_id?: string; p_period?: unknown }
        Returns: number
      }
      extend_reservation: {
        Args: { p_new_end_at: string; p_reservation_id: string }
        Returns: Json
      }
      finalize_count: {
        Args: { p_count_id: string; p_device_id?: string; p_lines?: Json }
        Returns: Json
      }
      flag_expired_batches: { Args: never; Returns: undefined }
      generate_table_token: { Args: { p_table_id: string }; Returns: string }
      heartbeat: {
        Args: {
          p_app_version?: string
          p_device_id: string
          p_queue_depth?: number
        }
        Returns: Json
      }
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
      ingredient_on_hand: { Args: { p_ingredient: string }; Returns: number }
      is_degraded: { Args: never; Returns: boolean }
      is_own_session: { Args: { p_session_id: string }; Returns: boolean }
      is_staff: {
        Args: { roles: Database["public"]["Enums"]["staff_role"][] }
        Returns: boolean
      }
      item_required_ingredients: {
        Args: { p_id: string }
        Returns: {
          ingredient_id: string
          qty: number
        }[]
      }
      link_item_modifier_group: {
        Args: {
          p_group_id: string
          p_item_id: string
          p_linked?: boolean
          p_sort_order?: number
        }
        Returns: undefined
      }
      log_replay: {
        Args: {
          p_conflict_detail?: Json
          p_device_id: string
          p_entity: string
          p_idempotency_key: string
          p_result: string
        }
        Returns: Json
      }
      mark_reservation: {
        Args: {
          p_reservation_id: string
          p_status: Database["public"]["Enums"]["reservation_status"]
        }
        Returns: Json
      }
      merge_tabs: {
        Args: { p_donor_tab_id: string; p_survivor_tab_id: string }
        Returns: Json
      }
      move_reservation: {
        Args: {
          p_court_id?: string
          p_end_at?: string
          p_reservation_id: string
          p_start_at?: string
        }
        Returns: Json
      }
      open_day: {
        Args: {
          p_business_date?: string
          p_device_id?: string
          p_opening_float_iqd: number
        }
        Returns: Json
      }
      open_tab: {
        Args: {
          p_device_id?: string
          p_idempotency_key?: string
          p_label?: string
          p_reservation_id?: string
          p_table_id?: string
        }
        Returns: Json
      }
      open_table_session: { Args: { p_token: string }; Returns: Json }
      order_is_callers: { Args: { p_order_id: string }; Returns: boolean }
      order_item_bom: {
        Args: { p_order_item_id: string }
        Returns: {
          ingredient_id: string
          qty: number
        }[]
      }
      override_price: {
        Args: {
          p_device_id?: string
          p_new_unit_price_iqd: number
          p_order_item_id: string
          p_pin: string
          p_reason_code: string
        }
        Returns: Json
      }
      price_slot: {
        Args: { p_court_id: string; p_duration_min: number; p_start_at: string }
        Returns: {
          price_iqd: number
          rule_id: string
        }[]
      }
      raise_waiter_call: {
        Args: { p_reason: Database["public"]["Enums"]["waiter_call_reason"] }
        Returns: Json
      }
      receive_delivery: {
        Args: {
          p_device_id?: string
          p_lines: Json
          p_notes?: string
          p_supplier_name?: string
        }
        Returns: Json
      }
      record_production: {
        Args: {
          p_device_id?: string
          p_expiry_date?: string
          p_ingredient_id: string
          p_qty: number
        }
        Returns: Json
      }
      record_waste: {
        Args: {
          p_device_id?: string
          p_ingredient_id: string
          p_movement_type?: Database["public"]["Enums"]["movement_type"]
          p_qty: number
          p_reason_code?: string
        }
        Returns: undefined
      }
      refund: {
        Args: {
          p_amount_iqd: number
          p_device_id?: string
          p_items?: Json
          p_payment_id: string
          p_pin: string
          p_reason_code: string
        }
        Returns: Json
      }
      resolve_waiter_call: { Args: { p_call_id: string }; Returns: Json }
      rotate_table_token: { Args: { p_table_id: string }; Returns: number }
      set_addon_suggestions: {
        Args: { p_item_id: string; p_suggested_item_ids: string[] }
        Returns: undefined
      }
      set_item_availability: {
        Args: { p_available: boolean; p_item_id: string }
        Returns: undefined
      }
      set_opening_hours: {
        Args: { p_closed_dates?: string[]; p_opening_hours?: Json }
        Returns: undefined
      }
      set_staff_pin: {
        Args: { p_pin: string; p_staff_id: string }
        Returns: undefined
      }
      set_ticket_status: {
        Args: {
          p_device_id?: string
          p_status: Database["public"]["Enums"]["ticket_status"]
          p_ticket_id: string
        }
        Returns: Json
      }
      settle_tab: {
        Args: {
          p_amount_iqd?: number
          p_device_id?: string
          p_idempotency_key?: string
          p_method: Database["public"]["Enums"]["payment_method"]
          p_tab_id: string
          p_tendered_iqd?: number
        }
        Returns: Json
      }
      split_evenly: {
        Args: { p_n: number; p_tab_id: string }
        Returns: number[]
      }
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
          p_start_at: string
        }
        Returns: Json
      }
      staff_role: {
        Args: never
        Returns: Database["public"]["Enums"]["staff_role"]
      }
      start_count: { Args: never; Returns: Json }
      sweep_degraded_periods: { Args: never; Returns: undefined }
      tab_is_callers: { Args: { p_tab_id: string }; Returns: boolean }
      table_token_secret: { Args: never; Returns: string }
      till_add_items: {
        Args: {
          p_device_id?: string
          p_idempotency_key?: string
          p_items: Json
          p_tab_id: string
        }
        Returns: Json
      }
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
      upsert_menu_category: {
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
      upsert_menu_item: {
        Args: {
          p_category_id: string
          p_description_ar?: string
          p_description_en?: string
          p_id?: string
          p_is_active?: boolean
          p_name_ar: string
          p_name_en: string
          p_photo_path?: string
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
      venue_mode: { Args: never; Returns: Json }
      verify_manager_pin: {
        Args: { p_device_id?: string; p_pin: string }
        Returns: string
      }
      verify_table_token: { Args: { p_token: string }; Returns: string }
      void_after_send: {
        Args: {
          p_device_id?: string
          p_order_item_id: string
          p_pin: string
          p_reason_code: string
        }
        Returns: Json
      }
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
      write_off_expired: {
        Args: {
          p_batch_id: string
          p_device_id?: string
          p_pin: string
          p_reason_code?: string
        }
        Returns: undefined
      }
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
            referencedRelation: "menu_item_availability"
            referencedColumns: ["item_id"]
          },
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
            referencedRelation: "menu_item_availability"
            referencedColumns: ["item_id"]
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
        }
        Relationships: []
      }
      cafe_tables: {
        Row: {
          capacity: number | null
          id: string
          is_active: boolean
          table_number: string
          token_version: number
          zone: string | null
        }
        Insert: {
          capacity?: number | null
          id?: string
          is_active?: boolean
          table_number: string
          token_version?: number
          zone?: string | null
        }
        Update: {
          capacity?: number | null
          id?: string
          is_active?: boolean
          table_number?: string
          token_version?: number
          zone?: string | null
        }
        Relationships: []
      }
      courts: {
        Row: {
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
        }
        Insert: {
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
        }
        Update: {
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
        }
        Relationships: []
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
        ]
      }
      degraded_periods: {
        Row: {
          detected_by: string
          ended_at: string | null
          id: string
          started_at: string
        }
        Insert: {
          detected_by?: string
          ended_at?: string | null
          id?: string
          started_at: string
        }
        Update: {
          detected_by?: string
          ended_at?: string | null
          id?: string
          started_at?: string
        }
        Relationships: []
      }
      deliveries: {
        Row: {
          id: string
          notes: string | null
          received_at: string
          received_by: string
          supplier_name: string | null
        }
        Insert: {
          id?: string
          notes?: string | null
          received_at?: string
          received_by: string
          supplier_name?: string | null
        }
        Update: {
          id?: string
          notes?: string | null
          received_at?: string
          received_by?: string
          supplier_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "deliveries_received_by_fkey"
            columns: ["received_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      delivery_lines: {
        Row: {
          delivery_id: string
          expiry_date: string | null
          id: string
          ingredient_id: string
          qty_expected: number | null
          qty_received: number
          unit_cost_iqd: number
        }
        Insert: {
          delivery_id: string
          expiry_date?: string | null
          id?: string
          ingredient_id: string
          qty_expected?: number | null
          qty_received: number
          unit_cost_iqd: number
        }
        Update: {
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
        ]
      }
      device_heartbeats: {
        Row: {
          app_version: string | null
          device_id: string
          last_seen_at: string
          queue_depth: number
        }
        Insert: {
          app_version?: string | null
          device_id: string
          last_seen_at?: string
          queue_depth?: number
        }
        Update: {
          app_version?: string | null
          device_id?: string
          last_seen_at?: string
          queue_depth?: number
        }
        Relationships: []
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
        ]
      }
      ingredients: {
        Row: {
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
          supplier_name: string | null
          unit: Database["public"]["Enums"]["stock_unit"]
          waste_allowance_percent: number
          yield_percent: number
        }
        Insert: {
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
          supplier_name?: string | null
          unit: Database["public"]["Enums"]["stock_unit"]
          waste_allowance_percent?: number
          yield_percent?: number
        }
        Update: {
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
          supplier_name?: string | null
          unit?: Database["public"]["Enums"]["stock_unit"]
          waste_allowance_percent?: number
          yield_percent?: number
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
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          created_at?: string
          id?: string
          kind: Database["public"]["Enums"]["alert_kind"]
          payload: Json
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["alert_kind"]
          payload?: Json
        }
        Relationships: [
          {
            foreignKeyName: "manager_alerts_acknowledged_by_fkey"
            columns: ["acknowledged_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_categories: {
        Row: {
          id: string
          is_active: boolean
          name_ar: string
          name_en: string
          sort_order: number
          tax_group_id: string
        }
        Insert: {
          id?: string
          is_active?: boolean
          name_ar: string
          name_en: string
          sort_order?: number
          tax_group_id: string
        }
        Update: {
          id?: string
          is_active?: boolean
          name_ar?: string
          name_en?: string
          sort_order?: number
          tax_group_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "menu_categories_tax_group_id_fkey"
            columns: ["tax_group_id"]
            isOneToOne: false
            referencedRelation: "tax_groups"
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
            referencedRelation: "menu_item_availability"
            referencedColumns: ["item_id"]
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
            referencedRelation: "menu_item_availability"
            referencedColumns: ["item_id"]
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
          id: string
          is_default: boolean
          item_id: string
          name_ar: string
          name_en: string
          price_iqd: number
          sort_order: number
        }
        Insert: {
          id?: string
          is_default?: boolean
          item_id: string
          name_ar: string
          name_en: string
          price_iqd: number
          sort_order?: number
        }
        Update: {
          id?: string
          is_default?: boolean
          item_id?: string
          name_ar?: string
          name_en?: string
          price_iqd?: number
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "menu_item_variants_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "menu_item_availability"
            referencedColumns: ["item_id"]
          },
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
          id: string
          is_active: boolean
          name_ar: string
          name_en: string
          photo_path: string | null
          sort_order: number
          unavailable_on: string | null
        }
        Insert: {
          category_id: string
          description_ar?: string | null
          description_en?: string | null
          id?: string
          is_active?: boolean
          name_ar: string
          name_en: string
          photo_path?: string | null
          sort_order?: number
          unavailable_on?: string | null
        }
        Update: {
          category_id?: string
          description_ar?: string | null
          description_en?: string | null
          id?: string
          is_active?: boolean
          name_ar?: string
          name_en?: string
          photo_path?: string | null
          sort_order?: number
          unavailable_on?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "menu_items_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "menu_categories"
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
        }
        Insert: {
          id?: string
          max_select?: number
          min_select?: number
          name_ar: string
          name_en: string
        }
        Update: {
          id?: string
          max_select?: number
          min_select?: number
          name_ar?: string
          name_en?: string
        }
        Relationships: []
      }
      modifiers: {
        Row: {
          group_id: string
          id: string
          is_active: boolean
          name_ar: string
          name_en: string
          price_delta_iqd: number
          sort_order: number
        }
        Insert: {
          group_id: string
          id?: string
          is_active?: boolean
          name_ar: string
          name_en: string
          price_delta_iqd?: number
          sort_order?: number
        }
        Update: {
          group_id?: string
          id?: string
          is_active?: boolean
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
          id: string
          line_total_iqd: number
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
          id?: string
          line_total_iqd: number
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
          id?: string
          line_total_iqd?: number
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
            referencedRelation: "menu_item_availability"
            referencedColumns: ["item_id"]
          },
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
        ]
      }
      profiles: {
        Row: {
          created_at: string
          expo_push_token: string | null
          full_name: string
          id: string
          phone: string | null
          preferred_lang: string
        }
        Insert: {
          created_at?: string
          expo_push_token?: string | null
          full_name: string
          id: string
          phone?: string | null
          preferred_lang?: string
        }
        Update: {
          created_at?: string
          expo_push_token?: string | null
          full_name?: string
          id?: string
          phone?: string | null
          preferred_lang?: string
        }
        Relationships: []
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
        }
        Relationships: [
          {
            foreignKeyName: "rate_rules_court_id_fkey"
            columns: ["court_id"]
            isOneToOne: false
            referencedRelation: "courts"
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
          id: string
          payment_id: string
          reason_code: string
          refunded_by: string
        }
        Insert: {
          amount_iqd: number
          created_at?: string
          id?: string
          payment_id: string
          reason_code: string
          refunded_by: string
        }
        Update: {
          amount_iqd?: number
          created_at?: string
          id?: string
          payment_id?: string
          reason_code?: string
          refunded_by?: string
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
        ]
      }
      reservations: {
        Row: {
          cancellation_reason: string | null
          cancelled_at: string | null
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
          notes: string | null
          period: unknown
          price_iqd: number | null
          rate_rule_id: string | null
          source: Database["public"]["Enums"]["reservation_source"]
          start_at: string
          status: Database["public"]["Enums"]["reservation_status"]
        }
        Insert: {
          cancellation_reason?: string | null
          cancelled_at?: string | null
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
          notes?: string | null
          period?: unknown
          price_iqd?: number | null
          rate_rule_id?: string | null
          source: Database["public"]["Enums"]["reservation_source"]
          start_at: string
          status?: Database["public"]["Enums"]["reservation_status"]
        }
        Update: {
          cancellation_reason?: string | null
          cancelled_at?: string | null
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
          notes?: string | null
          period?: unknown
          price_iqd?: number | null
          rate_rule_id?: string | null
          source?: Database["public"]["Enums"]["reservation_source"]
          start_at?: string
          status?: Database["public"]["Enums"]["reservation_status"]
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
            foreignKeyName: "reservations_rate_rule_id_fkey"
            columns: ["rate_rule_id"]
            isOneToOne: false
            referencedRelation: "rate_rules"
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
      stock_batches: {
        Row: {
          delivery_line_id: string | null
          expiry_date: string | null
          id: string
          ingredient_id: string
          qty_received: number
          qty_remaining: number
          received_at: string
          unit_cost_iqd: number
        }
        Insert: {
          delivery_line_id?: string | null
          expiry_date?: string | null
          id?: string
          ingredient_id: string
          qty_received: number
          qty_remaining: number
          received_at?: string
          unit_cost_iqd: number
        }
        Update: {
          delivery_line_id?: string | null
          expiry_date?: string | null
          id?: string
          ingredient_id?: string
          qty_received?: number
          qty_remaining?: number
          received_at?: string
          unit_cost_iqd?: number
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
            foreignKeyName: "stock_count_lines_count_id_fkey"
            columns: ["count_id"]
            isOneToOne: false
            referencedRelation: "v_variance_report"
            referencedColumns: ["count_id"]
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
        ]
      }
      stock_counts: {
        Row: {
          counted_by: string
          finalized_at: string | null
          id: string
          started_at: string
        }
        Insert: {
          counted_by: string
          finalized_at?: string | null
          id?: string
          started_at?: string
        }
        Update: {
          counted_by?: string
          finalized_at?: string | null
          id?: string
          started_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_counts_counted_by_fkey"
            columns: ["counted_by"]
            isOneToOne: false
            referencedRelation: "staff"
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
          movement_type: Database["public"]["Enums"]["movement_type"]
          order_item_id: string | null
          qty_delta: number
          reason_code: string | null
          refund_id: string | null
          staff_id: string | null
          ticket_id: string | null
          unit_cost_iqd: number | null
        }
        Insert: {
          at?: string
          batch_id?: string | null
          count_id?: string | null
          delivery_line_id?: string | null
          device_id?: string | null
          id?: never
          ingredient_id: string
          movement_type: Database["public"]["Enums"]["movement_type"]
          order_item_id?: string | null
          qty_delta: number
          reason_code?: string | null
          refund_id?: string | null
          staff_id?: string | null
          ticket_id?: string | null
          unit_cost_iqd?: number | null
        }
        Update: {
          at?: string
          batch_id?: string | null
          count_id?: string | null
          delivery_line_id?: string | null
          device_id?: string | null
          id?: never
          ingredient_id?: string
          movement_type?: Database["public"]["Enums"]["movement_type"]
          order_item_id?: string | null
          qty_delta?: number
          reason_code?: string | null
          refund_id?: string | null
          staff_id?: string | null
          ticket_id?: string | null
          unit_cost_iqd?: number | null
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
            foreignKeyName: "stock_movements_count_id_fkey"
            columns: ["count_id"]
            isOneToOne: false
            referencedRelation: "v_variance_report"
            referencedColumns: ["count_id"]
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
          day_session_id: string
          device_id: string | null
          discount_iqd: number | null
          id: string
          idempotency_key: string | null
          label: string | null
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
        }
        Insert: {
          day_session_id: string
          device_id?: string | null
          discount_iqd?: number | null
          id?: string
          idempotency_key?: string | null
          label?: string | null
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
        }
        Update: {
          day_session_id?: string
          device_id?: string | null
          discount_iqd?: number | null
          id?: string
          idempotency_key?: string | null
          label?: string | null
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
            foreignKeyName: "tabs_table_id_fkey"
            columns: ["table_id"]
            isOneToOne: false
            referencedRelation: "cafe_tables"
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
        }
        Insert: {
          id?: string
          is_active?: boolean
          name_ar: string
          name_en: string
          rate_bp?: number
        }
        Update: {
          id?: string
          is_active?: boolean
          name_ar?: string
          name_en?: string
          rate_bp?: number
        }
        Relationships: []
      }
      tickets: {
        Row: {
          actual_prep_seconds: number | null
          completed_at: string | null
          created_at: string
          device_id: string | null
          id: string
          idempotency_key: string | null
          order_id: string
          ready_at: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["ticket_status"]
          target_seconds: number
        }
        Insert: {
          actual_prep_seconds?: number | null
          completed_at?: string | null
          created_at?: string
          device_id?: string | null
          id?: string
          idempotency_key?: string | null
          order_id: string
          ready_at?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["ticket_status"]
          target_seconds?: number
        }
        Update: {
          actual_prep_seconds?: number | null
          completed_at?: string | null
          created_at?: string
          device_id?: string | null
          id?: string
          idempotency_key?: string | null
          order_id?: string
          ready_at?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["ticket_status"]
          target_seconds?: number
        }
        Relationships: [
          {
            foreignKeyName: "tickets_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      venue_settings: {
        Row: {
          cancellation_window_hours: number
          cash_rounding_iqd: number
          closed_dates: string[]
          currency: string
          expiring_soon_days: number
          heartbeat_stale_seconds: number
          hold_ttl_seconds: number
          id: boolean
          opening_hours: Json
          protected_horizon_hours: number
          table_token_ttl_minutes: number
          tax_inclusive: boolean
          timezone: string
          venue_name: string
          waiter_call_cooldown_seconds: number
        }
        Insert: {
          cancellation_window_hours?: number
          cash_rounding_iqd?: number
          closed_dates?: string[]
          currency?: string
          expiring_soon_days?: number
          heartbeat_stale_seconds?: number
          hold_ttl_seconds?: number
          id?: boolean
          opening_hours: Json
          protected_horizon_hours?: number
          table_token_ttl_minutes?: number
          tax_inclusive?: boolean
          timezone?: string
          venue_name: string
          waiter_call_cooldown_seconds?: number
        }
        Update: {
          cancellation_window_hours?: number
          cash_rounding_iqd?: number
          closed_dates?: string[]
          currency?: string
          expiring_soon_days?: number
          heartbeat_stale_seconds?: number
          hold_ttl_seconds?: number
          id?: boolean
          opening_hours?: Json
          protected_horizon_hours?: number
          table_token_ttl_minutes?: number
          tax_inclusive?: boolean
          timezone?: string
          venue_name?: string
          waiter_call_cooldown_seconds?: number
        }
        Relationships: []
      }
      waiter_calls: {
        Row: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          guest_session_id: string
          id: string
          raised_at: string
          reason: Database["public"]["Enums"]["waiter_call_reason"]
          resolved_at: string | null
          resolved_by: string | null
          status: Database["public"]["Enums"]["waiter_call_status"]
          table_id: string
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          guest_session_id: string
          id?: string
          raised_at?: string
          reason: Database["public"]["Enums"]["waiter_call_reason"]
          resolved_at?: string | null
          resolved_by?: string | null
          status?: Database["public"]["Enums"]["waiter_call_status"]
          table_id: string
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          guest_session_id?: string
          id?: string
          raised_at?: string
          reason?: Database["public"]["Enums"]["waiter_call_reason"]
          resolved_at?: string | null
          resolved_by?: string | null
          status?: Database["public"]["Enums"]["waiter_call_status"]
          table_id?: string
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
        ]
      }
    }
    Views: {
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
          kind?: Database["public"]["Enums"]["reservation_kind"] | null
          start_at?: string | null
        }
        Update: {
          court_id?: string | null
          end_at?: string | null
          kind?: Database["public"]["Enums"]["reservation_kind"] | null
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
        Insert: {
          item_id?: string | null
          orderable?: never
        }
        Update: {
          item_id?: string | null
          orderable?: never
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
            referencedRelation: "menu_item_availability"
            referencedColumns: ["item_id"]
          },
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
            referencedRelation: "menu_item_availability"
            referencedColumns: ["item_id"]
          },
          {
            foreignKeyName: "menu_item_variants_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
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
          movement_ids: number[] | null
          name_ar: string | null
          name_en: string | null
          period_end: string | null
          period_start: string | null
          recorded_waste_qty: number | null
          sold_qty: number | null
          theoretical_qty: number | null
          unit: Database["public"]["Enums"]["stock_unit"] | null
          variance_qty: number | null
          void_qty: number | null
        }
        Relationships: [
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
        ]
      }
      venue_settings_public: {
        Row: {
          cancellation_window_hours: number | null
          closed_dates: string[] | null
          currency: string | null
          opening_hours: Json | null
          protected_horizon_hours: number | null
          table_token_ttl_minutes: number | null
          timezone: string | null
          venue_name: string | null
        }
        Insert: {
          cancellation_window_hours?: number | null
          closed_dates?: string[] | null
          currency?: string | null
          opening_hours?: Json | null
          protected_horizon_hours?: number | null
          table_token_ttl_minutes?: number | null
          timezone?: string | null
          venue_name?: string | null
        }
        Update: {
          cancellation_window_hours?: number | null
          closed_dates?: string[] | null
          currency?: string | null
          opening_hours?: Json | null
          protected_horizon_hours?: number | null
          table_token_ttl_minutes?: number | null
          timezone?: string | null
          venue_name?: string | null
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
      day_status: "open" | "closing" | "closed"
      ingredient_kind: "purchased" | "prepared"
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
      order_source: "guest_web" | "till"
      order_status: "sent" | "preparing" | "ready" | "served" | "voided"
      payment_method: "cash" | "card"
      reservation_kind: "booking" | "hold" | "maintenance"
      reservation_source: "mobile" | "desk"
      reservation_status:
        | "pending"
        | "confirmed"
        | "arrived"
        | "completed"
        | "cancelled"
        | "no_show"
        | "expired"
      staff_role: "cashier" | "prep" | "court_desk" | "manager" | "owner"
      stock_unit: "g" | "ml" | "pc"
      tab_status: "open" | "awaiting_payment" | "settled" | "void"
      ticket_status: "queued" | "preparing" | "ready" | "completed" | "voided"
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
      day_status: ["open", "closing", "closed"],
      ingredient_kind: ["purchased", "prepared"],
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
      ],
      order_source: ["guest_web", "till"],
      order_status: ["sent", "preparing", "ready", "served", "voided"],
      payment_method: ["cash", "card"],
      reservation_kind: ["booking", "hold", "maintenance"],
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
      staff_role: ["cashier", "prep", "court_desk", "manager", "owner"],
      stock_unit: ["g", "ml", "pc"],
      tab_status: ["open", "awaiting_payment", "settled", "void"],
      ticket_status: ["queued", "preparing", "ready", "completed", "voided"],
      waiter_call_reason: ["order", "bill", "water", "assistance"],
      waiter_call_status: ["raised", "acknowledged", "resolved"],
    },
  },
} as const

