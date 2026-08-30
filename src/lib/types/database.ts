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
    PostgrestVersion: "14.17"
  }
  public: {
    Tables: {
      analyzer_cache: {
        Row: {
          created_at: string
          data: Json
          expires_at: string
          id: string
          platform: string
          range: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          data: Json
          expires_at: string
          id?: string
          platform: string
          range: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          data?: Json
          expires_at?: string
          id?: string
          platform?: string
          range?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "analyzer_cache_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      approval_history: {
        Row: {
          action: string
          actor_user_id: string | null
          content_id: string
          created_at: string
          id: string
          note: string | null
          stage_index: number | null
          stage_name: string | null
          workspace_id: string
        }
        Insert: {
          action: string
          actor_user_id?: string | null
          content_id: string
          created_at?: string
          id?: string
          note?: string | null
          stage_index?: number | null
          stage_name?: string | null
          workspace_id: string
        }
        Update: {
          action?: string
          actor_user_id?: string | null
          content_id?: string
          created_at?: string
          id?: string
          note?: string | null
          stage_index?: number | null
          stage_name?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "approval_history_content_id_fkey"
            columns: ["content_id"]
            isOneToOne: false
            referencedRelation: "content_pieces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approval_history_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      asset_folders: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          name: string
          parent_folder_id: string | null
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          parent_folder_id?: string | null
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          parent_folder_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "asset_folders_parent_folder_id_fkey"
            columns: ["parent_folder_id"]
            isOneToOne: false
            referencedRelation: "asset_folders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_folders_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      assets: {
        Row: {
          asset_type: string
          created_at: string
          file_size_bytes: number | null
          folder_id: string | null
          height: number | null
          id: string
          mime_type: string
          name: string
          storage_path: string
          tags: string[]
          uploaded_by: string | null
          used_count: number
          width: number | null
          workspace_id: string
        }
        Insert: {
          asset_type: string
          created_at?: string
          file_size_bytes?: number | null
          folder_id?: string | null
          height?: number | null
          id?: string
          mime_type: string
          name: string
          storage_path: string
          tags?: string[]
          uploaded_by?: string | null
          used_count?: number
          width?: number | null
          workspace_id: string
        }
        Update: {
          asset_type?: string
          created_at?: string
          file_size_bytes?: number | null
          folder_id?: string | null
          height?: number | null
          id?: string
          mime_type?: string
          name?: string
          storage_path?: string
          tags?: string[]
          uploaded_by?: string | null
          used_count?: number
          width?: number | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "assets_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "asset_folders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assets_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      byok_usage_log: {
        Row: {
          created_at: string
          fallback_reason: string | null
          id: string
          provider: string | null
          route: string
          used_byok: boolean
          workspace_id: string
        }
        Insert: {
          created_at?: string
          fallback_reason?: string | null
          id?: string
          provider?: string | null
          route: string
          used_byok: boolean
          workspace_id: string
        }
        Update: {
          created_at?: string
          fallback_reason?: string | null
          id?: string
          provider?: string | null
          route?: string
          used_byok?: boolean
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "byok_usage_log_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      calendar_events: {
        Row: {
          content_id: string | null
          created_at: string
          id: string
          platform: string | null
          scheduled_at: string
          status: string
          title: string
          workspace_id: string
        }
        Insert: {
          content_id?: string | null
          created_at?: string
          id?: string
          platform?: string | null
          scheduled_at: string
          status?: string
          title: string
          workspace_id: string
        }
        Update: {
          content_id?: string | null
          created_at?: string
          id?: string
          platform?: string | null
          scheduled_at?: string
          status?: string
          title?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "calendar_events_content_id_fkey"
            columns: ["content_id"]
            isOneToOne: false
            referencedRelation: "content_pieces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calendar_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      campaigns: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          end_date: string | null
          goal: string | null
          id: string
          name: string
          start_date: string | null
          status: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          end_date?: string | null
          goal?: string | null
          id?: string
          name: string
          start_date?: string | null
          status?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          end_date?: string | null
          goal?: string | null
          id?: string
          name?: string
          start_date?: string | null
          status?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaigns_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      comments: {
        Row: {
          body: string
          content_id: string
          created_at: string
          id: string
          metadata: Json | null
          resolved_at: string | null
          user_id: string
        }
        Insert: {
          body: string
          content_id: string
          created_at?: string
          id?: string
          metadata?: Json | null
          resolved_at?: string | null
          user_id: string
        }
        Update: {
          body?: string
          content_id?: string
          created_at?: string
          id?: string
          metadata?: Json | null
          resolved_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "comments_content_id_fkey"
            columns: ["content_id"]
            isOneToOne: false
            referencedRelation: "content_pieces"
            referencedColumns: ["id"]
          },
        ]
      }
      content_piece_assets: {
        Row: {
          asset_id: string
          content_id: string
        }
        Insert: {
          asset_id: string
          content_id: string
        }
        Update: {
          asset_id?: string
          content_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_piece_assets_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_piece_assets_content_id_fkey"
            columns: ["content_id"]
            isOneToOne: false
            referencedRelation: "content_pieces"
            referencedColumns: ["id"]
          },
        ]
      }
      content_pieces: {
        Row: {
          ai_detection_score: number | null
          brand_consistency_score: number | null
          brand_voice: string | null
          campaign_id: string | null
          content: string | null
          content_type: string | null
          created_at: string
          created_by: string | null
          current_stage_index: number | null
          deleted_at: string | null
          engagement_score: number | null
          fts: unknown
          header_image_prompt: string | null
          header_image_url: string | null
          id: string
          industry: string | null
          keyword: string | null
          metadata: Json | null
          parent_id: string | null
          plagiarism_checked_at: string | null
          plagiarism_report_url: string | null
          plagiarism_score: number | null
          platforms: string[] | null
          predicted_engagement_reasoning: string | null
          predicted_engagement_tier: string | null
          published_url: string | null
          purge_claimed_at: string | null
          repurpose_type: string | null
          status: string
          target_audience: string | null
          title: string | null
          tone: string | null
          updated_at: string
          word_count: number | null
          workspace_id: string
        }
        Insert: {
          ai_detection_score?: number | null
          brand_consistency_score?: number | null
          brand_voice?: string | null
          campaign_id?: string | null
          content?: string | null
          content_type?: string | null
          created_at?: string
          created_by?: string | null
          current_stage_index?: number | null
          deleted_at?: string | null
          engagement_score?: number | null
          fts?: unknown
          header_image_prompt?: string | null
          header_image_url?: string | null
          id?: string
          industry?: string | null
          keyword?: string | null
          metadata?: Json | null
          parent_id?: string | null
          plagiarism_checked_at?: string | null
          plagiarism_report_url?: string | null
          plagiarism_score?: number | null
          platforms?: string[] | null
          predicted_engagement_reasoning?: string | null
          predicted_engagement_tier?: string | null
          published_url?: string | null
          purge_claimed_at?: string | null
          repurpose_type?: string | null
          status?: string
          target_audience?: string | null
          title?: string | null
          tone?: string | null
          updated_at?: string
          word_count?: number | null
          workspace_id: string
        }
        Update: {
          ai_detection_score?: number | null
          brand_consistency_score?: number | null
          brand_voice?: string | null
          campaign_id?: string | null
          content?: string | null
          content_type?: string | null
          created_at?: string
          created_by?: string | null
          current_stage_index?: number | null
          deleted_at?: string | null
          engagement_score?: number | null
          fts?: unknown
          header_image_prompt?: string | null
          header_image_url?: string | null
          id?: string
          industry?: string | null
          keyword?: string | null
          metadata?: Json | null
          parent_id?: string | null
          plagiarism_checked_at?: string | null
          plagiarism_report_url?: string | null
          plagiarism_score?: number | null
          platforms?: string[] | null
          predicted_engagement_reasoning?: string | null
          predicted_engagement_tier?: string | null
          published_url?: string | null
          purge_claimed_at?: string | null
          repurpose_type?: string | null
          status?: string
          target_audience?: string | null
          title?: string | null
          tone?: string | null
          updated_at?: string
          word_count?: number | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_pieces_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_pieces_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "content_pieces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_pieces_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      content_versions: {
        Row: {
          content: string
          content_id: string
          created_at: string
          created_by: string | null
          id: string
          version_number: number
        }
        Insert: {
          content: string
          content_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          version_number: number
        }
        Update: {
          content?: string
          content_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "content_versions_content_id_fkey"
            columns: ["content_id"]
            isOneToOne: false
            referencedRelation: "content_pieces"
            referencedColumns: ["id"]
          },
        ]
      }
      domains: {
        Row: {
          created_at: string
          domain: string
          error_message: string | null
          id: string
          status: string
          updated_at: string
          vercel_domain_id: string | null
          verification_txt: string | null
          workspace_id: string
        }
        Insert: {
          created_at?: string
          domain: string
          error_message?: string | null
          id?: string
          status?: string
          updated_at?: string
          vercel_domain_id?: string | null
          verification_txt?: string | null
          workspace_id: string
        }
        Update: {
          created_at?: string
          domain?: string
          error_message?: string | null
          id?: string
          status?: string
          updated_at?: string
          vercel_domain_id?: string | null
          verification_txt?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "domains_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      generation_logs: {
        Row: {
          content_id: string | null
          cost_usd: number | null
          created_at: string
          id: string
          input_tokens: number | null
          model: string
          output_tokens: number | null
          user_id: string | null
          workspace_id: string | null
        }
        Insert: {
          content_id?: string | null
          cost_usd?: number | null
          created_at?: string
          id?: string
          input_tokens?: number | null
          model: string
          output_tokens?: number | null
          user_id?: string | null
          workspace_id?: string | null
        }
        Update: {
          content_id?: string | null
          cost_usd?: number | null
          created_at?: string
          id?: string
          input_tokens?: number | null
          model?: string
          output_tokens?: number | null
          user_id?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "generation_logs_content_id_fkey"
            columns: ["content_id"]
            isOneToOne: false
            referencedRelation: "content_pieces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generation_logs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      integrations: {
        Row: {
          config: Json
          connected_at: string | null
          created_at: string
          id: string
          provider: string
          status: string
          workspace_id: string
        }
        Insert: {
          config?: Json
          connected_at?: string | null
          created_at?: string
          id?: string
          provider: string
          status?: string
          workspace_id: string
        }
        Update: {
          config?: Json
          connected_at?: string | null
          created_at?: string
          id?: string
          provider?: string
          status?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "integrations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      job_results: {
        Row: {
          created_at: string
          error: string | null
          id: string
          job_type: string
          payload: Json
          result: Json | null
          status: string
          updated_at: string
          workspace_id: string | null
        }
        Insert: {
          created_at?: string
          error?: string | null
          id?: string
          job_type: string
          payload?: Json
          result?: Json | null
          status?: string
          updated_at?: string
          workspace_id?: string | null
        }
        Update: {
          created_at?: string
          error?: string | null
          id?: string
          job_type?: string
          payload?: Json
          result?: Json | null
          status?: string
          updated_at?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "job_results_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_chunks: {
        Row: {
          chunk_index: number
          content: string
          created_at: string
          document_id: string
          embedding: string | null
          id: string
          workspace_id: string
        }
        Insert: {
          chunk_index: number
          content: string
          created_at?: string
          document_id: string
          embedding?: string | null
          id?: string
          workspace_id: string
        }
        Update: {
          chunk_index?: number
          content?: string
          created_at?: string
          document_id?: string
          embedding?: string | null
          id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_chunks_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "knowledge_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_chunks_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_documents: {
        Row: {
          chunk_count: number
          created_at: string
          error_message: string | null
          file_size_bytes: number | null
          file_type: string
          filename: string
          flagged_content: boolean
          flagged_reasons: string[] | null
          id: string
          scan_detail: string | null
          scan_status: string
          status: string
          storage_path: string
          uploaded_by: string | null
          workspace_id: string
        }
        Insert: {
          chunk_count?: number
          created_at?: string
          error_message?: string | null
          file_size_bytes?: number | null
          file_type: string
          filename: string
          flagged_content?: boolean
          flagged_reasons?: string[] | null
          id?: string
          scan_detail?: string | null
          scan_status?: string
          status?: string
          storage_path: string
          uploaded_by?: string | null
          workspace_id: string
        }
        Update: {
          chunk_count?: number
          created_at?: string
          error_message?: string | null
          file_size_bytes?: number | null
          file_type?: string
          filename?: string
          flagged_content?: boolean
          flagged_reasons?: string[] | null
          id?: string
          scan_detail?: string | null
          scan_status?: string
          status?: string
          storage_path?: string
          uploaded_by?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_documents_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      performance_events: {
        Row: {
          content_id: string
          event_type: string
          id: string
          metadata: Json | null
          occurred_at: string
          platform: string | null
        }
        Insert: {
          content_id: string
          event_type: string
          id?: string
          metadata?: Json | null
          occurred_at?: string
          platform?: string | null
        }
        Update: {
          content_id?: string
          event_type?: string
          id?: string
          metadata?: Json | null
          occurred_at?: string
          platform?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "performance_events_content_id_fkey"
            columns: ["content_id"]
            isOneToOne: false
            referencedRelation: "content_pieces"
            referencedColumns: ["id"]
          },
        ]
      }
      sent_emails: {
        Row: {
          email_type: string
          id: string
          sent_at: string
          workspace_id: string | null
        }
        Insert: {
          email_type: string
          id?: string
          sent_at?: string
          workspace_id?: string | null
        }
        Update: {
          email_type?: string
          id?: string
          sent_at?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sent_emails_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      stripe_events: {
        Row: {
          event_id: string
          event_type: string
          processed_at: string
        }
        Insert: {
          event_id: string
          event_type: string
          processed_at?: string
        }
        Update: {
          event_id?: string
          event_type?: string
          processed_at?: string
        }
        Relationships: []
      }
      usage_overages: {
        Row: {
          attempted_at: string
          content_type: string | null
          id: string
          industry: string | null
          plan: string
          usage_count: number
          usage_limit: number
          user_id: string | null
          workspace_id: string
        }
        Insert: {
          attempted_at?: string
          content_type?: string | null
          id?: string
          industry?: string | null
          plan: string
          usage_count: number
          usage_limit: number
          user_id?: string | null
          workspace_id: string
        }
        Update: {
          attempted_at?: string
          content_type?: string | null
          id?: string
          industry?: string | null
          plan?: string
          usage_count?: number
          usage_limit?: number
          user_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "usage_overages_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      waitlist: {
        Row: {
          created_at: string
          email: string
          id: string
          provider: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          provider?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          provider?: string | null
        }
        Relationships: []
      }
      webhook_deliveries: {
        Row: {
          duration_ms: number | null
          endpoint_id: string | null
          event_type: string
          fired_at: string
          id: string
          payload: Json
          response_body: string | null
          status_code: number | null
          success: boolean
          workspace_id: string
        }
        Insert: {
          duration_ms?: number | null
          endpoint_id?: string | null
          event_type: string
          fired_at?: string
          id?: string
          payload: Json
          response_body?: string | null
          status_code?: number | null
          success?: boolean
          workspace_id: string
        }
        Update: {
          duration_ms?: number | null
          endpoint_id?: string | null
          event_type?: string
          fired_at?: string
          id?: string
          payload?: Json
          response_body?: string | null
          status_code?: number | null
          success?: boolean
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "webhook_deliveries_endpoint_id_fkey"
            columns: ["endpoint_id"]
            isOneToOne: false
            referencedRelation: "webhook_endpoints"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_endpoints: {
        Row: {
          consecutive_failures: number
          created_at: string
          description: string | null
          events: string[]
          id: string
          is_active: boolean
          last_failure_at: string | null
          last_failure_reason: string | null
          last_fired_at: string | null
          secret: string
          url: string
          workspace_id: string
        }
        Insert: {
          consecutive_failures?: number
          created_at?: string
          description?: string | null
          events?: string[]
          id?: string
          is_active?: boolean
          last_failure_at?: string | null
          last_failure_reason?: string | null
          last_fired_at?: string | null
          secret: string
          url: string
          workspace_id: string
        }
        Update: {
          consecutive_failures?: number
          created_at?: string
          description?: string | null
          events?: string[]
          id?: string
          is_active?: boolean
          last_failure_at?: string | null
          last_failure_reason?: string | null
          last_fired_at?: string | null
          secret?: string
          url?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "webhook_endpoints_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_approval_stages: {
        Row: {
          created_at: string
          id: string
          name: string
          required_role: string
          stage_index: number
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          required_role?: string
          stage_index: number
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          required_role?: string
          stage_index?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_approval_stages_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_invites: {
        Row: {
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string
          role: string
          status: string
          token: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by: string
          role?: string
          status?: string
          token?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string
          role?: string
          status?: string
          token?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_invites_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_members: {
        Row: {
          created_at: string
          id: string
          invited_email: string | null
          role: string
          status: string
          user_id: string | null
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          invited_email?: string | null
          role?: string
          status?: string
          user_id?: string | null
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          invited_email?: string | null
          role?: string
          status?: string
          user_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_members_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspaces: {
        Row: {
          brand_company_name: string | null
          brand_knowledge: Json | null
          brand_primary_color: string | null
          brand_voice: string | null
          byok_api_key_encrypted: string | null
          byok_base_url: string | null
          byok_key_added_at: string | null
          byok_key_last_error: string | null
          byok_key_last_error_at: string | null
          byok_key_last_validated_at: string | null
          byok_model: string | null
          byok_provider: string | null
          created_at: string
          credits_monthly: number
          credits_remaining: number
          deletion_requested_at: string | null
          deletion_requested_by: string | null
          first_generation_celebrated_at: string | null
          id: string
          industry: string | null
          logo_url: string | null
          name: string
          plan: string
          scheduled_purge_at: string | null
          slug: string
          storage_limit_bytes: number
          storage_used_bytes: number
          stripe_current_period_start: string | null
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          subscription_status: string | null
          trial_ends_at: string | null
          usage_count: number
          usage_limit: number
          use_own_ai_key: boolean
          white_label_enabled: boolean
        }
        Insert: {
          brand_company_name?: string | null
          brand_knowledge?: Json | null
          brand_primary_color?: string | null
          brand_voice?: string | null
          byok_api_key_encrypted?: string | null
          byok_base_url?: string | null
          byok_key_added_at?: string | null
          byok_key_last_error?: string | null
          byok_key_last_error_at?: string | null
          byok_key_last_validated_at?: string | null
          byok_model?: string | null
          byok_provider?: string | null
          created_at?: string
          credits_monthly?: number
          credits_remaining?: number
          deletion_requested_at?: string | null
          deletion_requested_by?: string | null
          first_generation_celebrated_at?: string | null
          id?: string
          industry?: string | null
          logo_url?: string | null
          name: string
          plan?: string
          scheduled_purge_at?: string | null
          slug: string
          storage_limit_bytes?: number
          storage_used_bytes?: number
          stripe_current_period_start?: string | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_status?: string | null
          trial_ends_at?: string | null
          usage_count?: number
          usage_limit?: number
          use_own_ai_key?: boolean
          white_label_enabled?: boolean
        }
        Update: {
          brand_company_name?: string | null
          brand_knowledge?: Json | null
          brand_primary_color?: string | null
          brand_voice?: string | null
          byok_api_key_encrypted?: string | null
          byok_base_url?: string | null
          byok_key_added_at?: string | null
          byok_key_last_error?: string | null
          byok_key_last_error_at?: string | null
          byok_key_last_validated_at?: string | null
          byok_model?: string | null
          byok_provider?: string | null
          created_at?: string
          credits_monthly?: number
          credits_remaining?: number
          deletion_requested_at?: string | null
          deletion_requested_by?: string | null
          first_generation_celebrated_at?: string | null
          id?: string
          industry?: string | null
          logo_url?: string | null
          name?: string
          plan?: string
          scheduled_purge_at?: string | null
          slug?: string
          storage_limit_bytes?: number
          storage_used_bytes?: number
          stripe_current_period_start?: string | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_status?: string | null
          trial_ends_at?: string | null
          usage_count?: number
          usage_limit?: number
          use_own_ai_key?: boolean
          white_label_enabled?: boolean
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      add_credits: {
        Args: { p_credits: number; p_workspace_id: string }
        Returns: undefined
      }
      claim_content_for_purge: {
        Args: { p_retention_days?: number; p_stale_claim_minutes?: number }
        Returns: {
          id: string
          workspace_id: string
        }[]
      }
      claim_email_send: {
        Args: {
          p_email_type: string
          p_window_start: string
          p_workspace_id: string
        }
        Returns: string
      }
      claim_seat_and_create_invite: {
        Args: {
          p_email: string
          p_invited_by: string
          p_role: string
          p_seat_limit: number
          p_workspace_id: string
        }
        Returns: {
          active_count: number
          invite_expires_at: string
          invite_id: string
          invite_token: string
          pending_count: number
          success: boolean
        }[]
      }
      deduct_credits: {
        Args: { p_amount: number; p_workspace_id: string }
        Returns: {
          new_balance: number
          success: boolean
        }[]
      }
      get_content_event_counts: {
        Args: { p_content_ids: string[]; p_since: string }
        Returns: {
          content_id: string
          event_count: number
          event_type: string
        }[]
      }
      increment_asset_used_count: {
        Args: { p_asset_id: string }
        Returns: undefined
      }
      increment_byok_usage_count: {
        Args: { p_workspace_id: string }
        Returns: number
      }
      is_workspace_member: { Args: { ws_id: string }; Returns: boolean }
      is_workspace_owner_or_admin: { Args: { ws_id: string }; Returns: boolean }
      match_knowledge_chunks: {
        Args: {
          match_count?: number
          match_workspace_id: string
          query_embedding: string
        }
        Returns: {
          content: string
          document_id: string
          id: string
          similarity: number
        }[]
      }
      record_webhook_failure: {
        Args: { p_endpoint_id: string; p_reason: string }
        Returns: undefined
      }
      record_webhook_success: {
        Args: { p_endpoint_id: string }
        Returns: undefined
      }
      release_storage: {
        Args: { p_bytes: number; p_workspace_id: string }
        Returns: undefined
      }
      reserve_storage: {
        Args: { p_bytes: number; p_workspace_id: string }
        Returns: {
          limit_bytes: number
          new_used_bytes: number
          success: boolean
        }[]
      }
      reset_monthly_credits: { Args: never; Returns: undefined }
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
  public: {
    Enums: {},
  },
} as const
