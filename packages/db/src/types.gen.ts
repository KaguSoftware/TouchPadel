export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.15"
  }
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      assert_not_degraded_for: {
        Args: { p_start_at: string }
        Returns: undefined
      }
      cancel_reservation: {
        Args: { p_reason?: string; p_reservation_id: string }
        Returns: Json
      }
      confirm_booking: {
        Args: {
          p_guest_name?: string
          p_guest_phone?: string
          p_hold_id: string
        }
        Returns: Json
      }
      expire_stale_holds: {
        Args: { p_court_id?: string; p_period?: unknown }
        Returns: number
      }
      extend_reservation: {
        Args: { p_new_end_at: string; p_reservation_id: string }
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
      is_degraded: { Args: never; Returns: boolean }
      is_staff: {
        Args: { roles: Database["public"]["Enums"]["staff_role"][] }
        Returns: boolean
      }
      mark_reservation: {
        Args: {
          p_reservation_id: string
          p_status: Database["public"]["Enums"]["reservation_status"]
        }
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
      price_slot: {
        Args: { p_court_id: string; p_duration_min: number; p_start_at: string }
        Returns: {
          price_iqd: number
          rule_id: string
        }[]
      }
      set_staff_pin: {
        Args: { p_pin: string; p_staff_id: string }
        Returns: undefined
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
      verify_manager_pin: {
        Args: { p_device_id?: string; p_pin: string }
        Returns: string
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
