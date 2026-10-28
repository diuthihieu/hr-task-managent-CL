// All UI text as [English, Tiếng Việt]. The keys live in ./messages/<area>.ts, one file per
// area of the app - add a new key to the file whose description fits it.
// Professional terms that teams use as-is (OKR, Key Result, Kanban, Gantt,
// Dashboard, Workspace...) stay in English in the Vietnamese column.

import { COMMON } from "./messages/common";
import { KNOWLEDGE } from "./messages/knowledge";
import { RECOGNITION } from "./messages/recognition";
import { LANDING } from "./messages/landing";
import { ACCOUNT } from "./messages/account";
import { AI } from "./messages/ai";
import { OKR } from "./messages/okr";
import { DASHBOARDS } from "./messages/dashboards";
import { NOTIFICATIONS } from "./messages/notifications";
import { TASKS } from "./messages/tasks";
import { WORKSPACE } from "./messages/workspace";

export const MESSAGES = { ...COMMON, ...KNOWLEDGE, ...RECOGNITION, ...LANDING, ...ACCOUNT, ...AI, ...OKR, ...DASHBOARDS, ...NOTIFICATIONS, ...TASKS, ...WORKSPACE } as const;
