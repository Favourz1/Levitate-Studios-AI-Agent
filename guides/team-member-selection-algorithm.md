# Team Member Selection Algorithm Guide

This guide documents the intelligent team member selection algorithm used for Asana project initialization.

## Overview

The team member selection service (`src/services/teamMemberSelectionService.js`) selects team members for projects based on:
1. **Skill Match**: How well team member roles match project requirements
2. **Workload**: Current incomplete task count across all projects
3. **Lead Preference**: Prefer lead team members for roles with multiple members

## Algorithm Flow

### Step 1: Get All Active Team Members

**Method**: `getAllActiveTeamMembers()`

**Process**:
1. Query `team_members` table where `is_active = true`
2. Exclude ADMIN and MANAGER roles (they should not be assigned tasks)
3. Return team members with roles

**Roles Structure**:
```javascript
{
  id: 1,
  name: "John Doe",
  email: "john@example.com",
  asanaUserGid: "123456789",
  roles: [
    { role: "GRAPHICS_DESIGNER", isLead: true },
    { role: "UI_DESIGNER", isLead: false }
  ],
  isActive: true
}
```

### Step 2: Calculate Workload for Each Team Member

**Method**: `calculateWorkloadForTeamMember(teamMemberGid, asanaIntegration)`

**Process**:
1. **Query Asana API**: Get incomplete tasks assigned to team member across ALL projects
   - Use `completed_since: "now"` to get only incomplete tasks
   - Use pagination if >1000 tasks
   - Query across all projects, not just current project

2. **Cache Result**: Cache workload count with TTL (5 minutes) to reduce API calls

3. **Return**: Count of incomplete tasks

**Key Points**:
- Only counts incomplete tasks (completed tasks excluded)
- Queries across ALL projects for accurate workload
- Uses pagination for projects with >1000 tasks
- Caches result to reduce API calls

**Cache Key**: `workload:{teamMemberGid}`
**Cache TTL**: 5 minutes

### Step 3: Analyze Project Requirements

**Method**: `analyzeProjectRequirements(project)`

**Process**:
1. **Get Available Roles**: Extract unique roles from all active team members
   - Exclude ADMIN and MANAGER roles

2. **Assemble Project Context**:
   - Client context (`client.context`)
   - Project context (`project.context`)
   - Questionnaire responses
   - Brand origin document content
   - Quote document (services mentioned)

3. **LLM Analysis**: Use LLM to determine required roles based on project requirements
   - Input: Project context, available roles list
   - Output: Required roles array with reasoning

4. **Validate Output**: Ensure all returned roles exist in available roles

5. **Mandatory Roles**: Always include `PROJECT_MANAGER` (required for all projects)

**LLM Prompt Structure**:
- Available roles list
- Project context (questionnaire, brand origin, quote)
- Instructions for role mapping
- Output schema: `{ requiredRoles: string[], reasoning: string, confidence: number }`

**Role Mapping Examples**:
- Web Design/Development → `WEB_DESIGNER`, `UI_DESIGNER`
- Logo Design/Branding → `GRAPHICS_DESIGNER`, `CREATIVE_DIRECTOR`
- Motion Graphics/Video → `MOTION_GRAPHICS_DESIGNER`
- Digital Marketing → `DIGITAL_MARKETER`
- Copywriting → `COPYWRITER`

### Step 4: Score Each Team Member

**Method**: `scoreTeamMember(teamMember, requiredRoles, workload)`

**Scoring Formula**:
```javascript
// Skill Match Score (0-1)
skillMatch = matchingRoles.length / requiredRoles.length

// Workload Score (0-1, inverse: less work = higher score)
normalizedWorkload = Math.min(workload / 100, 1)
workloadScore = 1 - normalizedWorkload

// Combined Score
combinedScore = (skillMatch * 0.7) + (workloadScore * 0.3)
```

**Weighting**:
- Skill Match: 70% (more important)
- Workload: 30% (less important but still considered)

**Workload Normalization**:
- Max workload considered: 100 tasks
- Beyond 100 tasks, workload score approaches 0
- Uses sigmoid-like function for smooth scaling

### Step 5: Select Team Members

**Method**: `selectTeamMembersForProject(project, asanaIntegration)`

**Process**:
1. **Distributed Lock**: Acquire lock to prevent concurrent selections
   - Lock key: `team_selection:project:{projectId}`
   - Lock TTL: 30 seconds
   - Gracefully handles Redis unavailability

2. **For Each Required Role**:
   - Filter team members who have this role
   - Exclude already selected members
   - Sort by combined score (descending), then prefer lead
   - Select top candidate

3. **Lead Preference**: If multiple members have same score, prefer lead (`isLead: true`)

4. **Cache Result**: Cache selection result (1 minute TTL) for concurrent requests

5. **Return**: Selected team members array

