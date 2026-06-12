import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

const envFile = fs.readFileSync('.env.local', 'utf-8');
const env = {};
envFile.split('\n').forEach(line => {
  const [key, ...val] = line.split('=');
  if (key && val.length) {
    env[key.trim()] = val.join('=').trim().replace(/^['"]|['"]$/g, '');
  }
});

const supabaseUrl = env['VITE_SUPABASE_URL'];
const supabaseKey = env['VITE_SUPABASE_ANON_KEY'];

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing Supabase credentials in .env.local");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkData() {
  const { data: docs, error: docError } = await supabase.from('documents').select('*');
  if (docError) {
    console.error("Error fetching documents:", docError);
  } else {
    console.log(`Found ${docs.length} documents.`);
    if (docs.length > 0) {
      console.log(docs.map(d => ({ id: d.id, name: d.file_name })));
    }
  }

  const { data: chunks, error: chunkError } = await supabase.from('document_chunks').select('id, document_id, content, metadata');
  if (chunkError) {
    console.error("Error fetching chunks:", chunkError);
  } else {
    console.log(`Found ${chunks.length} chunks.`);
  }
}

checkData();
