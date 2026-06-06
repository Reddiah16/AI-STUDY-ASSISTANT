-- ============================================================
-- Supabase Storage Policies for "study-documents" bucket
-- AI Study Assistant
--
-- Run this in the Supabase SQL Editor AFTER creating the
-- "study-documents" bucket in Storage → New Bucket.
--
-- Each policy uses the folder name (first path segment) to
-- enforce per-user isolation:
--   study-documents/{userId}/{filename}
-- ============================================================


-- 1. Authenticated users can UPLOAD files to their own folder
create policy "Authenticated users can upload their own files"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'study-documents'
  and (storage.foldername(name))[1] = auth.uid()::text
);


-- 2. Authenticated users can VIEW / DOWNLOAD their own files
create policy "Authenticated users can view their own files"
on storage.objects for select
to authenticated
using (
  bucket_id = 'study-documents'
  and (storage.foldername(name))[1] = auth.uid()::text
);


-- 3. Authenticated users can DELETE their own files
create policy "Authenticated users can delete their own files"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'study-documents'
  and (storage.foldername(name))[1] = auth.uid()::text
);


-- 4. (Optional) Block all anonymous / public access entirely
--    Uncomment this if you want the bucket to be fully private.
--
-- revoke all on storage.objects from anon;


-- ============================================================
-- Notes
-- ============================================================
--
-- • (storage.foldername(name))[1] extracts the first path segment
--   from the object key, e.g. for "abc-user-id/file.pdf" → "abc-user-id".
--   This ensures a user can ONLY read/write inside their own folder.
--
-- • If you want PUBLIC download links (anyone with the URL can view):
--     - Set the bucket to "Public" in the Supabase dashboard.
--     - The SELECT policy above is still recommended so the file
--       listing API is still protected.
--
-- • If you want PRIVATE download links only:
--     - Keep the bucket as "Private".
--     - Use `supabase.storage.from('study-documents').createSignedUrl()`
--       in storage.ts (getSignedUrl() helper is already implemented).
--
-- • To verify policies are active, run:
--     select * from storage.policies where bucket_id = 'study-documents';
-- ============================================================
