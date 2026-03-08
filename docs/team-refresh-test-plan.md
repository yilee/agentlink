# Team Dashboard Page Refresh — Test Plan

Tests that the team dashboard correctly recovers state after a browser page refresh, both during an active team run and after a team has completed.

## Prerequisites

- Ephemeral server + agent running locally
- Browser open to the session URL

## Test Cases

### TC-1: Refresh while team is running

**Steps:**
1. Create a new team (any template or custom instruction)
2. Wait until at least 1 subagent appears and starts working (status: `working`)
3. Refresh the browser page (F5)
4. Observe the dashboard

**Expected:**
- Dashboard re-enters team mode automatically
- Team status shows `running`
- All agents that were visible before refresh still appear with their current statuses
- Activity feed shows entries that existed before refresh
- Kanban shows correct task statuses
- Agent statuses continue to update in real-time as work progresses
- Clicking an agent shows "No messages yet." (streaming messages are ephemeral)

### TC-2: Refresh after team completes

**Steps:**
1. Create a team and let it run to completion (Lead produces a result)
2. Observe the dashboard — all agents should show `done`, team status `completed`
3. Refresh the browser page (F5)

**Expected:**
- Dashboard automatically loads the completed team as a historical view
- Team status shows `completed`
- ALL agents show status `done` (not `working`)
- All tasks show status `done` in the kanban board
- Activity feed contains all entries from the completed run
- Summary section (if present) shows the Lead's final summary

### TC-3: Click agent detail view after refresh (completed team)

**Steps:**
1. After TC-2 (completed team loaded as historical view after refresh)
2. Click on any agent card on the dashboard

**Expected:**
- Agent detail view opens
- Shows message: "Agent messages are not available for completed teams."
- No error toast or blank screen
- Back button works to return to dashboard

### TC-4: Click agent detail view after refresh (active team)

**Steps:**
1. After TC-1 (active team restored after refresh)
2. Click on any agent card on the dashboard

**Expected:**
- Agent detail view opens
- Shows "No messages yet." initially (streaming messages are ephemeral)
- As the agent continues working, new messages stream in live
- Back button returns to dashboard

### TC-5: Switch to chat view after refresh (completed team)

**Steps:**
1. After TC-2 (completed team loaded as historical view)
2. Click "Back to Chat" or switch to chat mode

**Expected:**
- Chat view shows the team conversation
- Team result/summary is visible in chat history
- Can start a new conversation or team

### TC-6: Agent statuses in team_completed message

**Steps:**
1. Create a team and watch the dashboard
2. Observe as each agent finishes — status changes to `done`
3. When the Lead finishes (team completes), verify all agent statuses

**Expected:**
- All subagents show status `done` (or `error` if they failed)
- Lead shows status `done`
- No agent remains stuck on `working` or `starting`
- Task board shows all tasks as `done` (or `failed`)
