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
            foreignKeyName: "penalties_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "round_players"
            referencedColumns: ["id"]
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
          id: string
          joined_at: string
          profile_id: string
          role: string
          round_id: string
          withdrew_at_hole: number | null
        }
        Insert: {
          display_name: string
          id?: string
          joined_at?: string
          profile_id: string
          role?: string
          round_id: string
          withdrew_at_hole?: number | null
        }
        Update: {
          display_name?: string
          id?: string
          joined_at?: string
          profile_id?: string
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
          game_type: string
          hole_deadline_at: string | null
          hole_phase: string
          host: string
          id: string
          name: string
          ruleset: Json
          status: string
          tee_off_at: string | null
          walk_deadline_at: string | null
        }
        Insert: {
          code?: string
          created_at?: string
          current_hole?: number
          game_type?: string
          hole_deadline_at?: string | null
          hole_phase?: string
          host: string
          id?: string
          name: string
          ruleset?: Json
          status?: string
          tee_off_at?: string | null
          walk_deadline_at?: string | null
        }
        Update: {
          code?: string
          created_at?: string
          current_hole?: number
          game_type?: string
          hole_deadline_at?: string | null
          hole_phase?: string
          host?: string
          id?: string
          name?: string
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
          player_id: string
          round_id: string
          swigs: number
          updated_at: string
        }
        Insert: {
          hole_number: number
          id?: string
          player_id: string
          round_id: string
          swigs?: number
          updated_at?: string
        }
        Update: {
          hole_number?: number
          id?: string
          player_id?: string
          round_id?: string
          swigs?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "scores_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "round_players"
            referencedColumns: ["id"]
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
      generate_round_code: { Args: never; Returns: string }
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
      is_round_member: { Args: { round: string }; Returns: boolean }
      is_round_official: { Args: { round: string }; Returns: boolean }
      join_round: {
        Args: { join_code: string; player_name: string }
        Returns: string
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

