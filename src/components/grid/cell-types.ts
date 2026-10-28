// Data the cells need besides the record: workspace members, link targets and OKR choices.

export interface Member {
  id: string;
  name: string;
  avatarColor: string;
}

export interface LinkTarget {
  records: { id: string; label: string }[];
}

export interface OkrOptions {
  objectives: { id: string; title: string }[];
  keyResults: { id: string; title: string; objectiveId: string }[];
}
