import { useEffect, useState } from "react";
import { MessageSquare, Send, ShieldOff, UserCircle2 } from "lucide-react";
import {
  COMMENTS_EVENT,
  getCommentsForVideo,
  isCommentsDisabled,
  postComment,
  type Comment,
} from "@/lib/comments-store";
import { useAuth } from "@/hooks/use-auth";

export function Comments({ videoId }: { videoId: string }) {
  const { user } = useAuth();
  const [list, setList] = useState<Comment[]>(() => getCommentsForVideo(videoId));
  const [disabled, setDisabled] = useState(() => isCommentsDisabled(videoId));
  const userDisplay = (user?.fullName || user?.username) ?? "";
  const [author, setAuthor] = useState(userDisplay);
  const [body, setBody] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  // Keep the name field in sync with the logged-in user.
  useEffect(() => {
    if (userDisplay) setAuthor(userDisplay);
  }, [userDisplay]);

  useEffect(() => {
    const sync = () => {
      setList(getCommentsForVideo(videoId));
      setDisabled(isCommentsDisabled(videoId));
    };
    sync();
    window.addEventListener(COMMENTS_EVENT, sync);
    return () => window.removeEventListener(COMMENTS_EVENT, sync);
  }, [videoId]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const name = ((user?.fullName || user?.username) ?? author).trim();
    if (!name || !body.trim()) {
      setMsg("Name and comment are required.");
      return;
    }
    if (body.length > 1000) {
      setMsg("Comment must be 1000 characters or less.");
      return;
    }
    postComment({
      videoId,
      author: name.slice(0, 60),
      email: user?.email,
      body: body.trim(),
    });
    setBody("");
    setMsg("Comment posted.");
    setTimeout(() => setMsg(null), 2500);
  };

  return (
    <div className="space-y-4">
      {disabled ? (
        <div className="rounded-2xl gradient-card p-4 shadow-card text-sm text-muted-foreground flex items-center gap-2">
          <ShieldOff className="h-4 w-4" />{" "}
          {list.length === 0
            ? "Comments are disabled for this video."
            : "New comments are disabled for this video. Existing comments are shown below."}
        </div>
      ) : (
        <form onSubmit={submit} className="rounded-2xl gradient-card p-5 shadow-card space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <MessageSquare className="h-4 w-4 text-primary" /> Leave a comment
          </div>
          {user ? (
            <div className="flex items-center gap-2 rounded-lg bg-background/60 border border-border px-3 py-2 text-sm">
              <span
                className="h-7 w-7 rounded-full flex items-center justify-center text-xs font-bold text-white"
                style={{ backgroundColor: user.avatarColor }}
              >
                {(user.fullName || user.username).charAt(0).toUpperCase()}
              </span>
              <span className="font-medium">{user.fullName || user.username}</span>
              <span className="text-xs text-muted-foreground ml-auto">Signed in</span>
            </div>
          ) : (
            <div className="relative">
              <UserCircle2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
                placeholder="Your name"
                maxLength={60}
                className="w-full rounded-lg bg-background border border-border focus:border-primary/60 pl-9 pr-3 py-2 text-sm outline-none focus:shadow-glow"
              />
            </div>
          )}
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Share your thoughts… Be respectful — no minors, no illegal content."
            rows={3}
            maxLength={1000}
            className="w-full rounded-lg bg-background border border-border focus:border-primary/60 px-3 py-2 text-sm outline-none focus:shadow-glow"
          />
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground">{body.length}/1000</span>
            <button className="inline-flex items-center gap-2 rounded-full gradient-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-glow hover:scale-105 transition-transform">
              <Send className="h-4 w-4" /> Post comment
            </button>
          </div>
          {msg && <p className="text-xs text-muted-foreground">{msg}</p>}
        </form>
      )}

      <div className="space-y-3">
        {list.length === 0 && !disabled && (
          <p className="text-sm text-muted-foreground">No comments yet — be the first to comment. 18+ only.</p>
        )}
        {list.map((c) => (
          <article key={c.id} className="rounded-xl glass p-4">
            <div className="flex items-center gap-2 text-sm">
              <span className="font-semibold">{c.author}</span>
              <span className="text-xs text-muted-foreground">
                {new Date(c.createdAt).toLocaleString()}
              </span>
            </div>
            <p className="mt-2 text-sm whitespace-pre-wrap">{c.body}</p>
          </article>
        ))}
      </div>
    </div>
  );
}
