// Hand-written to match supabase/schema.sql.
// Once the project is linked to the Supabase CLI, regenerate with:
//   supabase gen types typescript --linked > lib/database.types.ts

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type FriendshipStatus = 'pending' | 'accepted';
export type LoanRequestStatus = 'pending' | 'accepted' | 'declined' | 'cancelled';
// Lending (see supabase/migrations/*_lending_v2_expand.sql).
export type CopyLendStatus = 'available' | 'unavailable' | 'promised' | 'on_loan';
export type LoanEndedReason = 'returned' | 'called_off' | 'removed';

// Row shape returned by search_catalog / lookup_isbn.
export interface CatalogBookRow {
  id: string;
  isbn: string | null;
  title: string;
  authors: string[];
  cover_url: string | null;
  shelf_item_id: string | null;
}

export interface Database {
  public: {
    Views: Record<string, never>;
    Functions: {
      are_friends: {
        Args: { a: string; b: string };
        Returns: boolean;
      };
      friend_count: {
        Args: { target: string };
        Returns: number;
      };
      friends_of: {
        Args: { target: string };
        Returns: { id: string; username: string; display_name: string | null; avatar_url: string | null }[];
      };
      normalize_isbn: {
        Args: { raw: string };
        Returns: string | null;
      };
      add_book_to_shelf: {
        Args: {
          p_book_id?: string;
          p_isbn?: string;
          p_title?: string;
          p_authors?: string[];
          p_cover_url?: string;
          p_source?: string;
        };
        Returns: { book_id: string; shelf_item_id: string; already_on_shelf: boolean }[];
      };
      search_catalog: {
        Args: { q: string };
        Returns: CatalogBookRow[];
      };
      lookup_isbn: {
        Args: { p_isbn: string };
        Returns: CatalogBookRow[];
      };
      get_invite_code: {
        Args: Record<string, never>;
        Returns: string;
      };
      invite_preview: {
        Args: { p_code: string };
        Returns: { username: string; display_name: string | null }[];
      };
      redeem_invite: {
        Args: { p_code: string };
        Returns: string | null;
      };
      // Lending v2 step functions. Each raises a readable error when the
      // caller or the copy/loan state doesn't allow the step.
      request_loan: {
        Args: { p_shelf_item_id: string };
        Returns: string;
      };
      cancel_request: {
        Args: { p_request_id: string };
        Returns: undefined;
      };
      accept_request: {
        Args: { p_request_id: string };
        Returns: string;
      };
      decline_request: {
        Args: { p_request_id: string };
        Returns: undefined;
      };
      call_off_loan: {
        Args: { p_loan_id: string };
        Returns: undefined;
      };
      mark_handed_over: {
        Args: { p_loan_id: string };
        Returns: undefined;
      };
      lend_to_friend: {
        Args: { p_shelf_item_id: string; p_friend_id: string };
        Returns: string;
      };
      mark_returned: {
        Args: { p_loan_id: string };
        Returns: undefined;
      };
      set_copy_available: {
        Args: { p_shelf_item_id: string; p_available: boolean };
        Returns: undefined;
      };
      set_copy_visibility: {
        Args: { p_shelf_item_id: string; p_visible: boolean };
        Returns: undefined;
      };
      delete_account: {
        Args: Record<string, never>;
        Returns: undefined;
      };
    };
    Tables: {
      profiles: {
        Row: {
          id: string;
          username: string;
          display_name: string | null;
          avatar_url: string | null;
          bio: string | null;
          created_at: string;
        };
        Insert: {
          id: string;
          username: string;
          display_name?: string | null;
          avatar_url?: string | null;
          bio?: string | null;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['profiles']['Insert']>;
        Relationships: [];
      };
      books: {
        Row: {
          id: string;
          isbn: string | null;
          title: string;
          authors: string[];
          cover_url: string | null;
          source: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          isbn?: string | null;
          title: string;
          authors?: string[];
          cover_url?: string | null;
          source?: string | null;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['books']['Insert']>;
        Relationships: [];
      };
      client_logs: {
        Row: {
          id: number;
          created_at: string;
          user_id: string | null;
          level: 'info' | 'warn' | 'error';
          event: string;
          detail: Json | null;
          user_agent: string | null;
        };
        Insert: {
          level: 'info' | 'warn' | 'error';
          event: string;
          detail?: Json | null;
          user_agent?: string | null;
        };
        Update: Partial<Database['public']['Tables']['client_logs']['Insert']>;
        Relationships: [];
      };
      // Push notifications (see supabase/migrations/*_push_notifications.sql).
      // push_outbox has no client access, so it isn't listed.
      push_subscriptions: {
        Row: {
          id: string;
          user_id: string;
          endpoint: string;
          p256dh: string;
          auth: string;
          site: 'prod' | 'staging';
          user_agent: string | null;
          created_at: string;
          last_seen_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          endpoint: string;
          p256dh: string;
          auth: string;
          site?: 'prod' | 'staging';
          user_agent?: string | null;
          created_at?: string;
          last_seen_at?: string;
        };
        Update: Partial<Database['public']['Tables']['push_subscriptions']['Insert']>;
        Relationships: [];
      };
      notification_prefs: {
        Row: {
          user_id: string;
          borrow_requests: boolean;
          your_requests: boolean;
          loans: boolean;
          friends: boolean;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          borrow_requests?: boolean;
          your_requests?: boolean;
          loans?: boolean;
          friends?: boolean;
          updated_at?: string;
        };
        Update: Partial<Database['public']['Tables']['notification_prefs']['Insert']>;
        Relationships: [];
      };
      book_authors: {
        Row: {
          book_id: string;
          author: string;
        };
        Insert: {
          book_id: string;
          author: string;
        };
        Update: Partial<Database['public']['Tables']['book_authors']['Insert']>;
        Relationships: [];
      };
      friendships: {
        Row: {
          id: string;
          requester_id: string;
          addressee_id: string;
          status: FriendshipStatus;
          created_at: string;
          responded_at: string | null;
        };
        Insert: {
          id?: string;
          requester_id: string;
          addressee_id: string;
          status?: FriendshipStatus;
          created_at?: string;
          responded_at?: string | null;
        };
        Update: Partial<Database['public']['Tables']['friendships']['Insert']>;
        Relationships: [];
      };
      shelf_groups: {
        Row: {
          id: string;
          owner_id: string;
          name: string;
          sort_order: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          owner_id: string;
          name: string;
          sort_order?: number;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['shelf_groups']['Insert']>;
        Relationships: [];
      };
      shelf_items: {
        Row: {
          id: string;
          owner_id: string;
          book_id: string;
          // Copy state. Only the lending step functions can change it.
          lend_status: CopyLendStatus;
          visibility: 'friends' | 'private';
          group_id: string | null;
          sort_order: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          owner_id: string;
          book_id: string;
          visibility?: 'friends' | 'private';
          group_id?: string | null;
          sort_order?: number;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['shelf_items']['Insert']>;
        Relationships: [];
      };
      // Lending: read-only for clients (select policy only); all writes
      // go through the step functions above.
      loan_requests_v2: {
        Row: {
          id: string;
          shelf_item_id: string | null;
          book_id: string;
          owner_id: string;
          requester_id: string;
          status: LoanRequestStatus;
          created_at: string;
          responded_at: string | null;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      loans_v2: {
        Row: {
          id: string;
          shelf_item_id: string | null;
          book_id: string;
          owner_id: string;
          borrower_id: string;
          request_id: string | null;
          created_at: string;
          handed_over_at: string | null;
          ended_at: string | null;
          ended_reason: LoanEndedReason | null;
          ended_by: string | null;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
    };
  };
}
