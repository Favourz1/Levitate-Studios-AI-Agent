const { getPrismaClient } = require("@/database");
const { createLogger } = require("@/utils/logger");
const { ValidationError } = require("@/utils/errors");
const { TeamRole, ProcessingStatus, DocumentType } = require("@/constants");
const { redis } = require("@/queues");
const { retry } = require("@/utils");
const { z } = require("zod");
const { llmClient } = require("@/llm/client");

const logger = createLogger("service:teamMemberSelection");
const prisma = getPrismaClient();

// Cache TTL for workload data (5 minutes)
const WORKLOAD_CACHE_TTL = 5 * 60; // 5 minutes in seconds

// Distributed lock TTL (30 seconds)
const LOCK_TTL = 30; // 30 seconds

/**
 * Team Member Selection Service
 * Handles intelligent team member selection for Asana projects based on:
 * - Skill match with project requirements
 * - Current workload (incomplete tasks across all projects)
 * - Lead preference for roles with multiple members
 */
class TeamMemberSelectionService {
  /**
   * Get all active team members from database
   * @returns {Promise<Array>} Array of team members with roles
   */
  static async getAllActiveTeamMembers() {
    try {
      logger.info("Fetching all active team members");

      const teamMembers = await prisma.teamMember.findMany({
        where: {
          isActive: true,
        },
        orderBy: {
          name: "asc",
        },
      });

      logger.info({ count: teamMembers.length }, "Fetched active team members");

      return teamMembers;
    } catch (error) {
      logger.error(
        { error: error.message, stack: error.stack },
        "Failed to get all active team members"
      );
      throw error;
    }
  }

  /**
   * Calculate workload for a team member by querying Asana API
   * Queries incomplete tasks across ALL projects (not just current project)
   * Uses pagination if >1000 tasks
   * Caches result with TTL to reduce API calls
   * @param {string} teamMemberGid - Asana user GID of the team member
   * @param {Object} asanaIntegration - Asana integration instance
   * @returns {Promise<number>} Count of incomplete tasks
   */
  static async calculateWorkloadForTeamMember(teamMemberGid, asanaIntegration) {
    try {
      if (!teamMemberGid || typeof teamMemberGid !== "string") {
        throw new ValidationError(
          "Team member GID is required and must be a string"
        );
      }

      if (!asanaIntegration || !asanaIntegration.tasksApi) {
        throw new ValidationError("Asana integration instance is required");
      }

      // Check cache first (gracefully handle Redis unavailability)
      const cacheKey = `workload:${teamMemberGid}`;
      let cachedWorkload = null;
      try {
        cachedWorkload = await redis.get(cacheKey);
      } catch (redisError) {
        logger.warn(
          { teamMemberGid, error: redisError.message },
          "Redis cache unavailable, proceeding without cache"
        );
      }

      if (cachedWorkload !== null) {
        logger.debug(
          { teamMemberGid, workload: parseInt(cachedWorkload, 10) },
          "Using cached workload data"
        );
        return parseInt(cachedWorkload, 10);
      }

      logger.info({ teamMemberGid }, "Calculating workload for team member");

      let incompleteTaskCount = 0;
      let offset = null;
      const limit = 100; // Asana API default limit
      let hasMore = true;

      // Query tasks assigned to this user across all projects
      // Use completed_since: "now" to get only incomplete tasks
      while (hasMore) {
        try {
          const response = await asanaIntegration.getTasksForUser(
            teamMemberGid,
            {
              completed_since: "now", // Only incomplete tasks
              opt_fields: "gid,completed",
              limit,
              offset,
            }
          );

          const tasks = response.data || [];
          incompleteTaskCount += tasks.length;

          // Check if there are more pages
          if (response.next_page) {
            offset = response.next_page.offset;
            hasMore = true;
          } else {
            hasMore = false;
          }

          // Safety check: if we've processed >1000 tasks, log a warning
          if (incompleteTaskCount > 1000 && hasMore) {
            logger.warn(
              {
                teamMemberGid,
                currentCount: incompleteTaskCount,
              },
              "Large number of incomplete tasks detected, continuing pagination"
            );
          }
        } catch (error) {
          logger.error(
            {
              teamMemberGid,
              offset,
              error: error.message,
            },
            "Failed to fetch tasks from Asana API"
          );
          throw error;
        }
      }

      // Cache the result (gracefully handle Redis unavailability)
      try {
        await redis.setex(cacheKey, WORKLOAD_CACHE_TTL, incompleteTaskCount);
      } catch (redisError) {
        logger.warn(
          { teamMemberGid, error: redisError.message },
          "Failed to cache workload data, continuing without cache"
        );
      }

      logger.info(
        {
          teamMemberGid,
          incompleteTaskCount,
        },
        "Calculated workload for team member"
      );

      return incompleteTaskCount;
    } catch (error) {
      logger.error(
        {
          teamMemberGid,
          error: error.message,
          stack: error.stack,
        },
        "Failed to calculate workload for team member"
      );
      throw error;
    }
  }

