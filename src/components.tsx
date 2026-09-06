import {
  cloneElement,
  isValidElement,
  useId,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { X, Shield, ArrowUpRight, LoaderCircle, Video } from "lucide-react";
import { videoBlob } from "./api";
import type { Box, Match } from "./types";

export const statusLabels: Record<string, string> = {
  open: "도전 모집",
  applied: "합의 준비",
  locked: "경기 준비",
  live: "경기 진행",
  submitted: "상대 제출 대기",
  review: "기록 검토",
  disputed: "분쟁 검토",
  finalized: "결과 확정",
  cancelled: "취소",
  void: "무효",
};
export const formatLabel = (value: string) =>
  value === "team3" ? "3인 팀전" : "개인전";
export const date = (value: string) =>
  new Date(value).toLocaleString("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  const id = useId();
  const control = isValidElement<{ id?: string; "aria-describedby"?: string }>(
    children,
  )
    ? cloneElement(children, {
        id,
        "aria-describedby": hint ? `${id}-hint` : undefined,
      })
    : children;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {control}
      {hint && <small id={`${id}-hint`}>{hint}</small>}
    </div>
  );
}
export function Empty({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <Shield size={30} strokeWidth={1.3} />
      <h3>{title}</h3>
      {children}
    </div>
  );
}
export function Busy() {
  return (
    <span className="busy">
      <LoaderCircle size={18} className="spin" /> 처리 중
    </span>
  );
}
export function Modal({
  title,
  children,
  close,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = ref.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  return (
    <dialog ref={ref} onCancel={close} className="modal">
      <div className="modal-head">
        <h2>{title}</h2>
        <button className="icon-button" aria-label="닫기" onClick={close}>
          <X />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function Form({
  onSubmit,
  children,
  label = "저장",
  className = "",
}: {
  onSubmit: (data: FormData) => Promise<unknown>;
  children: ReactNode;
  label?: string;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      await onSubmit(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className={`form ${className}`}>
      <fieldset disabled={busy}>{children}</fieldset>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <button className="primary" type="submit" disabled={busy}>
        {busy ? <Busy /> : label}
      </button>
    </form>
  );
}
export function BoxMark({ box, small }: { box?: Box; small?: boolean }) {
  return (
    <div
      className={`box-mark ${small ? "small" : ""} ${box?.decoration ? "decorated" : ""}`}
    >
      <Shield strokeWidth={1.5} />
      <span>{box?.name.slice(0, 2) || "WS"}</span>
    </div>
  );
}
export function MatchCard({
  match,
  boxes,
  select,
  selected,
}: {
  match: Match;
  boxes: Box[];
  select: () => void;
  selected?: boolean;
}) {
  const defender = boxes.find((b) => b.id === match.defenderId);
  const challenger = boxes.find((b) => b.id === match.challengerId);
  return (
    <button
      className={`match-card ${selected ? "selected" : ""}`}
      onClick={select}
    >
      <div className="card-top">
        <span className={`status ${match.status}`}>
          {statusLabels[match.status] || match.status}
        </span>
        <span className="muted mono">
          {match.level} · {formatLabel(match.format)}
        </span>
      </div>
      <h3>{match.title}</h3>
      <p className="muted">
        {match.template.name} ·{" "}
        {match.template.kind === "amrap" ? "AMRAP" : "FOR TIME"}
      </p>
      <div className="versus-mini">
        <span>{defender?.name ?? "방어 Box"}</span>
        <i>VS</i>
        <span>{challenger?.name ?? "도전자를 기다려요"}</span>
      </div>
      <div className="card-bottom">
        <span>{date(match.scheduledAt)}</span>
        <ArrowUpRight size={19} />
      </div>
    </button>
  );
}
export function VideoPlayer({ id }: { id: string }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );
  return (
    <div>
      {url ? (
        <video controls playsInline src={url} preload="metadata" />
      ) : (
        <button
          className="secondary"
          disabled={loading}
          onClick={async () => {
            setError("");
            setLoading(true);
            try {
              const blob = await videoBlob(id);
              if (mounted.current) setUrl(blob);
              else URL.revokeObjectURL(blob);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setLoading(false);
            }
          }}
        >
          <Video size={18} />
          {loading ? "영상 불러오는 중" : "증빙 영상 보기"}
        </button>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
