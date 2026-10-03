"use client";

import { useMemo, useState } from "react";
import { Reply, SmilePlus } from "lucide-react";
import { CommentBody } from "@/components/comments/mention-input";
import { useT } from "@/components/i18n-provider";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { AvatarImg } from "@/components/ui/avatar-img";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/api-client";
import { COMMENT_REACTIONS, type CommentReactionSummary } from "@/lib/comment-reactions";
import { cn, formatDate, initials } from "@/lib/utils";

export interface TaskCommentItem {
  id: string;
  body: string;
  parentCommentId: string | null;
  createdAt: string;
  reactions: CommentReactionSummary[];
  user: { id: string; name: string; avatarColor: string } | null;
}

export function TaskCommentThread({
  comments,
  onReply,
  onDelete,
  canDelete,
  onReactionsChange,
  empty,
}: {
  comments: TaskCommentItem[];
  onReply: (comment: TaskCommentItem) => void;
  onDelete?: (comment: TaskCommentItem) => void;
  canDelete?: (comment: TaskCommentItem) => boolean;
  onReactionsChange: (commentId: string, reactions: CommentReactionSummary[]) => void;
  empty: React.ReactNode;
}) {
  const { roots, replies } = useMemo(() => {
    const rootItems: TaskCommentItem[] = [];
    const byParent = new Map<string, TaskCommentItem[]>();
    for (const comment of comments) {
      if (!comment.parentCommentId) rootItems.push(comment);
      else byParent.set(comment.parentCommentId, [...(byParent.get(comment.parentCommentId) ?? []), comment]);
    }
    return { roots: rootItems, replies: byParent };
  }, [comments]);

  if (!roots.length) return empty;
  return (
    <div className="space-y-3" data-testid="task-comment-thread">
      {roots.map((comment) => (
        <div key={comment.id} className="space-y-2">
          <TaskComment
            comment={comment}
            onReply={onReply}
            onDelete={onDelete}
            canDelete={canDelete?.(comment) ?? false}
            onReactionsChange={onReactionsChange}
          />
          {(replies.get(comment.id) ?? []).map((reply) => (
            <TaskComment
              key={reply.id}
              comment={reply}
              nested
              onReply={onReply}
              onDelete={onDelete}
              canDelete={canDelete?.(reply) ?? false}
              onReactionsChange={onReactionsChange}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function TaskComment({
  comment,
  nested = false,
  onReply,
  onDelete,
  canDelete,
  onReactionsChange,
}: {
  comment: TaskCommentItem;
  nested?: boolean;
  onReply: (comment: TaskCommentItem) => void;
  onDelete?: (comment: TaskCommentItem) => void;
  canDelete: boolean;
  onReactionsChange: (commentId: string, reactions: CommentReactionSummary[]) => void;
}) {
  const { t } = useT();
  return (
    <article className={cn("flex gap-2", nested && "ml-7 border-l border-neutral-200 pl-3 dark:border-neutral-800")} data-testid={nested ? "task-comment-reply" : "task-comment"}>
      <span
        className="relative flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full text-[10px] text-white"
        style={{ backgroundColor: comment.user?.avatarColor ?? "#94a3b8" }}
      >
        {initials(comment.user?.name ?? "?")}
        <AvatarImg id={comment.user?.id} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-xs">
          <span className="font-medium text-neutral-800 dark:text-neutral-100">{comment.user?.name ?? "—"}</span>{" "}
          <span className="text-neutral-400">{formatDate(comment.createdAt, true)}</span>
        </div>
        <CommentBody body={comment.body} markdown className="text-sm text-neutral-700 dark:text-neutral-300" />
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <button type="button" onClick={() => onReply(comment)} className="inline-flex items-center gap-1 rounded px-1 py-0.5 text-[11px] text-neutral-400 hover:bg-neutral-100 hover:text-indigo-600 dark:hover:bg-neutral-800" data-testid="comment-reply">
            <Reply size={11} /> {t("record.reply")}
          </button>
          <CommentReactions comment={comment} onChange={(reactions) => onReactionsChange(comment.id, reactions)} />
          {canDelete && onDelete ? (
            <button type="button" onClick={() => onDelete(comment)} className="rounded px-1 py-0.5 text-[11px] text-neutral-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40">
              {t("common.delete")}
            </button>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function CommentReactions({ comment, onChange }: { comment: TaskCommentItem; onChange: (reactions: CommentReactionSummary[]) => void }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function toggle(emoji: string) {
    if (busy) return;
    setBusy(true);
    setOpen(false);
    try {
      const reactions = await api.post<CommentReactionSummary[]>(`/api/comments/${comment.id}/reactions`, { emoji });
      onChange(reactions);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("common.failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {comment.reactions.map((reaction) => (
        <button
          key={reaction.emoji}
          type="button"
          disabled={busy}
          onClick={() => toggle(reaction.emoji)}
          title={reaction.names.join(", ")}
          aria-pressed={reaction.mine}
          className={cn(
            "inline-flex h-6 items-center gap-1 rounded-full border px-1.5 text-xs transition-colors disabled:opacity-50",
            reaction.mine
              ? "border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-300"
              : "border-neutral-200 bg-white text-neutral-600 hover:border-indigo-300 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
          )}
          data-testid="comment-reaction"
        >
          <span aria-hidden="true">{reaction.emoji}</span>
          <span className="tabular-nums">{reaction.count}</span>
        </button>
      ))}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={busy}
            className="inline-flex h-6 items-center gap-1 rounded px-1 text-[11px] text-neutral-400 hover:bg-neutral-100 hover:text-indigo-600 disabled:opacity-50 dark:hover:bg-neutral-800"
            title={t("record.react")}
            aria-label={t("record.react")}
            data-testid="comment-react"
          >
            <SmilePlus size={13} />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-1.5">
          <div className="flex gap-0.5" role="group" aria-label={t("record.react")}>
            {COMMENT_REACTIONS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => toggle(emoji)}
                className={cn("h-9 w-9 rounded-full text-xl transition-transform hover:scale-125 hover:bg-neutral-100 dark:hover:bg-neutral-800", comment.reactions.some((reaction) => reaction.emoji === emoji && reaction.mine) && "bg-indigo-50 dark:bg-indigo-950")}
                aria-label={emoji}
                data-testid="comment-react-option"
              >
                {emoji}
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </>
  );
}
