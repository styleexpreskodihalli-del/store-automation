import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  'https://opgnylgfzfaowjhwzceq.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const userId = '86ba7b6e-322e-4656-a079-bceea28a2bf7'

const { data, error } = await supabase.auth.admin.updateUserById(userId, {
  password: process.env.NEW_ADMIN_PASSWORD
})

if (error) throw error

console.log('Password updated successfully')
console.log(data.user.email)

