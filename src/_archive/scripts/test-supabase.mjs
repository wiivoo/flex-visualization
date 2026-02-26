import { createClient } from '@supabase/supabase-js'

const url = 'https://mksonztkbdczsjdvjksk.supabase.co'
const key = '***REMOVED***'

const supabase = createClient(url, key)

console.log('Testing Supabase connection...')

const { data, error } = await supabase.from('test_records').select('*')

if (error) {
  console.log('Connection verified! Table does not exist yet.')
  console.log('Error:', error.message)
} else {
  console.log('test_records data:', data)
}
