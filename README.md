# 🎓 AI Study Assistant

A premium, responsive, and feature-rich educational workspace built with **React, TypeScript, Vite, and Vanilla CSS**, featuring robust integration points for **Supabase (Auth, Postgres, Storage)** and a modular **RAG (Retrieval-Augmented Generation)** document-retrieval pipeline.

---

## 🌟 Key Features

*   **Premium Visual Experience**: Modern deep-dark theme built using HSL color systems, complete with smooth animations, custom scrollbars, and card-glassmorphism.
*   **Intelligent Study Chat**: Interactive chat groundable in one or more uploaded PDF documents. Features live-typing/streaming answers, suggestions, and clean source citation overlays.
*   **Modular RAG Services**: Features dedicated splitters, placeholder embedding models, and similarity search routines.
*   **Dual Mode Capabilities**: Seamlessly switches between full **Supabase Backend Mode** and local-only **Demo Mode** (using LocalStorage for DB/metadata and mock content synthesis for uploads).

---

## 📁 Project Architecture

The architecture separates UI state, data access layers, and heavy compute/AI operations cleanly:

```
AI Study Assistant/
├── .env.example          # Template for environment configuration
├── supabase_schema.sql   # Complete SQL schema: profiles, docs, chunks, chats, RLS, RPCs
├── storage_policies.sql  # Storage bucket security policies
├── src/
│   ├── main.tsx          # Application entry point
│   ├── App.tsx           # Session control, global auth, and route state
│   ├── index.css         # Styling system (variables, animations, grids, overlays)
│   ├── lib/
│   │   └── supabase.ts   # Client SDK setup with fallback detection
│   ├── services/
│   │   ├── db.ts         # Database CRUD (handles both Postgres & local DB operations)
│   │   ├── storage.ts    # File uploads & text extraction routines
│   │   ├── ai.ts         # Modular RAG chunking, embeddings, and grounded synthesis
│   │   └── rag.ts        # Vector retrieval router (Supabase RPC vector search / Local TF-IDF)
│   └── components/
│       ├── LandingPage.tsx   # Dashboard introduction, features grid, entry portal
│       ├── AuthForm.tsx      # Sign-in / Sign-up form panel with validation
│       ├── Dashboard.tsx     # Files uploader, statistics panels, document table
│       └── ChatInterface.tsx # Study workspace, sidebar session logs, target citations
```

---

## 🛠️ Supabase Configuration & `pgvector` Setup

To run the application with a real backend, follow these setup steps:

### 1. Enable `pgvector` Extension
Vector similarity search relies on the `pgvector` extension.
*   **Option A (SQL Editor)**: Run the following command in your Supabase SQL Editor:
    ```sql
    create extension if not exists vector;
    ```
*   **Option B (Dashboard)**: Go to **Database** -> **Extensions** -> Search for `vector` -> Click **Enable**.

### 2. Run Database Schema
Execute the contents of [`supabase_schema.sql`](file:///c:/Reddiah/AI%20Study%20Assistant/supabase_schema.sql) in your Supabase SQL Editor. This will:
*   Configure public tables: `profiles`, `documents`, `document_chunks`, `chat_sessions`, and `messages`.
*   Establish Row-Level Security (RLS) policies.
*   Initialize the `match_document_chunks` RPC function for multi-document cosine similarity searches.
*   Setup database triggers to automatically create student profiles upon sign-up.
*   Establish an **HNSW (Hierarchical Navigable Small World)** vector index on `document_chunks` for fast semantic similarity checks:
    ```sql
    create index on public.document_chunks using hnsw (embedding vector_cosine_ops);
    ```

### 3. Setup Storage Bucket
1. Go to **Storage** in the Supabase Dashboard and create a new bucket named `study-documents` (make it private).
2. Apply the policies defined in [`storage_policies.sql`](file:///c:/Reddiah/AI%20Study%20Assistant/storage_policies.sql) (or copy them from the instructions at the bottom of `supabase_schema.sql`) to configure selective upload/download permissions for authenticated users.

### 4. Setup Environment Keys
Create a `.env.local` file in the root directory and supply your project keys:
```env
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=your-anonymous-key
```

---

## 🛡️ Supabase MCP Integration Report

### Detection Finding
During setup, we performed detection checks to identify if a **Supabase Model Context Protocol (MCP)** server or tools were available in the execution workspace. 
*   **Result**: No active Supabase MCP tools (e.g. `supabase/*` commands) are registered or enabled in this context.
*   **Resolution**: The application relies on the standard, stable **Supabase JS Client SDK** (`@supabase/supabase-js`), which provides secure, direct browser-to-backend communication authenticated via JWT.

---

## 🚀 How to Run Locally

1.  **Install project dependencies**:
    ```powershell
    npm install
    ```
2.  **Start the development server**:
    ```powershell
    npm run dev
    ```
    *Note: If no `.env.local` variables are present, the app will display a visual notice indicating it is running in local offline **Demo Mode**, utilizing mock datasets so you can try all upload, chunking, and grounded messaging features immediately.*
