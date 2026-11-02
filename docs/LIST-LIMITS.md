# List limits (findMany without `take`)

BUG-11: every `findMany` under `src/app/api` that has no `take`, as of this change. *Bounded* calls read a
small, fixed-size set (configuration, team members, ids from the request) and carry a one-line
`// Unpaged on purpose:` comment. *Paged* ones use `src/lib/pagination.ts` (`?cursor=<id>&limit=`, default 100,
max 500; the cursor is a row id compared in the database). *Grows* ones get longer with time and are the
follow-ups; page them the same way when they come up.

Totals: 38 bounded, 4 paged, 18 grow with time.

To list them again: `node scripts/list-unpaged-queries.mjs` (TypeScript AST, not grep).

| File | Query | Class | Why |
| --- | --- | --- | --- |
| `src/app/api/account/push/route.ts` | `prisma.pushSubscription` | bounded | only the caller's devices beyond the first 20 (at most a handful) |
| `src/app/api/admin/users/[userId]/route.ts` | `tx.workspaceMember` | bounded | one user's workspace memberships |
| `src/app/api/admin/users/route.ts` | `prisma.user` | grows | every account on the server (admin console) |
| `src/app/api/agent-work/skills/[skillId]/files/route.ts` | `prisma.attachment` | grows | files of one agent skill |
| `src/app/api/ai/build-widgets/route.ts` | `tx.dashboardWidget` | bounded | widgets of one dashboard (a screenful) |
| `src/app/api/ai/conversations/[conversationId]/route.ts` | `prisma.aiMessage` | grows | messages of one AI conversation |
| `src/app/api/comments/[commentId]/reactions/route.ts` | `tx.commentReaction` | bounded | reactions on one comment (fixed emoji set x people) |
| `src/app/api/dashboards/[dashboardId]/blocks/route.ts` | `prisma.dashboardWidget` | bounded | widgets of one dashboard (a screenful) |
| `src/app/api/dashboards/[dashboardId]/route.ts` | `prisma.project` | grows | projects of the workspace (picker) |
| `src/app/api/desktop/releases/route.ts` | `prisma.desktopRelease` | bounded | one row per published app version |
| `src/app/api/projects/[projectId]/categories/route.ts` | `prisma.category` | bounded | categories of one project (configuration) |
| `src/app/api/projects/[projectId]/permissions/route.ts` | `prisma.workspaceMember` | bounded | members of one workspace (team size) |
| `src/app/api/projects/[projectId]/permissions/route.ts` | `prisma.projectHiddenMember` | bounded | people hidden from one project (at most the team) |
| `src/app/api/projects/[projectId]/permissions/route.ts` | `prisma.projectMemberPermission` | bounded | per-person rights in one project (at most the team) |
| `src/app/api/projects/[projectId]/permissions/route.ts` | `prisma.workspaceMember` | bounded | ids from the request (max 1000 changes) |
| `src/app/api/projects/[projectId]/route.ts` | `prisma.view` | bounded | views of one project (configuration) |
| `src/app/api/projects/[projectId]/route.ts` | `prisma.workspaceMember` | bounded | members of one workspace (team size) |
| `src/app/api/projects/[projectId]/tasks/bulk-delete/route.ts` | `tx.task` | bounded | ids from the request (max 1000) |
| `src/app/api/projects/[projectId]/views/route.ts` | `prisma.view` | bounded | views of one project (configuration) |
| `src/app/api/projects/[projectId]/visibility/route.ts` | `prisma.workspaceMember` | bounded | members of one workspace (team size) |
| `src/app/api/projects/[projectId]/visibility/route.ts` | `prisma.projectHiddenMember` | bounded | people hidden from one project (at most the team) |
| `src/app/api/projects/[projectId]/visibility/route.ts` | `prisma.workspaceMember` | bounded | ids from the request, members only |
| `src/app/api/projects/[projectId]/visibility/route.ts` | `tx.projectHiddenMember` | bounded | people hidden from one project (at most the team) |
| `src/app/api/rewards/[rewardId]/redeem/route.ts` | `prisma.workspaceMember` | bounded | owners and admins of one workspace |
| `src/app/api/rewards/[rewardId]/redeem/route.ts` | `prisma.recognitionManager` | bounded | recognition managers of one workspace |
| `src/app/api/tasks/[taskId]/activity/route.ts` | `prisma.activityLog` | paged | paged (cursor), BUG-11 |
| `src/app/api/tasks/[taskId]/approvals/route.ts` | `prisma.taskApproval` | grows | sign-off requests on one task |
| `src/app/api/tasks/[taskId]/attachments/route.ts` | `prisma.attachment` | paged | paged (cursor), BUG-11 |
| `src/app/api/tasks/[taskId]/comments/route.ts` | `prisma.comment` | paged | paged (cursor), BUG-11 |
| `src/app/api/tasks/[taskId]/comments/route.ts` | `prisma.workspaceMember` | bounded | people @mentioned in one comment |
| `src/app/api/tasks/[taskId]/mentionable/route.ts` | `prisma.workspaceMember` | bounded | members of one workspace (team size) |
| `src/app/api/wiki/[pageId]/comments/route.ts` | `prisma.wikiComment` | paged | paged (cursor), BUG-11 |
| `src/app/api/wiki/[pageId]/comments/route.ts` | `prisma.attachment` | bounded | ids from the request (max 10 files) |
| `src/app/api/wikis/[wikiId]/knowledge-docs/route.ts` | `prisma.knowledgeDoc` | grows | knowledge documents of one wiki |
| `src/app/api/wikis/[wikiId]/members/route.ts` | `prisma.workspaceMember` | bounded | members of one workspace (team size) |
| `src/app/api/wikis/[wikiId]/pages/route.ts` | `prisma.wikiPage` | grows | pages of one wiki (page tree) |
| `src/app/api/workspaces/[workspaceId]/brain/insights/route.ts` | `prisma.task` | bounded | ids of the caller's current tasks from forYou() (already capped) |
| `src/app/api/workspaces/[workspaceId]/capture-targets/route.ts` | `prisma.project` | grows | active projects of the workspace (picker) |
| `src/app/api/workspaces/[workspaceId]/capture-targets/route.ts` | `prisma.category` | bounded | categories of the workspace (configuration) |
| `src/app/api/workspaces/[workspaceId]/capture-targets/route.ts` | `prisma.status` | bounded | statuses of the workspace (configuration) |
| `src/app/api/workspaces/[workspaceId]/dashboards/route.ts` | `prisma.dashboard` | grows | dashboards of the workspace |
| `src/app/api/workspaces/[workspaceId]/invitations/route.ts` | `prisma.workspaceInvitation` | bounded | pending invitations only (capped by the invite rate limit) |
| `src/app/api/workspaces/[workspaceId]/members/[userId]/handover/route.ts` | `tx.project` | bounded | projects owned by one member (ids only, not returned) |
| `src/app/api/workspaces/[workspaceId]/members/route.ts` | `prisma.workspaceMember` | bounded | members of one workspace (team size) |
| `src/app/api/workspaces/[workspaceId]/my-work/route.ts` | `prisma.task` | grows | every task ever assigned to the caller, done ones too |
| `src/app/api/workspaces/[workspaceId]/objectives/route.ts` | `prisma.objective` | grows | objectives of the workspace (all periods) |
| `src/app/api/workspaces/[workspaceId]/okr-dashboard/route.ts` | `prisma.objective` | grows | objectives of the workspace (all periods) |
| `src/app/api/workspaces/[workspaceId]/okr-options/route.ts` | `prisma.objective` | grows | objectives of the workspace (picker) |
| `src/app/api/workspaces/[workspaceId]/okr-options/route.ts` | `prisma.keyResult` | grows | key results of the workspace (picker) |
| `src/app/api/workspaces/[workspaceId]/projects/route.ts` | `prisma.project` | grows | projects of the workspace (sidebar) |
| `src/app/api/workspaces/[workspaceId]/recognition/route.ts` | `prisma.reward` | bounded | active rewards of one workspace (catalog) |
| `src/app/api/workspaces/[workspaceId]/recognition/settings/route.ts` | `prisma.workspaceMember` | bounded | members of one workspace (team size) |
| `src/app/api/workspaces/[workspaceId]/recognition/settings/route.ts` | `prisma.recognitionManager` | bounded | recognition managers of one workspace |
| `src/app/api/workspaces/[workspaceId]/recognition/settings/route.ts` | `prisma.recognitionMember` | bounded | recognition settings per member (team size) |
| `src/app/api/workspaces/[workspaceId]/rewards/route.ts` | `prisma.reward` | bounded | rewards of one workspace (catalog) |
| `src/app/api/workspaces/[workspaceId]/statuses/route.ts` | `prisma.status` | bounded | statuses of the workspace (configuration) |
| `src/app/api/workspaces/[workspaceId]/thoughts/route.ts` | `prisma.capturedThought` | grows | the caller's unprocessed captured thoughts |
| `src/app/api/workspaces/[workspaceId]/wikis/route.ts` | `prisma.wiki` | grows | wikis of the workspace (sidebar) |
| `src/app/api/workspaces/route.ts` | `prisma.workspace` | grows | every workspace on the server (system admin) |
| `src/app/api/workspaces/route.ts` | `prisma.workspaceMember` | bounded | the caller's own workspace memberships |

Follow-ups (grow with time), in rough priority: my-work (needs its own cursor: sorted by due date, nulls
last), AI conversation messages, admin users, thoughts, wiki pages and knowledge docs, task approvals, OKR
lists, project / wiki / dashboard lists, all-workspaces for system admins.
