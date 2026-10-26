import { useEffect, useMemo, useState } from "react";
import { Check, MessageSquare, Trash2, Pencil, Copy } from "lucide-react";
import {
  COMMENTS_EVENT,
  bulkDelete,
  deleteComment,
  getAllComments,
  updateComment,
  type Comment,
} from "@/lib/comments-store";
import { useVideos } from "@/hooks/use-videos";
import { watchPathFor, type Video } from "@/data/videos";

export function CommentsModerator() {
  const [list, setList] = useState<Comment[]>(() => getAllComments());
  const videos = useVideos();
  const videoById = useMemo(() => {
    const m = new Map<string, Video>();
    for (const v of videos) m.set(v.id, v);
    return m;
  }, [videos]);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<Comment | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);

  useEffect(() => {
    const sync = () => setList(getAllComments());
    window.addEventListener(COMMENTS_EVENT, sync);
    return () => window.removeEventListener(COMMENTS_EVENT, sync);
  }, []);

  const filtered = useMemo(() => {
    const needle = q.toLowerCase().trim();
    if (!needle) return list;
    return list.filter((c) => {
      const videoTitle = videoById.get(c.videoId)?.title?.toLowerCase() ?? "";
      return (
        c.author.toLowerCase().includes(needle) ||
        c.body.toLowerCase().includes(needle) ||
        c.videoId.toLowerCase().includes(needle) ||
        videoTitle.includes(needle)
      );
    });
  }, [list, q, videoById]);

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelected(next);
  };

  const allSelected = filtered.length > 0 && filtered.every((c) => selected.has(c.id));
  const someSelected = filtered.some((c) => selected.has(c.id));
  const toggleAll = () => {
    if (allSelected) {
      const next = new Set(selected);
      for (const c of filtered) next.delete(c.id);
      setSelected(next);
    } else {
      const next = new Set(selected);
      for (const c of filtered) next.add(c.id);
      setSelected(next);
    }
  };

  return (
    <div className="space-y-4">
      <header className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h2 className="font-display text-xl font-bold flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-primary" /> Comments
          </h2>
          <p className="text-sm text-muted-foreground">Edit or delete user comments.</p>
        </div>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search author, video title or text…"
          className="rounded-lg bg-background border border-border px-3 py-2 text-sm w-64 max-w-full"
        />
      </header>

      {selected.size > 0 && (
        <div className="rounded-xl glass p-3 flex flex-wrap items-center gap-2">
          <span className="text-sm">{selected.size} selected</span>
          {!allSelected && (
            <button
              onClick={toggleAll}
              className="rounded-full glass px-3 py-1 text-xs hover:bg-secondary"
            >
              Select all ({filtered.length})
            </button>
          )}
          <button
            onClick={() => {
              setReviewOpen(true);
            }}
            className="rounded-full bg-destructive/20 text-destructive px-3 py-1 text-xs font-semibold inline-flex items-center gap-1 hover:bg-destructive/30"
          >
            <Trash2 className="h-3 w-3" /> Review &amp; delete
          </button>
          <button
            onClick={() => setSelected(new Set())}
            className="rounded-full glass px-3 py-1 text-xs hover:bg-secondary"
          >
            Clear
          </button>
        </div>
      )}

      <div className="rounded-2xl gradient-card shadow-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-secondary/50 text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="p-3 w-8">
                <button
                  onClick={toggleAll}
                  title={allSelected ? "Unselect all" : "Select all"}
                  className={`h-5 w-5 rounded-md flex items-center justify-center border ${
                    allSelected
                      ? "gradient-primary border-transparent text-primary-foreground"
                      : someSelected
                        ? "bg-primary/30 border-primary/50 text-primary"
                        : "border-border"
                  }`}
                >
                  {allSelected ? (
                    <Check className="h-3 w-3" />
                  ) : someSelected ? (
                    <span className="block h-0.5 w-2.5 bg-current rounded-full" />
                  ) : null}
                </button>
              </th>
              <th className="text-left p-3">Author</th>
              <th className="text-left p-3">Comment</th>
              <th className="text-left p-3">Video</th>
              <th className="text-right p-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="p-6 text-center text-muted-foreground">
                  No comments yet.
                </td>
              </tr>
            )}
            {filtered.map((c) => (
              <tr key={c.id} className="border-t border-border hover:bg-secondary/30">
                <td className="p-3">
                  <button
                    onClick={() => toggle(c.id)}
                    className={`h-6 w-6 rounded-md flex items-center justify-center border ${
                      selected.has(c.id)
                        ? "gradient-primary border-transparent text-primary-foreground"
                        : "border-border"
                    }`}
                  >
                    {selected.has(c.id) && <Check className="h-3 w-3" />}
                  </button>
                </td>
                <td className="p-3 font-medium">{c.author}</td>
                <td className="p-3 max-w-md">
                  <p className="line-clamp-2 text-sm">{c.body}</p>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    {new Date(c.createdAt).toLocaleString()}
                  </p>
                </td>
                <td className="p-3 text-xs max-w-[240px]">
                  <VideoCell video={videoById.get(c.videoId)} fallbackId={c.videoId} />
                </td>
                <td className="p-3 text-right space-x-1">
                  <button
                    onClick={() => setEditing(c)}
                    className="rounded-md glass px-2 py-1 text-xs hover:bg-secondary inline-flex items-center gap-1"
                  >
                    <Pencil className="h-3 w-3" /> Edit
                  </button>
                  <button
                    onClick={() => {
                      if (confirm("Delete this comment?")) deleteComment(c.id);
                    }}
                    className="rounded-md bg-destructive/20 text-destructive px-2 py-1 text-xs hover:bg-destructive/30 inline-flex items-center gap-1"
                  >
                    <Trash2 className="h-3 w-3" /> Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <EditCommentModal
          comment={editing}
          onClose={() => setEditing(null)}
          onSave={(patch) => {
            updateComment(editing.id, patch);
            setEditing(null);
          }}
        />
      )}

      {reviewOpen && (
        <ReviewDeleteCommentsModal
          comments={list.filter((c) => selected.has(c.id))}
          videoById={videoById}
          onCancel={() => setReviewOpen(false)}
          onConfirm={() => {
            bulkDelete([...selected]);
            setSelected(new Set());
            setReviewOpen(false);
          }}
        />
      )}
    </div>
  );
}