  /**
   * Analyze project requirements to determine needed team roles using LLM
   * Extracts required skills from:
   * - Questionnaire responses
   * - Brand origin document
   * - Quote document (services mentioned)
   * Uses LLM to intelligently map project requirements to available team roles
   * @param {Object} project - Project object with related data
   * @returns {Promise<Array<string>} Array of required role names
   */
  static async analyzeProjectRequirements(project) {
    try {
      if (!project || !project.id) {
        throw new ValidationError("Project is required");
      }

      logger.info(
        { projectId: project.id },
        "Analyzing project requirements with LLM"
      );

      // Step 1: Get all unique team roles from database
      const allTeamMembers = await prisma.teamMember.findMany({
        where: {
          isActive: true,
        },
        select: {
          roles: true,
        },
      });

      // Extract unique roles from all team members
      const availableRolesSet = new Set();
      allTeamMembers.forEach((member) => {
        if (Array.isArray(member.roles)) {
          member.roles.forEach((roleObj) => {
            if (roleObj && roleObj.role) {
              // Exclude ADMIN and MANAGER as they should not be assigned tasks
              if (
                roleObj.role !== TeamRole.ADMIN &&
                roleObj.role !== TeamRole.MANAGER
              ) {
                availableRolesSet.add(roleObj.role);
              }
            }
          });
        }
      });

      const availableRoles = Array.from(availableRolesSet);

      if (availableRoles.length === 0) {
        logger.warn(
          { projectId: project.id },
          "No available team roles found in database"
        );
        // Fallback: return only PROJECT_MANAGER
        return [TeamRole.PROJECT_MANAGER];
      }

      // Step 2: Get full project data with related documents
      const fullProject = await prisma.project.findUnique({
        where: { id: project.id },
        include: {
          client: true,
          questionnaireResponses: {
            where: {
              processingStatus: ProcessingStatus.PROCESSED,
            },
            orderBy: {
              submittedAt: "desc",
            },
            take: 1,
          },
          documents: {
            where: {
              type: {
                in: [DocumentType.BRAND_ORIGIN, DocumentType.QUOTE],
              },
            },
            include: {
              currentRevision: true,
            },
            orderBy: {
              updatedAt: "desc",
            },
          },
        },
      });

      if (!fullProject) {
        throw new ValidationError(`Project not found: ${project.id}`);
      }

      // Step 3: Assemble project context for LLM
      let projectContext = {
        projectName: fullProject.name,
        clientName: fullProject.client?.name || "Unknown",
        clientContext: fullProject.client?.context || null,
        projectContext: fullProject.context || null,
      };

      // Add questionnaire data
      if (
        fullProject.questionnaireResponses &&
        fullProject.questionnaireResponses.length > 0
      ) {
        projectContext.questionnaire = {
          responses: fullProject.questionnaireResponses[0].responses || {},
          submittedAt: fullProject.questionnaireResponses[0].submittedAt,
        };
      }

      // Add brand origin document
      const brandOriginDoc = fullProject.documents.find(
        (doc) => doc.type === DocumentType.BRAND_ORIGIN
      );
      if (brandOriginDoc && brandOriginDoc.currentRevision) {
        projectContext.brandOrigin = {
          content: brandOriginDoc.currentRevision.snapshotText || "",
          summary: brandOriginDoc.currentRevision.summary || null,
        };
      }

      // Add quote document
      const quoteDoc = fullProject.documents.find(
        (doc) => doc.type === DocumentType.QUOTE
      );
      if (quoteDoc && quoteDoc.currentRevision) {
        let quoteContent = "";

        // Extract quoteItems from snapshotMd if available
        const snapshotMd = quoteDoc.currentRevision.snapshotMd;
        if (
          snapshotMd &&
          snapshotMd.quoteItems &&
          Array.isArray(snapshotMd.quoteItems)
        ) {
          // Format quoteItems as readable text for LLM analysis
          quoteContent = snapshotMd.quoteItems
            .map((item, idx) => {
              const itemCode = item.item_code || "Item";
              const description = item.description || "No description";
              const qty = item.qty || 1;
              const rate = item.rate || 0;
              return `${
                idx + 1
              }. ${itemCode}: ${description} (Quantity: ${qty}, Rate: ₦${rate.toLocaleString()})`;
            })
            .join("\n");
        } else {
          // Fallback to snapshotText if quoteItems not available
          quoteContent = quoteDoc.currentRevision.snapshotText || "";
        }

        projectContext.quote = {
          content: quoteContent,
          summary: quoteDoc.currentRevision.summary || null,
        };
      }

      // Step 4: Create Zod schema for LLM output
      const roleAnalysisSchema = z.object({
        requiredRoles: z
          .array(z.string())
          .describe(
            "Array of team role names that are required for this project based on the requirements"
          ),
        reasoning: z
          .string()
          .describe(
            "Explanation of why these roles were selected based on the project requirements"
          ),
        confidence: z
          .number()
          .min(0)
          .max(1)
          .describe("Confidence level in the role selection (0-1)"),
      });

      // Step 5: Build prompt for LLM
      const prompt = `# Team Role Analysis for Project Execution

## Your Role
You are an expert project analyst for Levitate Studios, a premium creative agency. Your task is to analyze project requirements and determine which team roles are essential for successful project delivery.

## Available Team Roles
${availableRoles.map((role, idx) => `${idx + 1}. ${role}`).join("\n")}

## Project Context

### Basic Information
- **Project Name:** ${projectContext.projectName}
- **Client:** ${projectContext.clientName}
${
  projectContext.clientContext
    ? `- Client Context: ${projectContext.clientContext}`
    : ""
}
${
  projectContext.projectContext
    ? `- Project Context: ${projectContext.projectContext}`
    : ""
}

### Project Requirements

${
  projectContext.questionnaire
    ? `**Questionnaire Responses:**
\`\`\`json
${JSON.stringify(projectContext.questionnaire.responses, null, 2)}
\`\`\`
`
    : ""
}

${
  projectContext.brandOrigin
    ? `**Brand Origin Document:**
${projectContext.brandOrigin.content}
`
    : ""
}

${
  projectContext.quote
    ? `**Quote Document - Services & Deliverables:**
${projectContext.quote.content}
`
    : ""
}

## Analysis Instructions

### Phase 1: Requirement Extraction
1. **Identify Services & Deliverables:**
   - Extract all services mentioned in questionnaire responses (web design, logo design, branding, motion graphics, digital marketing, packaging, advertising, etc.)
   - Extract deliverables and requirements from brand origin document
   - Extract services from quote document (item codes and descriptions indicate specific work items)
   - Note any special requirements, customizations, or technical needs

2. **Map Services to Team Roles:**
   - **Web Design/Development** → WEB_DESIGNER, UI_DESIGNER
   - **Logo Design/Branding** → GRAPHICS_DESIGNER, CREATIVE_DIRECTOR
   - **Motion Graphics/Video** → MOTION_GRAPHICS_DESIGNER
   - **Digital Marketing/Social Media** → DIGITAL_MARKETER
   - **Copywriting/Content** → COPYWRITER
   - **Brand Strategy/Identity** → CREATIVE_DIRECTOR
   - **Packaging Design** → GRAPHICS_DESIGNER
   - **Advertising Campaigns** → DIGITAL_MARKETER, CREATIVE_DIRECTOR

### Phase 2: Role Selection
1. **Select Only Required Roles:**
   - Only include roles that are actually needed based on the project scope
   - Do not add roles "just in case" - be precise and intentional
   - Consider the complexity and scale of the project to determine number of people per role.

2. **Mandatory Role:**
   - Always include PROJECT_MANAGER (required for all projects - handles client relationships, team coordination, and task assignment)
   - Always include CREATIVE_DIRECTOR (required for all projects - determines the artistic execution of the project)

3. **Excluded Roles:**
   - Do NOT include ADMIN or MANAGER roles (these should not be assigned tasks)

4. **Role Matching:**
   - Match services to roles using fuzzy matching - services may not exactly match role names
   - Consider the nature of the work, not just exact keyword matches
   - Example: "Brand Identity Design" could require GRAPHICS_DESIGNER and CREATIVE_DIRECTOR

### Phase 3: Validation
- Ensure all selected roles exist in the available roles list
- Verify role names match exactly (case-sensitive)
- Confirm selection aligns with project scope and deliverables

## Output Requirements

Return a JSON object with:
- **requiredRoles**: Array of role names (strings) that exactly match the available roles list
- **reasoning**: Clear explanation of why each role was selected based on specific project requirements
- **confidence**: Confidence level (0-1) in your role selection

**Critical:** Role names must match exactly with the available roles list. Use the exact role names provided above.`;

      // Step 6: Use LLM to determine required roles
      const llmResult = await llmClient.generateStructured(
        roleAnalysisSchema,
        prompt,
        {
          projectId: project.id,
          availableRoles,
          hasQuestionnaire: !!projectContext.questionnaire,
          hasBrandOrigin: !!projectContext.brandOrigin,
          hasQuote: !!projectContext.quote,
        },
        "classification"
      );

      // Step 7: Validate and process LLM output
      let requiredRoles = llmResult.data.requiredRoles || [];

      // Validate that all returned roles exist in available roles
      const validRoles = requiredRoles.filter((role) =>
        availableRoles.includes(role)
      );

      // Always include PROJECT_MANAGER if not already present
      if (!validRoles.includes(TeamRole.PROJECT_MANAGER)) {
        validRoles.push(TeamRole.PROJECT_MANAGER);
      }

      // Remove duplicates
      const uniqueRoles = Array.from(new Set(validRoles));

      logger.info(
        {
          projectId: project.id,
          requiredRoles: uniqueRoles,
          llmReasoning: llmResult.data.reasoning,
          llmConfidence: llmResult.data.confidence,
          traceId: llmResult.traceId,
          availableRolesCount: availableRoles.length,
        },
        "Analyzed project requirements with LLM"
      );

      return uniqueRoles;
    } catch (error) {
      logger.error(
        {
          projectId: project?.id,
          error: error.message,
          stack: error.stack,
        },
        "Failed to analyze project requirements"
      );
      throw error;
    }
  }

  /**
   * Extract roles from text using keyword matching
   * @private
   * @param {string} text - Text to analyze
   * @param {Set<string>} rolesSet - Set to add roles to
   */

  /**
   * Score a team member based on skill match and workload
   * @param {Object} teamMember - Team member object
   * @param {Array<string>} requiredRoles - Required roles for the project
   * @param {number} workload - Current workload (incomplete task count)
   * @returns {Object} Score object with skillMatch, workloadScore, and combinedScore
   */
  static scoreTeamMember(teamMember, requiredRoles, workload) {
    try {
      if (!teamMember || !teamMember.roles) {
        throw new ValidationError("Team member with roles is required");
      }

      if (!Array.isArray(requiredRoles)) {
        throw new ValidationError("Required roles must be an array");
      }

      if (typeof workload !== "number" || workload < 0) {
        throw new ValidationError("Workload must be a non-negative number");
      }

      // Calculate skill match score (0-1)
      const memberRoles = Array.isArray(teamMember.roles)
        ? teamMember.roles.map((r) => r.role)
        : [];
      const matchingRoles = requiredRoles.filter((role) =>
        memberRoles.includes(role)
      );

      // Skill match score: ratio of matching roles to required roles
      // If no required roles, default to 0.5 (neutral)
      const skillMatch =
        requiredRoles.length > 0
          ? matchingRoles.length / requiredRoles.length
          : 0.5;

      // Calculate workload score (inverse: less work = higher score)
      // Normalize workload: use a sigmoid-like function
      // Max workload considered: 100 tasks (beyond that, score approaches 0)
      const maxWorkload = 100;
      const normalizedWorkload = Math.min(workload / maxWorkload, 1);
      const workloadScore = 1 - normalizedWorkload; // Inverse: less work = higher score

      // Combined score: skillMatch (70%) + workloadScore (30%)
      const combinedScore = skillMatch * 0.7 + workloadScore * 0.3;

      const scoreResult = {
        skillMatch: Math.round(skillMatch * 100) / 100, // Round to 2 decimals
        workloadScore: Math.round(workloadScore * 100) / 100,
        combinedScore: Math.round(combinedScore * 100) / 100,
        matchingRoles,
        workload,
      };

      logger.debug(
        {
          teamMemberId: teamMember.id,
          teamMemberName: teamMember.name,
          scoreResult,
        },
        "Scored team member"
      );

      return scoreResult;
    } catch (error) {
      logger.error(
        {
          teamMemberId: teamMember?.id,
          error: error.message,
        },
        "Failed to score team member"
      );
      throw error;
    }
  }

  /**
   * Select team members for a project based on requirements and workload
   * Uses distributed locks to handle concurrent selections
   * @param {Object} project - Project object
   * @param {Object} asanaIntegration - Asana integration instance
   * @returns {Promise<Array>} Selected team members array
   */
  static async selectTeamMembersForProject(project, asanaIntegration) {
    const lockKey = `team_selection:project:${project.id}`;
    let lockAcquired = false;

    try {
      if (!project || !project.id) {
        throw new ValidationError("Project is required");
      }

      if (!asanaIntegration) {
        throw new ValidationError("Asana integration instance is required");
      }

      logger.info(
        { projectId: project.id },
        "Starting team member selection for project"
      );

      // Acquire distributed lock (gracefully handle Redis unavailability)
      try {
        lockAcquired = await redis.set(lockKey, "locked", "EX", LOCK_TTL, "NX");
      } catch (redisError) {
        logger.warn(
          { projectId: project.id, error: redisError.message },
          "Redis unavailable for distributed lock, proceeding without lock"
        );
        // Proceed without lock if Redis is unavailable (degraded mode)
        lockAcquired = true;
      }

      if (!lockAcquired) {
        logger.warn(
          { projectId: project.id },
          "Team selection already in progress for this project, waiting..."
        );

        // Wait a bit and retry (simple approach - could be improved with polling)
        await new Promise((resolve) => setTimeout(resolve, 2000));

        // Try to get existing selection result from cache
        try {
          const cachedResult = await redis.get(
            `team_selection_result:project:${project.id}`
          );
          if (cachedResult) {
            logger.info(
              { projectId: project.id },
              "Using cached team selection result"
            );
            return JSON.parse(cachedResult);
          }
        } catch (redisError) {
          logger.warn(
            { projectId: project.id, error: redisError.message },
            "Redis cache unavailable, proceeding with selection"
          );
        }

        throw new Error(
          "Team selection is already in progress for this project. Please try again later."
        );
      }

      // Step 1: Get all active team members
      // Exclude ADMIN and MANAGER roles as they should not be assigned tasks
      const allTeamMembers = (await this.getAllActiveTeamMembers()).filter(
        (member) => {
          const memberRoles = Array.isArray(member.roles)
            ? member.roles.map((r) => r.role)
            : [];
          // Exclude members who only have ADMIN or MANAGER roles
          const hasOnlyAdminOrManager =
            memberRoles.length > 0 &&
            memberRoles.every(
              (role) => role === TeamRole.ADMIN || role === TeamRole.MANAGER
            );
          return !hasOnlyAdminOrManager;
        }
      );

      if (allTeamMembers.length === 0) {
        logger.warn("No active team members found (excluding Admin/Manager)");
        return [];
      }

      // Step 2: Calculate workload for each team member
      logger.info(
        { count: allTeamMembers.length },
        "Calculating workload for all team members"
      );

      const workloadPromises = allTeamMembers.map(async (member) => {
        try {
          const workload = await this.calculateWorkloadForTeamMember(
            member.asanaUserGid,
            asanaIntegration
          );
          return { member, workload };
        } catch (error) {
          logger.error(
            {
              teamMemberId: member.id,
              teamMemberGid: member.asanaUserGid,
              error: error.message,
            },
            "Failed to calculate workload for team member, using 0"
          );
          // Use 0 workload if calculation fails (graceful degradation)
          return { member, workload: 0 };
        }
      });

      const membersWithWorkload = await Promise.all(workloadPromises);

      // Step 3: Analyze project requirements
      const requiredRoles = await this.analyzeProjectRequirements(project);

      // Step 4: Score each team member
      const scoredMembers = membersWithWorkload.map(({ member, workload }) => {
        const score = this.scoreTeamMember(member, requiredRoles, workload);
        return {
          member,
          workload,
          score,
        };
      });

      // Step 5: Select top N team members per required role
      const selectedMembers = [];
      const selectedMemberIds = new Set();

      for (const requiredRole of requiredRoles) {
        // Filter members who have this role
        const candidatesForRole = scoredMembers
          .filter(({ member }) => {
            const memberRoles = Array.isArray(member.roles)
              ? member.roles.map((r) => r.role)
              : [];
            return memberRoles.includes(requiredRole);
          })
          .filter(({ member }) => !selectedMemberIds.has(member.id)); // Exclude already selected

        if (candidatesForRole.length === 0) {
          logger.warn(
            { requiredRole, projectId: project.id },
            "No team members found for required role"
          );
          continue;
        }

        // Sort by combined score (descending), then prefer lead
        candidatesForRole.sort((a, b) => {
          // First, sort by combined score
          if (b.score.combinedScore !== a.score.combinedScore) {
            return b.score.combinedScore - a.score.combinedScore;
          }

          // If scores are equal, prefer lead
          const aIsLead = a.member.roles.some(
            (r) => r.role === requiredRole && r.isLead === true
          );
          const bIsLead = b.member.roles.some(
            (r) => r.role === requiredRole && r.isLead === true
          );

          if (aIsLead && !bIsLead) return -1;
          if (!aIsLead && bIsLead) return 1;

          return 0;
        });

        // Select the top candidate for this role
        const selected = candidatesForRole[0];
        selectedMembers.push({
          ...selected.member,
          selectedForRole: requiredRole,
          selectionScore: selected.score,
        });
        selectedMemberIds.add(selected.member.id);

        logger.info(
          {
            role: requiredRole,
            teamMemberId: selected.member.id,
            teamMemberName: selected.member.name,
            combinedScore: selected.score.combinedScore,
            isLead: selected.member.roles.some(
              (r) => r.role === requiredRole && r.isLead === true
            ),
          },
          "Selected team member for role"
        );
      }

      // Cache the result (short TTL - 1 minute, gracefully handle Redis unavailability)
      try {
        await redis.setex(
          `team_selection_result:project:${project.id}`,
          60,
          JSON.stringify(selectedMembers)
        );
      } catch (redisError) {
        logger.warn(
          { projectId: project.id, error: redisError.message },
          "Failed to cache selection result, continuing without cache"
        );
      }

      logger.info(
        {
          projectId: project.id,
          selectedCount: selectedMembers.length,
          requiredRoles,
        },
        "Team member selection completed"
      );

      return selectedMembers;
    } catch (error) {
      logger.error(
        {
          projectId: project?.id,
          error: error.message,
          stack: error.stack,
        },
        "Failed to select team members for project"
      );
      throw error;
    } finally {
      // Release lock (gracefully handle Redis unavailability)
      if (lockAcquired) {
        try {
          await redis.del(lockKey);
          logger.debug(
            { projectId: project?.id },
            "Released team selection lock"
          );
        } catch (redisError) {
          logger.warn(
            { projectId: project?.id, error: redisError.message },
            "Failed to release lock (Redis unavailable)"
          );
        }
      }
    }
  }
}

module.exports = { TeamMemberSelectionService };
