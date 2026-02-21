import { createClient } from '@supabase/supabase-js'

const url = 'https://mksonztkbdczsjdvjksk.supabase.co'
const key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1rc29uenRrYmRjenNqZHZqa3NrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE1Nzk2MDksImV4cCI6MjA4NzE1NTYwOX0.uGzJpHvBmBj3kuU1BGcFMrknG_YRkwV7LAoRtynLjbI'

const supabase = createClient(url, key)

console.log('Testing Supabase connection...')

const { data, error } = await supabase.from('test_records').select('*')

if (error) {
  console.log('Connection verified! Table does not exist yet.')
  console.log('Error:', error.message)
} else {
  console.log('test_records data:', data)
}
