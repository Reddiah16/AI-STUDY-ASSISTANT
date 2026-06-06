-- AI Study Assistant - Supabase Postgres Schema
-- This schema prepares the database for users, document management, chat sessions, and vector similarity search.

-- =========================================================================
-- HOW TO ENABLE pgvector IN SUPABASE:
-- 1. In your Supabase Dashboard, navigate to Database -> Extensions.
-- 2. Search for "vector" and toggle it ON.
-- OR simply run the following SQL command in the SQL Editor:
--    create extension if not exists "vector";
-- =========================================================================

-- 1. Enable extensions
create extension if not exists "uuid-ossp";
create extension if not exists "vector"; -- Enables pgvector for RAG embeddings (1536 dimensions)

-- 2. Profiles Table (Automatically synced with Supabase Auth users)
create table public.profiles (
    id uuid references auth.users on delete cascade primary key,
    full_name text,
    avatar_url text,
    updated_at timestamp with time zone default now()
);

-- 3. Documents Table (Metadata for files uploaded to Storage)
create table public.documents (
    id uuid default gen_random_uuid() primary key,
    user_id uuid references auth.users on delete cascade not null,
    file_name text not null,
    file_path text not null, -- The path inside Supabase Storage bucket
    file_url text not null,  -- Publicly accessible URL or retrieval URL
    file_size bigint not null,
    content_text text,       -- Cached plain text extracted from the document
    created_at timestamp with time zone default now() not null
);

-- 4. Document Chunks Table (For RAG/Vector search)
create table public.document_chunks (
    id uuid default gen_random_uuid() primary key,
    document_id uuid references public.documents on delete cascade not null,
    content text not null,
    metadata jsonb,
    embedding vector(1536), -- 1536-dimensional vector for OpenAI/Gemini embeddings
    created_at timestamp with time zone default now() not null
);

-- HNSW Vector Index: Speed up cosine similarity searches
create index on public.document_chunks using hnsw (embedding vector_cosine_ops);

-- 5. Chat Sessions Table
create table public.chat_sessions (
    id uuid default gen_random_uuid() primary key,
    user_id uuid references auth.users on delete cascade not null,
    title text not null,
    created_at timestamp with time zone default now() not null
);

-- 6. Messages Table
create table public.messages (
    id uuid default gen_random_uuid() primary key,
    session_id uuid references public.chat_sessions on delete cascade not null,
    sender_role text not null check (sender_role in ('user', 'assistant')),
    content text not null,
    sources jsonb default '[]'::jsonb, -- Stores chunks references or page references
    created_at timestamp with time zone default now() not null
);

-- Enable Row Level Security (RLS) on all tables
alter table public.profiles enable row level security;
alter table public.documents enable row level security;
alter table public.document_chunks enable row level security;
alter table public.chat_sessions enable row level security;
alter table public.messages enable row level security;

-- 7. RLS Policies

-- Profiles
create policy "Users can view their own profile" on public.profiles
    for select using (auth.uid() = id);

create policy "Users can update their own profile" on public.profiles
    for update using (auth.uid() = id);

-- Documents
create policy "Users can view their own documents" on public.documents
    for select using (auth.uid() = user_id);

create policy "Users can insert their own documents" on public.documents
    for insert with check (auth.uid() = user_id);

create policy "Users can delete their own documents" on public.documents
    for delete using (auth.uid() = user_id);

-- Document Chunks (linked to documents)
create policy "Users can view chunks of their own documents" on public.document_chunks
    for select using (
        exists (
            select 1 from public.documents
            where public.documents.id = public.document_chunks.document_id
            and public.documents.user_id = auth.uid()
        )
    );

create policy "Users can insert chunks for their own documents" on public.document_chunks
    for insert with check (
        exists (
            select 1 from public.documents
            where public.documents.id = public.document_chunks.document_id
            and public.documents.user_id = auth.uid()
        )
    );

create policy "Users can delete chunks for their own documents" on public.document_chunks
    for delete using (
        exists (
            select 1 from public.documents
            where public.documents.id = public.document_chunks.document_id
            and public.documents.user_id = auth.uid()
        )
    );

-- Chat Sessions
create policy "Users can view their own chat sessions" on public.chat_sessions
    for select using (auth.uid() = user_id);

create policy "Users can insert their own chat sessions" on public.chat_sessions
    for insert with check (auth.uid() = user_id);

create policy "Users can update their own chat sessions" on public.chat_sessions
    for update using (auth.uid() = user_id);

create policy "Users can delete their own chat sessions" on public.chat_sessions
    for delete using (auth.uid() = user_id);

-- Messages
create policy "Users can view messages from their own sessions" on public.messages
    for select using (
        exists (
            select 1 from public.chat_sessions
            where public.chat_sessions.id = public.messages.session_id
            and public.chat_sessions.user_id = auth.uid()
        )
    );

create policy "Users can insert messages into their own sessions" on public.messages
    for insert with check (
        exists (
            select 1 from public.chat_sessions
            where public.chat_sessions.id = public.messages.session_id
            and public.chat_sessions.user_id = auth.uid()
        )
    );

-- 8. Automation Triggers

-- Automatically create profile on user signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, full_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    new.raw_user_meta_data->>'avatar_url'
  );
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Automatically update profiles.updated_at timestamp
create or replace function public.handle_update_timestamp()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger on_profile_updated
  before update on public.profiles
  for each row execute procedure public.handle_update_timestamp();


-- 9. Vector Similarity Search Function
-- Searches matching document chunks using cosine similarity (<=> is cosine distance in pgvector)
create or replace function match_document_chunks (
    query_embedding vector(1536),
    match_threshold float,
    match_count int,
    filter_document_ids uuid[]
)
returns table (
    id uuid,
    document_id uuid,
    content text,
    metadata jsonb,
    similarity float
)
language sql stable
as $$
  select
    document_chunks.id,
    document_chunks.document_id,
    document_chunks.content,
    document_chunks.metadata,
    1 - (document_chunks.embedding <=> query_embedding) as similarity
  from document_chunks
  where document_chunks.document_id = any(filter_document_ids)
    and 1 - (document_chunks.embedding <=> query_embedding) > match_threshold
  order by document_chunks.embedding <=> query_embedding
  limit match_count;
$$;


-- 10. Supabase Storage Configuration instructions
-- Note: Create a bucket named "study-documents" in the Supabase Storage Dashboard.
-- Configure the following Storage policies for the "study-documents" bucket:
--   - Select (Read): auth.role() = 'authenticated'
--   - Insert (Upload): auth.role() = 'authenticated' and (storage.foldername(name))[1] = auth.uid()::text
--   - Delete (Remove): auth.role() = 'authenticated' and (storage.foldername(name))[1] = auth.uid()::text
