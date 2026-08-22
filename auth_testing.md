# Auth-Gated App Testing Playbook (Emergent Google Auth)

Step 1: Create Test User & Session (use DB name from backend/.env, here: test_database)

mongosh --eval "
use('test_database');
var userId = 'test-user-' + Date.now();
var sessionToken = 'test_session_' + Date.now();
db.users.insertOne({
  user_id: userId,
  email: 'test.user.' + Date.now() + '@example.com',
  name: 'Test User',
  picture: 'https://via.placeholder.com/150',
  role: 'owner',
  created_at: new Date().toISOString()
});
db.user_sessions.insertOne({
  user_id: userId,
  session_token: sessionToken,
  expires_at: new Date(Date.now() + 7*24*60*60*1000).toISOString(),
  created_at: new Date().toISOString()
});
print('Session token: ' + sessionToken);
"

Step 2: Test Backend API
curl -X GET "https://APP_URL/api/auth/me" -H "Authorization: Bearer YOUR_SESSION_TOKEN"

Step 3: Browser Testing (Playwright)
await page.context.add_cookies([{
  "name": "session_token", "value": "YOUR_SESSION_TOKEN",
  "domain": "APP_DOMAIN", "path": "/",
  "httpOnly": true, "secure": true, "sameSite": "None"
}]);
await page.goto("https://APP_URL");

Checklist:
- User doc has custom user_id; session user_id matches exactly
- All queries exclude MongoDB _id
- /api/auth/me returns user data (not 401)
- Dashboard loads, no redirect to login
- Callback detection uses useLocation().hash

Cleanup:
mongosh --eval "use('test_database'); db.users.deleteMany({email: /test\.user\./}); db.user_sessions.deleteMany({session_token: /test_session/});"