**Selection Logic**:
```javascript
// Sort candidates
candidates.sort((a, b) => {
  // First by combined score
  if (b.score.combinedScore !== a.score.combinedScore) {
    return b.score.combinedScore - a.score.combinedScore;
  }
  
  // Then prefer lead
  const aIsLead = a.member.roles.some(r => r.role === requiredRole && r.isLead);
  const bIsLead = b.member.roles.some(r => r.role === requiredRole && r.isLead);
  
  if (aIsLead && !bIsLead) return -1;
  if (!aIsLead && bIsLead) return 1;
  
  return 0;
});

// Select top candidate
const selected = candidates[0];
```

## Distributed Locking

**Purpose**: Prevent concurrent team selections for the same project.

**Implementation**:
- Lock key: `team_selection:project:{projectId}`
- Lock TTL: 30 seconds
- Uses Redis SET with NX (set if not exists) and EX (expiration)

**Graceful Degradation**: If Redis unavailable, proceeds without lock (degraded mode).

## Caching Strategy

### Workload Cache

**Key**: `workload:{teamMemberGid}`
**TTL**: 5 minutes
**Purpose**: Reduce Asana API calls for workload calculation

### Selection Result Cache

**Key**: `team_selection_result:project:{projectId}`
**TTL**: 1 minute
**Purpose**: Return cached result for concurrent requests

**Graceful Degradation**: If Redis unavailable, continues without cache.

## Error Handling

### Workload Calculation Failures

- If workload calculation fails for a team member: Use 0 workload (graceful degradation)
- Log error but continue with selection

### LLM Analysis Failures

- If LLM analysis fails: Fallback to `[PROJECT_MANAGER]` only
- Log error for manual review

### Asana API Failures

- Retry with exponential backoff
- If retries fail: Use 0 workload for that member
- Continue with selection using available data

## Example Selection

**Project Requirements**:
- Web design
- Logo design
- Brand guidelines

**Required Roles** (from LLM):
- `PROJECT_MANAGER` (mandatory)
- `WEB_DESIGNER`
- `GRAPHICS_DESIGNER`
- `CREATIVE_DIRECTOR`

**Team Members**:
1. Alice: `WEB_DESIGNER` (lead), workload: 5 tasks
2. Bob: `WEB_DESIGNER`, workload: 20 tasks
3. Charlie: `GRAPHICS_DESIGNER` (lead), workload: 10 tasks
4. David: `GRAPHICS_DESIGNER`, workload: 15 tasks
5. Eve: `PROJECT_MANAGER`, workload: 8 tasks
6. Frank: `CREATIVE_DIRECTOR`, workload: 3 tasks

**Selection Process**:

1. **PROJECT_MANAGER**: Only Eve → Select Eve
2. **WEB_DESIGNER**: 
   - Alice: skillMatch=1.0, workloadScore=0.95, combinedScore=0.985
   - Bob: skillMatch=1.0, workloadScore=0.80, combinedScore=0.94
   - Select Alice (higher score + lead)
3. **GRAPHICS_DESIGNER**:
   - Charlie: skillMatch=1.0, workloadScore=0.90, combinedScore=0.97
   - David: skillMatch=1.0, workloadScore=0.85, combinedScore=0.955
   - Select Charlie (higher score + lead)
4. **CREATIVE_DIRECTOR**: Only Frank → Select Frank

**Final Selection**: [Eve, Alice, Charlie, Frank]

## Performance Considerations

### Asana API Rate Limits

- Workload calculation queries all projects (can be many API calls)
- Uses pagination for >1000 tasks
- Caches results to reduce API calls
- Processes workload calculations in parallel

### LLM Usage

- Single LLM call per project for role analysis
- Uses structured output for reliable results
- Falls back gracefully if LLM fails

### Database Queries

- Single query for all active team members
- Single query for project data with relations
- Efficient queries with proper indexes

## Best Practices

1. **Always include PROJECT_MANAGER**: Required for all projects

2. **Exclude ADMIN/MANAGER**: These roles should not be assigned tasks

3. **Prefer leads**: When scores are equal, prefer lead team members

4. **Handle failures gracefully**: Continue with selection even if some data unavailable

5. **Cache workload data**: Reduces API calls and improves performance

6. **Use distributed locks**: Prevents concurrent selections for same project

7. **Log selection reasoning**: Helps with debugging and transparency

## Common Issues

1. **No team members found**: Check `is_active` flag and role assignments

2. **Workload calculation slow**: Consider increasing cache TTL or reducing API calls

3. **LLM returns invalid roles**: Validate against available roles list

4. **Concurrent selections**: Use distributed locks to prevent conflicts

5. **Redis unavailable**: Service gracefully degrades without cache/locks

## References

- Team Member Selection Service: `src/services/teamMemberSelectionService.js`
- Asana Project Init Worker: `src/workers/asanaProjectInit.js`
- Asana Integration: `src/integrations/asana.js`
- Constants: `src/constants/index.js` (TeamRole enum)

