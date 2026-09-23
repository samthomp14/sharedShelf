// Hand-written to match supabase/schema.sql.
// Once the project is linked to the Supabase CLI, regenerate with:
//   supabase gen types typescript --linked > lib/database.types.ts

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type FriendshipStatus = 'pending' | 'accepted';
export type ShelfItemStatus = 'available' | 'requested' | 'on_loan';
export type LoanRequestStatus = 'pending' | 'accepted' | 'declined' | 'cancelled';

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
          status: ShelfItemStatus;
          visibility: 'friends' | 'private';
          group_id: string | null;
          sort_order: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          owner_id: string;
          book_id: string;
          status?: ShelfItemStatus;
          visibility?: 'friends' | 'private';
          group_id?: string | null;
          sort_order?: number;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['shelf_items']['Insert']>;
        Relationships: [];
      };
      loan_requests: {
        Row: {
          id: string;
          shelf_item_id: string;
          requester_id: string;
          status: LoanRequestStatus;
          created_at: string;
          responded_at: string | null;
        };
        Insert: {
          id?: string;
          shelf_item_id: string;
          requester_id: string;
          status?: LoanRequestStatus;
          created_at?: string;
          responded_at?: string | null;
        };
        Update: Partial<Database['public']['Tables']['loan_requests']['Insert']>;
        Relationships: [];
      };
      loans: {
        Row: {
          id: string;
          shelf_item_id: string;
          loan_request_id: string | null;
          lender_id: string;
          borrower_id: string;
          started_at: string;
          returned_at: string | null;
        };
        Insert: {
          id?: string;
          shelf_item_id: string;
          loan_request_id?: string | null;
          lender_id: string;
          borrower_id: string;
          started_at?: string;
          returned_at?: string | null;
        };
        Update: Partial<Database['public']['Tables']['loans']['Insert']>;
        Relationships: [];
      };
    };
  };
}
