import { createClient } from '@supabase/supabase-js'

const url = 'https://mksonztkbdczsjdvjksk.supabase.co'
const key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1rc29uenRrYmRjenNqZHZqa3NrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE1Nzk2MDksImV4cCI6MjA4NzE1NTYwOX0.uGzJpHvBmBj3kuU1BGcFMrknG_YRkwV7LAoRtynLjbI'

const supabase = createClient(url, key)

console.log('Testing Supabase connection and writing test data...\n')

// Test inserting into a simple table
// First, let's try to insert into profiles table (common in Supabase)
const testProfile = {
  id: crypto.randomUUID(),
  username: 'test_user_' + Date.now(),
  created_at: new Date().toISOString()
}

console.log('Attempting to insert test profile...')
const { data, error } = await supabase
  .from('profiles')
  .insert(testProfile)
  .select()

if (error) {
  console.log('Profiles table insert failed:', error.message)
  console.log('Trying a different approach - using raw SQL via RPC...\n')

  // Try calling a function or check what tables exist
  const { data: tables, error: tablesError } = await supabase
    .from('pg_tables')
    .select('tablename')
    .eq('schemaname', 'public')

  if (tablesError) {
    console.log('Cannot list tables (need service role key for that)')
  } else {
    console.log('Available tables:', tables)
  }
} else {
  console.log('Successfully inserted profile:', data)
}

// Also test a simple read operation
console.log('\nTesting read operation...')
const { data: readData, error: readError } = await supabase
  .from('_test_connection')
  .select('*')
  .limit(1)

if (readError) {
  console.log('Read error (expected if table does not exist):', readError.message)
} else {
  console.log('Read data:', readData)
}

console.log('\nSupabase connection test complete!')
