import { authRouter } from './routers/auth'
import { skillsRouter } from './routers/skills'
import { projectsRouter } from './routers/projects'
import { volunteersRouter } from './routers/volunteers'
import { dashboardRouter } from './routers/dashboard'
import { notificationsRouter } from './routers/notifications'
import { messagesRouter } from './routers/messages'
import { contactsRouter } from './routers/contacts'
import { bugReportsRouter } from './routers/bugReports'
import { localGroupsRouter } from './routers/localGroups'
import { localGroupSuggestionsRouter } from './routers/localGroupSuggestions'
import { teamsRouter } from './routers/teams'
import { teamSuggestionsRouter } from './routers/teamSuggestions'
import { quickTasksRouter } from './routers/quickTasks'
import { dependenciesRouter } from './routers/dependencies'
import { scheduleRouter } from './routers/schedule'
import { projectPortingRouter } from './routers/projectPorting'
import { templatesRouter } from './routers/templates'
import { workItemCommentsRouter } from './routers/workItemComments'
import { bugReportCommentsRouter } from './routers/bugReportComments'
import { myRouter } from './routers/my'
import { privacyRouter } from './routers/privacy'
import { contactRouter } from './routers/contact'
import { adminApplicationsRouter } from './routers/admin/applications'
import { adminVolunteersRouter } from './routers/admin/volunteers'
import { adminNotesRouter } from './routers/admin/notes'
import { adminProjectsRouter } from './routers/admin/projects'
import { adminSkillsRouter } from './routers/admin/skills'
import { adminSkillCategoriesRouter } from './routers/admin/skillCategories'
import { adminLocalGroupsRouter } from './routers/admin/localGroups'
import { adminTeamsRouter } from './routers/admin/teams'
import { adminBugReportsRouter } from './routers/admin/bugReports'
import { adminAdminsRouter } from './routers/admin/admins'
import { adminPlatformSettingsRouter } from './routers/admin/platformSettings'
import { adminStatsRouter } from './routers/admin/stats'
import { adminTriageRouter } from './routers/admin/triage'
import { adminInterestsRouter } from './routers/admin/interests'
import { adminEmailPreviewRouter } from './routers/admin/emailPreview'
import { adminRejectedApplicationsRouter } from './routers/admin/rejectedApplications'
import { adminCronRunsRouter } from './routers/admin/cronRuns'
import { adminOverviewRouter } from './routers/admin/overview'
import { adminNotificationsRouter } from './routers/admin/notifications'
import { adminJournalistOutreachRouter } from './routers/admin/journalistOutreach'
import { journalistOutreachRouter } from './routers/journalistOutreach'
import { versionRouter } from './routers/version'
import { maintenanceRouter } from './routers/maintenance'

export const appRouter = {
  auth: authRouter,
  skills: skillsRouter,
  projects: { ...projectsRouter, ...projectPortingRouter },
  templates: templatesRouter,
  volunteers: volunteersRouter,
  dashboard: dashboardRouter,
  notifications: notificationsRouter,
  messages: messagesRouter,
  contacts: contactsRouter,
  bugReports: bugReportsRouter,
  bugReportComments: bugReportCommentsRouter,
  localGroups: localGroupsRouter,
  localGroupSuggestions: localGroupSuggestionsRouter,
  teams: teamsRouter,
  teamSuggestions: teamSuggestionsRouter,
  quickTasks: quickTasksRouter,
  dependencies: dependenciesRouter,
  schedule: scheduleRouter,
  workItemComments: workItemCommentsRouter,
  my: myRouter,
  privacy: privacyRouter,
  contact: contactRouter,
  version: versionRouter,
  maintenance: maintenanceRouter,
  journalistOutreach: journalistOutreachRouter,
  admin: {
    journalistOutreach: adminJournalistOutreachRouter,
    applications: adminApplicationsRouter,
    volunteers: adminVolunteersRouter,
    notes: adminNotesRouter,
    projects: adminProjectsRouter,
    skills: adminSkillsRouter,
    skillCategories: adminSkillCategoriesRouter,
    localGroups: adminLocalGroupsRouter,
    teams: adminTeamsRouter,
    bugReports: adminBugReportsRouter,
    admins: adminAdminsRouter,
    platformSettings: adminPlatformSettingsRouter,
    stats: adminStatsRouter,
    triage: adminTriageRouter,
    interests: adminInterestsRouter,
    emailPreview: adminEmailPreviewRouter,
    rejectedApplications: adminRejectedApplicationsRouter,
    cronRuns: adminCronRunsRouter,
    overview: adminOverviewRouter,
    notifications: adminNotificationsRouter,
  },
}

export type AppRouter = typeof appRouter
