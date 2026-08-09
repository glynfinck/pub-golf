export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
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
      course_holes: {
        Row: {
          course_id: string
          drink: string
          hazard: string | null
          hazard_note: string | null
          id: string
          number: number
          par: number
          penalties: Json
          venue_id: string | null
          venue_name: string
          walk_minutes_to_next: number | null
        }
        Insert: {
          course_id: string
          drink: string
          hazard?: string | null
          hazard_note?: string | null
          id?: string
          number: number
          par: number
          penalties?: Json
          venue_id?: string | null
          venue_name: string
          walk_minutes_to_next?: number | null
        }
        Update: {
          course_id?: string
          drink?: string
          hazard?: string | null
          hazard_note?: string | null
          id?: string
          number?: number
          par?: number
          penalties?: Json
          venue_id?: string | null
          venue_name?: string
          walk_minutes_to_next?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "course_holes_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "course_holes_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      courses: {
        Row: {
          created_at: string
          id: string
          name: string
          owner: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          owner: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          owner?: string
        }
        Relationships: [
          {
            foreignKeyName: "courses_owner_fkey"
            columns: ["owner"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      entitlements: {
        Row: {
          amount_total: number | null
          created_at: string
          currency: string | null
          expires_at: string | null
          id: string
          kind: string
          round_id: string | null
          stripe_event_id: string
          stripe_session_id: string | null
          user_id: string
        }
        Insert: {
          amount_total?: number | null
          created_at?: string
          currency?: string | null
          expires_at?: string | null
          id?: string
          kind: string
          round_id?: string | null
          stripe_event_id: string
          stripe_session_id?: string | null
          user_id: string
        }
        Update: {
          amount_total?: number | null
          created_at?: string
          currency?: string | null
          expires_at?: string | null
          id?: string
          kind?: string
          round_id?: string | null
          stripe_event_id?: string
          stripe_session_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "entitlements_round_id_fkey"
            columns: ["round_id"]
            isOneToOne: false
            referencedRelation: "rounds"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entitlements_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      game_types: {
        Row: {
          description: string | null
          id: string
          is_curated: boolean
          name: string
        }
        Insert: {
          description?: string | null
          id: string
          is_curated?: boolean
          name: string
        }
        Update: {
          description?: string | null
          id?: string
          is_curated?: boolean
          name?: string
        }
        Relationships: []
      }
      holes: {
        Row: {
          drink: string
          hazard: string | null
          hazard_note: string | null
          id: string
          number: number
          par: number
          penalties: Json
          round_id: string
          venue_id: string | null
          venue_name: string
          walk_minutes_to_next: number | null
        }
        Insert: {
          drink: string
          hazard?: string | null
          hazard_note?: string | null
          id?: string
          number: number
          par: number
          penalties?: Json
          round_id: string
          venue_id?: string | null
          venue_name: string
          walk_minutes_to_next?: number | null
        }
        Update: {
          drink?: string
          hazard?: string | null
          hazard_note?: string | null
          id?: string
          number?: number
          par?: number
          penalties?: Json
          round_id?: string
          venue_id?: string | null
          venue_name?: string
          walk_minutes_to_next?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "holes_round_id_fkey"
            columns: ["round_id"]
            isOneToOne: false
            referencedRelation: "rounds"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "holes_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      penalties: {
        Row: {
          called_by: string | null
          created_at: string
          hole_number: number | null
          id: string
          player_id: string
          reason: string
          round_id: string
          strokes: number
        }
        Insert: {
          called_by?: string | null
          created_at?: string
          hole_number?: number | null
          id?: string
          player_id: string
          reason: string
          round_id: string
          strokes: number
        }
        Update: {
          called_by?: string | null
          created_at?: string
          hole_number?: number | null
          id?: string
          player_id?: string
          reason?: string
          round_id?: string
          strokes?: number
        }
        Relationships: [
          {
            foreignKeyName: "penalties_called_by_fkey"
            columns: ["called_by"]
            isOneToOne: false
            referencedRelation: "round_players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "penalties_player_id_round_id_fkey"
            columns: ["player_id", "round_id"]
            isOneToOne: false
            referencedRelation: "round_players"
            referencedColumns: ["id", "round_id"]
          },
          {
            foreignKeyName: "penalties_round_id_fkey"
            columns: ["round_id"]
            isOneToOne: false
            referencedRelation: "rounds"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string
          id: string
        }
        Insert: {
          created_at?: string
          display_name?: string
          id: string
        }
        Update: {
          created_at?: string
          display_name?: string
          id?: string
        }
        Relationships: []
      }
      round_players: {
        Row: {
          display_name: string
          handicap: number
          id: string
          joined_at: string
          profile_id: string
          rescue_requested_at: string | null
          rescue_requested_by: string | null
          role: string
          round_id: string
          withdrew_at_hole: number | null
        }
        Insert: {
          display_name: string
          handicap?: number
          id?: string
          joined_at?: string
          profile_id: string
          rescue_requested_at?: string | null
          rescue_requested_by?: string | null
          role?: string
          round_id: string
          withdrew_at_hole?: number | null
        }
        Update: {
          display_name?: string
          handicap?: number
          id?: string
          joined_at?: string
          profile_id?: string
          rescue_requested_at?: string | null
          rescue_requested_by?: string | null
          role?: string
          round_id?: string
          withdrew_at_hole?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "round_players_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "round_players_rescue_requested_by_fkey"
            columns: ["rescue_requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "round_players_round_id_fkey"
            columns: ["round_id"]
            isOneToOne: false
            referencedRelation: "rounds"
            referencedColumns: ["id"]
          },
        ]
      }
      rounds: {
        Row: {
          code: string
          created_at: string
          current_hole: number
          finished_at: string | null
          game_type: string
          hole_deadline_at: string | null
          hole_phase: string
          host: string
          id: string
          name: string
          recap_shares: number
          ruleset: Json
          status: string
          tee_off_at: string | null
          walk_deadline_at: string | null
        }
        Insert: {
          code?: string
          created_at?: string
          current_hole?: number
          finished_at?: string | null
          game_type?: string
          hole_deadline_at?: string | null
          hole_phase?: string
          host: string
          id?: string
          name: string
          recap_shares?: number
          ruleset?: Json
          status?: string
          tee_off_at?: string | null
          walk_deadline_at?: string | null
        }
        Update: {
          code?: string
          created_at?: string
          current_hole?: number
          finished_at?: string | null
          game_type?: string
          hole_deadline_at?: string | null
          hole_phase?: string
          host?: string
          id?: string
          name?: string
          recap_shares?: number
          ruleset?: Json
          status?: string
          tee_off_at?: string | null
          walk_deadline_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rounds_game_type_fkey"
            columns: ["game_type"]
            isOneToOne: false
            referencedRelation: "game_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rounds_host_fkey"
            columns: ["host"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      rulesets: {
        Row: {
          config: Json
          created_at: string
          game_type: string
          id: string
          is_preset: boolean
          name: string
          owner: string | null
        }
        Insert: {
          config?: Json
          created_at?: string
          game_type: string
          id?: string
          is_preset?: boolean
          name: string
          owner?: string | null
        }
        Update: {
          config?: Json
          created_at?: string
          game_type?: string
          id?: string
          is_preset?: boolean
          name?: string
          owner?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rulesets_game_type_fkey"
            columns: ["game_type"]
            isOneToOne: false
            referencedRelation: "game_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rulesets_owner_fkey"
            columns: ["owner"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      scores: {
        Row: {
          hole_number: number
          id: string
          mulligans: number
          player_id: string
          round_id: string
          swigs: number
          updated_at: string
        }
        Insert: {
          hole_number: number
          id?: string
          mulligans?: number
          player_id: string
          round_id: string
          swigs?: number
          updated_at?: string
        }
        Update: {
          hole_number?: number
          id?: string
          mulligans?: number
          player_id?: string
          round_id?: string
          swigs?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "scores_player_id_round_id_fkey"
            columns: ["player_id", "round_id"]
            isOneToOne: false
            referencedRelation: "round_players"
            referencedColumns: ["id", "round_id"]
          },
          {
            foreignKeyName: "scores_round_id_fkey"
            columns: ["round_id"]
            isOneToOne: false
            referencedRelation: "rounds"
            referencedColumns: ["id"]
          },
        ]
      }
      venues: {
        Row: {
          address: string | null
          fetched_at: string
          google_place_id: string | null
          id: string
          lat: number | null
          lng: number | null
          name: string
          rating: number | null
          review_count: number | null
        }
        Insert: {
          address?: string | null
          fetched_at?: string
          google_place_id?: string | null
          id?: string
          lat?: number | null
          lng?: number | null
          name: string
          rating?: number | null
          review_count?: number | null
        }
        Update: {
          address?: string | null
          fetched_at?: string
          google_place_id?: string | null
          id?: string
          lat?: number | null
          lng?: number | null
          name?: string
          rating?: number | null
          review_count?: number | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      approve_seat_rescue: { Args: { seat: string }; Returns: undefined }
      dismiss_seat_rescue: { Args: { seat: string }; Returns: undefined }
      generate_round_code: { Args: never; Returns: string }
      get_round_card: {
        Args: { join_code: string }
        Returns: {
          created_at: string
          hole_count: number
          name: string
          par: number
          status: string
        }[]
      }
      get_round_preview: {
        Args: { join_code: string }
        Returns: {
          game_type: string
          hole_count: number
          host_name: string
          name: string
          par: number
          player_count: number
          status: string
          tee_off_at: string
        }[]
      }
      get_round_seats: {
        Args: { join_code: string }
        Returns: {
          claimable: boolean
          display_name: string
          holes_scored: number
          mine: boolean
          requested: boolean
          requested_by_me: boolean
          role: string
          seat_id: string
        }[]
      }
      holds_day_pass: { Args: { who: string }; Returns: boolean }
      house_funnel: {
        Args: { since?: string; until?: string }
        Returns: {
          green_fees: number
          recaps_shared: number
          rounds_created: number
          rounds_finished: number
          rounds_joined: number
        }[]
      }
      is_round_creator: { Args: { round: string }; Returns: boolean }
      is_round_member: { Args: { round: string }; Returns: boolean }
      is_round_official: { Args: { round: string }; Returns: boolean }
      join_round: {
        Args: { join_code: string; player_name: string }
        Returns: string
      }
      record_recap_share: { Args: { join_code: string }; Returns: number }
      ruleset_members: { Args: { rules: Json }; Returns: boolean }
      request_seat_rescue: {
        Args: { join_code: string; seat: string }
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const