function ReviewDeleteCommentsModal({
  comments,
  videoById,
  onCancel,
  onConfirm,
}: {
  comments: Comment[];
  videoById: Map<string, Video>;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-2xl rounded-2xl gradient-card p-6 shadow-card space-y-4">
        <h3 className="font-display text-xl font-bold flex items-center gap-2">
          <Trash2 className="h-5 w-5 text-destructive" /> Review {comments.length} comment
          {comments.length === 1 ? "" : "s"} before deletion
        </h3>
        <p className="text-sm text-muted-foreground">
          This action is permanent. Confirm the list below.
        </p>
        <ul className="max-h-80 overflow-y-auto divide-y divide-border rounded-xl bg-background/40">
          {comments.map((c) => {
            const v = videoById.get(c.videoId);
            return (
              <li key={c.id} className="p-3 text-sm space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{c.author}</span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(c.createdAt).toLocaleString()}
                  </span>
                </div>
                <p className="line-clamp-2 text-sm text-muted-foreground">{c.body}</p>
                <p className="text-[10px] text-muted-foreground truncate">
                  on: {v?.title ?? c.videoId}
                </p>
              </li>
            );
          })}
        </ul>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-full glass px-4 py-2 text-sm hover:bg-secondary"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="rounded-full bg-destructive text-destructive-foreground px-4 py-2 text-sm font-semibold hover:bg-destructive/90"
          >
            Delete {comments.length}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Renders a comment's parent video as: the video title (truncated, linked) +
 * a small "Copy URL" button. Falls back to the raw video id when the video
 * record can't be found (e.g. it was deleted).
 */
function VideoCell({ video, fallbackId }: { video?: Video; fallbackId: string }) {
  const [copied, setCopied] = useState(false);
  const title = video?.title || fallbackId;
  const url = video
    ? `${typeof window !== "undefined" ? window.location.origin : ""}${watchPathFor(video)}`
    : "";

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard blocked — ignore */
    }
  };

  return (
    <div className="flex items-start gap-2">
      <div className="min-w-0 flex-1">
        {video ? (
          <a
            href={watchPathFor(video)}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-foreground hover:text-primary line-clamp-2"
            title={title}
          >
            {title}
          </a>
        ) : (
          <span className="text-muted-foreground" title={fallbackId}>
            {fallbackId}
          </span>
        )}
        {video?.channel && (
          <p className="text-[10px] text-muted-foreground truncate mt-0.5">{video.channel}</p>
        )}
      </div>
      {url && (
        <button
          onClick={copy}
          title={copied ? "Copied!" : "Copy video URL"}
          aria-label="Copy video URL"
          className={`shrink-0 rounded-md px-2 py-1 text-[10px] inline-flex items-center gap-1 border transition-colors ${
            copied
              ? "border-primary text-primary bg-primary/10"
              : "border-border text-muted-foreground hover:bg-secondary hover:text-foreground"
          }`}
        >
          <Copy className="h-3 w-3" />
          {copied ? "Copied" : "Copy"}
        </button>
      )}
    </div>
  );
}

function EditCommentModal({
  comment,
  onClose,
  onSave,
}: {
  comment: Comment;
  onClose: () => void;
  onSave: (patch: Partial<Comment>) => void;
}) {
  const [body, setBody] = useState(comment.body);
  const [author, setAuthor] = useState(comment.author);
  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-lg rounded-2xl gradient-card p-6 shadow-card space-y-3">
        <h3 className="font-display text-lg font-bold">Edit comment</h3>
        <label className="block">
          <span className="text-xs uppercase tracking-widest text-muted-foreground">Author</span>
          <input
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
            className="mt-1 w-full rounded-lg bg-background border border-border px-3 py-2 text-sm"
          />
        </label>
        <label className="block">
          <span className="text-xs uppercase tracking-widest text-muted-foreground">Body</span>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={5}
            className="mt-1 w-full rounded-lg bg-background border border-border px-3 py-2 text-sm"
          />
        </label>
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-full glass px-4 py-2 text-sm hover:bg-secondary"
          >
            Cancel
          </button>
          <button
            onClick={() => onSave({ author: author.trim(), body: body.trim() })}
            className="rounded-full gradient-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
          >
            Save changes
          </button>
        </div>
      </div>
    </div>
  );
}
