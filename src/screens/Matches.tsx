import { useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  ChevronRight,
  Flame,
  MapPin,
  Plus,
  Shield,
  Swords,
  Users,
} from "lucide-react";
import { usePilot } from "../context";
import {
  BoxMark,
  date,
  Empty,
  Field,
  Form,
  formatLabel,
  MatchCard,
  Modal,
  statusLabels,
  VideoPlayer,
} from "../components";
import { api, uploadVideo } from "../api";
import type { Match, RecordEntry } from "../types";

export function Home() {
  const { state, go } = usePilot();
  const box = state.boxes.find((b) => b.id === state.user.boxId);
  const upcoming = state.matches.filter(
    (m) =>
      [m.defenderId, m.challengerId].includes(box?.id || "") &&
      !["finalized", "void", "cancelled", "open"].includes(m.status),
  );
  const open = state.matches.filter((m) => m.status === "open");
  const completed = state.matches.filter(
    (m) =>
      m.status === "finalized" &&
      [m.defenderId, m.challengerId].includes(box?.id || ""),
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">THE NEXT CHALLENGE</span>
          <h1>오늘도, 한 걸음 더.</h1>
          <p>{state.user.name}님, 우리 Box의 다음 승부를 준비해 볼까요?</p>
        </div>
        <button className="secondary" onClick={() => go("boxes")}>
          <BuildingIcon /> 내 Box
        </button>
      </div>
      <div className="home-grid">
        <section className="challenge-hero">
          <span className="eyebrow">DEFEND YOUR BOX. BREAK THEIR RECORD.</span>
          <h2>
            우리의 기록이
            <br />
            <em>도전장이 되는 곳.</em>
          </h2>
          <p>
            같은 WOD, 같은 기준.
            <br />
            다음 대결의 주인공은 우리 Box입니다.
          </p>
          <button className="primary" onClick={() => go("matches")}>
            도전장 살펴보기 <ArrowRight size={19} />
          </button>
          <div className="hero-emblem" aria-hidden="true">
            <Shield strokeWidth={0.65} />
            <Swords strokeWidth={1} />
          </div>
          <span className="hero-caption">WOD / PROOF / RESPECT</span>
        </section>
        <section className="panel box-summary">
          <div className="section-label">
            <span>OUR BOX</span>
            <Shield size={18} />
          </div>
          <BoxMark box={box} />
          <h2>{box?.name || "함께할 Box를 찾아요"}</h2>
          <p className="muted">
            {box
              ? `${box.district} · ${box.dong}`
              : "등록하거나, 이미 있는 Box에 가입하세요."}
          </p>
          {box ? (
            <>
              <div className="box-stats">
                <div>
                  <strong>
                    {box.members.length}
                    <small>명</small>
                  </strong>
                  <span>함께하는 멤버</span>
                </div>
                <div>
                  <strong>
                    {completed.length}
                    <small>경기</small>
                  </strong>
                  <span>완료한 도전</span>
                </div>
              </div>
              <div className="verification-line">
                <i className={box.active ? "ok-dot" : "wait-dot"} />
                {box.active
                  ? "경기 참가 준비 완료"
                  : `위치 확인 ${box.checks.length}/3 · 운영 확인 ${box.operatorVerified ? "완료" : "대기"}`}
              </div>
            </>
          ) : (
            <button className="secondary" onClick={() => go("boxes")}>
              Box 찾기 <ChevronRight size={18} />
            </button>
          )}
        </section>
      </div>
      <div className="section-heading">
        <div>
          <span className="eyebrow">IN PROGRESS</span>
          <h2>이어갈 대결</h2>
        </div>
        <button className="text-button" onClick={() => go("matches")}>
          전체 보기 <ArrowRight size={17} />
        </button>
      </div>
      {upcoming.length ? (
        <div className="card-grid">
          {upcoming.slice(0, 3).map((m) => (
            <MatchCard
              key={m.id}
              match={m}
              boxes={state.boxes}
              select={() => go(`matches/${m.id}`)}
            />
          ))}
        </div>
      ) : (
        <Empty
          title={
            box
              ? "아직 진행 중인 대결이 없어요"
              : "Box와 함께 첫 도전을 준비하세요"
          }
        >
          <p>도전장을 열거나 다른 Box의 WOD에 도전해 보세요.</p>
        </Empty>
      )}
      <div className="section-heading">
        <div>
          <span className="eyebrow">OPEN CHALLENGES</span>
          <h2>지금, 도전할 수 있는 WOD</h2>
        </div>
        <span className="count">{open.length}개 모집 중</span>
      </div>
      {open.length ? (
        <div className="card-grid">
          {open.slice(0, 3).map((m) => (
            <MatchCard
              key={m.id}
              match={m}
              boxes={state.boxes}
              select={() => go(`matches/${m.id}`)}
            />
          ))}
        </div>
      ) : (
        <div className="open-invite">
          <Flame size={26} />
          <div>
            <h3>첫 도전장을 열어 보세요.</h3>
            <p>운영 확인이 끝난 Box 관리자가 WOD와 일정을 제안할 수 있어요.</p>
          </div>
          <button className="secondary" onClick={() => go("matches")}>
            대결 준비하기 <ArrowRight size={17} />
          </button>
        </div>
      )}
    </>
  );
}
function BuildingIcon() {
  return <Shield size={18} />;
}

function CreateMatch({ close }: { close: () => void }) {
  const { state, refresh, go } = usePilot();
  const [draft, setDraft] = useState<Record<string, string>>(() => {
    try {
      return JSON.parse(localStorage.getItem("wodsiege-match-draft") || "{}");
    } catch {
      return {};
    }
  });
  function value(name: string, fallback = "") {
    return {
      value: draft[name] ?? fallback,
      onChange: (
        event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>,
      ) => {
        const next = { ...draft, [name]: event.target.value };
        setDraft(next);
        localStorage.setItem("wodsiege-match-draft", JSON.stringify(next));
      },
    };
  }
  const template = state.templates.find(
    (t) => t.id === (draft.templateId || state.templates[0]?.id),
  );
  return (
    <Modal title="우리 Box 도전장 열기" close={close}>
      <p className="muted">
        방어 Box가 WOD를 제안합니다. 상대 Box와 합의하면 조건을 잠가요.
      </p>
      <Form
        label="도전장 공개"
        onSubmit={async (data) => {
          const match = await api<Match>("/matches", {
            ...Object.fromEntries(data),
            scheduledAt: new Date(
              String(data.get("scheduledAt")),
            ).toISOString(),
          });
          localStorage.removeItem("wodsiege-match-draft");
          await refresh();
          close();
          go(`matches/${match.id}`);
        }}
      >
        <Field label="도전장 제목">
          <input
            name="title"
            required
            minLength={2}
            maxLength={80}
            placeholder="토요일, 우리 Box에 도전하세요"
            {...value("title")}
          />
        </Field>
        <Field label="WOD · 부문">
          <select
            name="templateId"
            {...value("templateId", state.templates[0]?.id)}
          >
            {state.templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} · {t.level} · v{t.version}
              </option>
            ))}
          </select>
        </Field>
        {template && (
          <div className="template-preview">
            <strong>
              {template.kind === "amrap" ? "AMRAP" : "FOR TIME"} ·{" "}
              {template.timeCap / 60}분
            </strong>
            <p>{template.movements.join(" / ")}</p>
            <small>{template.description}</small>
          </div>
        )}
        <div className="form-row">
          <Field label="경기 구성">
            <select name="format" {...value("format", "individual")}>
              <option value="individual">개인전 · Box 대표 1명</option>
              <option value="team3">팀전 · Open 3인 합산</option>
            </select>
          </Field>
          <Field label="개최 방식">
            <select name="venue" {...value("venue", "together")}>
              <option value="together">한 장소에서 함께</option>
              <option value="separate">각자의 Box에서</option>
            </select>
          </Field>
        </div>
        <Field
          label="경기 일시"
          hint="기기의 현지 시간으로 입력합니다. 서버에는 UTC로 저장합니다."
        >
          <input
            name="scheduledAt"
            type="datetime-local"
            required
            {...value("scheduledAt")}
          />
        </Field>
        <Field label="장소 / 장비 합의">
          <input
            name="location"
            required
            maxLength={160}
            placeholder="성수 Box / 동일 장비 사용"
            {...value("location")}
          />
        </Field>
        <div className="info-note">
          제출 마감: 경기 후 24시간 · 검토 마감: 경기 후 48시간. 개발용 규칙을
          양측이 확인한 뒤 명단에 동의하세요.
        </div>
      </Form>
    </Modal>
  );
}

export function Matches({ selectedId }: { selectedId?: string }) {
  const { state, go } = usePilot();
  const [filter, setFilter] = useState("all");
  const [create, setCreate] = useState(false);
  const mine = state.boxes.find((b) => b.id === state.user.boxId);
  const selected = state.matches.find((m) => m.id === selectedId);
  const matches = state.matches.filter(
    (m) =>
      filter === "all" ||
      (filter === "open"
        ? m.status === "open"
        : filter === "mine"
          ? [m.defenderId, m.challengerId].includes(mine?.id || "")
          : m.status === "finalized"),
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">THE ARENA</span>
          <h1>다음 승부를 찾아요.</h1>
          <p>WOD와 조건을 확인하고 우리 Box의 이름으로 도전하세요.</p>
        </div>
        {mine?.ownerId === state.user.id && (
          <button
            className="primary"
            disabled={!mine.active}
            onClick={() => setCreate(true)}
          >
            <Plus size={18} /> 도전장 열기
          </button>
        )}
      </div>
      {mine && !mine.active && (
        <div className="info-note">
          도전장을 열거나 신청하려면 소속 3명의 위치 확인과 운영 권한 확인이
          필요해요.{" "}
          <button className="text-button" onClick={() => go("boxes")}>
            Box 확인하기 →
          </button>
        </div>
      )}
      <div className="tabs" aria-label="대결 필터">
        {[
          ["all", "전체 대결"],
          ["open", "도전 모집"],
          ["mine", "우리 Box"],
          ["finalized", "완료한 대결"],
        ].map(([key, label]) => (
          <button
            key={key}
            className={filter === key ? "active" : ""}
            onClick={() => setFilter(key)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className={`arena-layout ${selected ? "has-selection" : ""}`}>
        <div className="match-list">
          {matches.length ? (
            matches.map((m) => (
              <MatchCard
                key={m.id}
                match={m}
                boxes={state.boxes}
                selected={m.id === selectedId}
                select={() => go(`matches/${m.id}`)}
              />
            ))
          ) : (
            <Empty title="이 조건의 대결이 없어요">
              <p>다른 필터를 선택하거나 첫 도전장을 열어 보세요.</p>
            </Empty>
          )}
        </div>
        <div className="match-detail-pane">
          {selected ? (
            <MatchDetail
              key={selected.id}
              match={selected}
              close={() => go("matches")}
            />
          ) : (
            <div className="arena-wait">
              <Swords size={64} strokeWidth={0.8} />
              <h2>
                같은 WOD.
                <br />
                새로운 상대.
              </h2>
              <p>
                도전장을 선택하면 조건과
                <br />
                다음 할 일을 확인할 수 있어요.
              </p>
            </div>
          )}
        </div>
      </div>
      {create && <CreateMatch close={() => setCreate(false)} />}
    </>
  );
}

function SubmissionForm({ match, boxId }: { match: Match; boxId: string }) {
  const { state, mutate, toast } = usePilot();
  const [progress, setProgress] = useState(0);
  const [uploadedId, setUploadedId] = useState("");
  const [fileName, setFileName] = useState("");
  const roster = match.rosters[boxId] || [];
  return (
    <Form
      label="영상과 기록 제출"
      onSubmit={async (data) => {
        let videoId = uploadedId;
        const file = data.get("video") as File;
        if (!videoId) {
          if (!file?.size) throw new Error("증빙 영상을 선택해 주세요.");
          if (file.size > 100 * 1024 * 1024)
            throw new Error("영상은 100MB 이하로 선택해 주세요.");
          videoId = await uploadVideo(match.id, file, setProgress);
          setUploadedId(videoId);
        }
        const records: RecordEntry[] = roster.map((id) => ({
          userId: id,
          completed: data.get(`completed-${id}`) === "on",
          seconds: Number(data.get(`seconds-${id}`) || 0),
          reps: Number(data.get(`reps-${id}`)),
          noReps: Number(data.get(`noReps-${id}`) || 0),
          note: String(data.get(`note-${id}`) || ""),
          videoSecond: Number(data.get(`videoSecond-${id}`) || 0),
        }));
        await mutate(`/matches/${match.id}/submit`, { videoId, records });
        toast(
          "기록을 제출했습니다. 양측 제출 후 상대 기록을 검토할 수 있어요.",
        );
      }}
    >
      <div className="info-note">
        합의된 지정 시도 1회를 제출하세요. 양측 제출 전에는 상대 기록이 공개되지
        않습니다. {formatLabel(match.format)} ·{" "}
        {match.template.kind === "amrap"
          ? "유효 반복 수 합산"
          : "완료 인원 → 미완료 반복 수 → 완료 시간 순"}
      </div>
      <Field
        label="경기 증빙 영상"
        hint="MP4 또는 WebM · 최대 100MB · 팀전은 모든 선수의 수행이 확인되는 영상"
      >
        <input
          name="video"
          type="file"
          accept="video/mp4,video/webm"
          required={!uploadedId}
          onChange={(e) => {
            setUploadedId("");
            setProgress(0);
            setFileName(e.target.files?.[0]?.name || "");
          }}
        />
      </Field>
      {fileName && <small className="muted">{fileName}</small>}
      {progress > 0 && (
        <div className="upload-progress">
          <progress max="100" value={progress} />
          <span>
            {uploadedId
              ? "업로드 완료 · 제출 실패 시 재사용"
              : `전송 ${progress}%`}
          </span>
        </div>
      )}
      {roster.map((id) => (
        <section className="record-input" key={id}>
          <h4>{state.users.find((u) => u.id === id)?.name || id}의 기록</h4>
          {match.template.kind === "for-time" && (
            <label className="check-label">
              <input name={`completed-${id}`} type="checkbox" defaultChecked />
              제한 시간 내 모든 반복 완료
            </label>
          )}
          <div className="form-row">
            <Field label="유효 반복 수">
              <input
                name={`reps-${id}`}
                type="number"
                min="0"
                max={
                  match.template.kind === "for-time"
                    ? match.template.totalReps
                    : 100000
                }
                required
                defaultValue={
                  match.template.kind === "for-time"
                    ? match.template.totalReps
                    : ""
                }
              />
            </Field>
            <Field
              label="완료 시간 (초)"
              hint={
                match.template.kind === "amrap"
                  ? "AMRAP은 정해진 시간으로 입력"
                  : "미완료는 제한 시간으로 입력"
              }
            >
              <input
                name={`seconds-${id}`}
                type="number"
                min="0"
                max={match.template.timeCap}
                required
                defaultValue={match.template.timeCap}
              />
            </Field>
          </div>
          <div className="form-row">
            <Field label="무효 반복 수">
              <input
                name={`noReps-${id}`}
                type="number"
                min="0"
                defaultValue="0"
              />
            </Field>
            <Field label="근거 영상 시점 (초)">
              <input
                name={`videoSecond-${id}`}
                type="number"
                min="0"
                defaultValue="0"
              />
            </Field>
          </div>
          <Field label="카운팅 / 판정 메모">
            <textarea
              name={`note-${id}`}
              rows={2}
              maxLength={1000}
              placeholder="무효 동작과 구간별 근거를 적어 주세요."
            />
          </Field>
        </section>
      ))}
      <label className="check-label">
        <input name="consent" type="checkbox" required />
        영상 속 참여자의 촬영·검증용 열람 동의를 확인했습니다.
      </label>
    </Form>
  );
}

export function MatchDetail({
  match: m,
  close,
}: {
  match: Match;
  close: () => void;
}) {
  const { state, run, mutate, toast } = usePilot();
  const [dialog, setDialog] = useState<"cancel" | "dispute" | null>(null);
  const box = state.boxes.find((b) => b.id === state.user.boxId);
  const defender = state.boxes.find((b) => b.id === m.defenderId);
  const challenger = state.boxes.find((b) => b.id === m.challengerId);
  const owner = box?.ownerId === state.user.id;
  const party = !!box && [m.defenderId, m.challengerId].includes(box.id);
  const operator = state.user.role === "operator";
  const submitted = m.submissionBoxes || Object.keys(m.submissions);
  const alreadySubmitted = !!box && submitted.includes(box.id);
  const stage = ["open", "applied"].includes(m.status)
    ? 0
    : m.status === "locked"
      ? 1
      : ["live", "submitted"].includes(m.status)
        ? 2
        : ["review", "disputed"].includes(m.status)
          ? 3
          : 4;
  return (
    <article className="match-detail">
      <button className="text-button detail-back" onClick={close}>
        <ArrowLeft size={17} /> 대결 목록
      </button>
      <div className="detail-heading">
        <span className={`status ${m.status}`}>{statusLabels[m.status]}</span>
        <span className="mono muted">
          {m.level} / {formatLabel(m.format)}
        </span>
      </div>
      <h2>{m.title}</h2>
      <div className="battle-board">
        <div>
          <BoxMark box={defender} />
          <span className="eyebrow">DEFENDER</span>
          <h3>{defender?.name}</h3>
        </div>
        <span className="vs">VS</span>
        <div>
          <BoxMark box={challenger} />
          <span className="eyebrow orange">CHALLENGER</span>
          <h3>{challenger?.name || "도전자 모집 중"}</h3>
        </div>
      </div>
      <ol className="match-timeline">
        {["합의", "준비", "제출", "검토", "결과"].map((text, i) => (
          <li key={text} className={i <= stage ? "reached" : ""}>
            <span>{i < stage ? <Check size={12} /> : i + 1}</span>
            {text}
          </li>
        ))}
      </ol>
      <section className="wod-sheet">
        <div className="section-label">
          <span>THE WORKOUT</span>
          <span>
            v{m.template.version} · {m.level}
          </span>
        </div>
        <h3>{m.template.name}</h3>
        <div className="wod-meta">
          <strong>{m.template.kind === "amrap" ? "AMRAP" : "FOR TIME"}</strong>
          <span>{m.template.timeCap / 60} MIN CAP</span>
        </div>
        <ul>
          {m.template.movements.map((move, index) => (
            <li key={index}>{move}</li>
          ))}
        </ul>
        <p>{m.template.description}</p>
      </section>
      <div className="match-facts">
        <div>
          <CalendarDays />
          <span>
            경기 일시<strong>{date(m.scheduledAt)}</strong>
          </span>
        </div>
        <div>
          <MapPin />
          <span>
            {m.venue === "together" ? "한 장소에서 함께" : "각자의 Box에서"}
            <strong>{m.location}</strong>
          </span>
        </div>
        <div>
          <Users />
          <span>
            제출 · 검토 마감
            <strong>
              {date(m.submitBy)} · {date(m.reviewBy)}
            </strong>
          </span>
        </div>
      </div>
      {m.result && (
        <section className="result-panel">
          <span className="eyebrow">MATCH RESULT</span>
          <h3>
            {m.status === "void"
              ? "무효 경기"
              : m.result.winnerId
                ? `${state.boxes.find((b) => b.id === m.result!.winnerId)?.name} ${m.result.winnerId === m.defenderId ? "도장 지키기 성공" : "도장 깨기 성공"}`
                : "무승부"}
          </h3>
          <p>{m.result.reason}</p>
          <small>
            확정 결과는 부문별 순위에 반영됩니다. 같은 상대와 하루 첫 경기만
            점수·보상에 반영합니다.
          </small>
        </section>
      )}
      <section className="detail-actions">
        <h3>다음 할 일</h3>
        {m.status === "open" && !party && owner && (
          <button
            className="primary"
            disabled={!box?.active}
            onClick={() =>
              void run(
                `/matches/${m.id}/apply`,
                {},
                "도전을 신청했습니다. 방어 Box의 수락을 기다려 주세요.",
              )
            }
          >
            <Swords size={18} /> 우리 Box로 도전 신청
          </button>
        )}
        {m.status === "open" && party && (
          <p className="muted">
            도전자를 기다리고 있어요. WOD와 조건은 신청 전 모두 공개됩니다.
          </p>
        )}
        {m.status === "applied" &&
          !m.acceptedAt &&
          owner &&
          box?.id === m.defenderId && (
            <button
              className="primary"
              onClick={() =>
                void run(
                  `/matches/${m.id}/accept`,
                  {},
                  "도전을 수락했습니다. 양측 명단을 확정해 주세요.",
                )
              }
            >
              도전 수락
            </button>
          )}
        {m.status === "applied" &&
          !m.acceptedAt &&
          box?.id === m.challengerId && (
            <p className="muted">방어 Box의 수락을 기다리고 있어요.</p>
          )}
        {m.status === "applied" &&
          m.acceptedAt &&
          party &&
          owner &&
          !m.agreements.includes(box!.id) && (
            <Form
              label="명단과 경기 조건에 동의"
              onSubmit={async (data) => {
                await mutate(`/matches/${m.id}/agree`, {
                  roster: data.getAll("roster"),
                });
                toast("합의를 저장했습니다. 양측이 동의하면 조건을 잠급니다.");
              }}
            >
              <p className="muted">
                {formatLabel(m.format)} 출전{" "}
                {m.format === "team3" ? "3명" : "1명"}을 선택하세요.
                일시·장소·WOD·채점과 마감에 함께 동의합니다.
              </p>
              <div className="roster-list">
                {box!.members.map((id) => (
                  <label key={id} className="check-label">
                    <input type="checkbox" name="roster" value={id} />
                    {state.users.find((u) => u.id === id)?.name || id}
                  </label>
                ))}
              </div>
            </Form>
          )}
        {m.status === "applied" && box && m.agreements.includes(box.id) && (
          <p className="success-text">
            <Check size={17} /> 우리 Box 동의 완료 · 상대 동의 대기
          </p>
        )}
        {m.status === "locked" && party && owner && (
          <>
            <p className="muted">
              조건이 잠겼습니다. {date(m.scheduledAt)}부터 경기를 시작할 수
              있어요.
            </p>
            <button
              className="primary"
              disabled={Date.now() < new Date(m.scheduledAt).getTime()}
              onClick={() =>
                void run(`/matches/${m.id}/start`, {}, "경기를 시작했습니다.")
              }
            >
              경기 시작
            </button>
          </>
        )}
        {["live", "submitted"].includes(m.status) &&
          party &&
          owner &&
          !alreadySubmitted && <SubmissionForm match={m} boxId={box!.id} />}
        {["live", "submitted"].includes(m.status) && alreadySubmitted && (
          <p className="success-text">
            <Check size={17} /> 우리 기록 제출 완료 · 상대 제출을 기다려 주세요.
          </p>
        )}
        {m.status === "review" && party && owner && (
          <>
            <p className="muted">
              아래 상대 영상과 기록을 검토해 주세요. 양측 확인과 검토 마감 이후
              결과를 확정합니다.
            </p>
            {!m.reviews.includes(box!.id) ? (
              <div className="button-row">
                <button
                  className="primary"
                  onClick={() =>
                    void run(
                      `/matches/${m.id}/review`,
                      { approved: true },
                      "상대 기록을 확인했습니다.",
                    )
                  }
                >
                  상대 기록 확인
                </button>
                <button
                  className="secondary"
                  onClick={() => setDialog("dispute")}
                >
                  이의 제기
                </button>
              </div>
            ) : (
              <div>
                <p className="success-text">
                  <Check size={17} /> 우리 Box 검토 완료
                </p>
                <button
                  className="text-button"
                  onClick={() => setDialog("dispute")}
                >
                  검토 기한 내 이의 제기
                </button>
              </div>
            )}
            <button
              className="secondary"
              disabled={
                m.reviews.length < 2 ||
                Date.now() < new Date(m.reviewBy).getTime()
              }
              onClick={() =>
                void run(
                  `/matches/${m.id}/finalize`,
                  {},
                  "결과가 확정되었습니다.",
                )
              }
            >
              검토 기한 종료 후 결과 확정
            </button>
          </>
        )}
        {m.status === "disputed" && (
          <div className="info-note">
            이의 사유:{" "}
            {m.dispute?.reason || "운영자가 근거를 검토하고 있습니다."}
            <br />
            판정 전에는 점수가 반영되지 않아요.
          </div>
        )}
        {!owner && !operator && (
          <p className="muted">
            도전 신청·명단 동의·기록 제출은 소속 Box 관리자가 진행합니다.
          </p>
        )}
        {["finalized", "void", "cancelled"].includes(m.status) && (
          <p className="muted">
            경기가 종료되었습니다. 기록과 이력은 보존됩니다.
          </p>
        )}
      </section>
      {Object.keys(m.rosters).length > 0 && (
        <section className="detail-section">
          <h3>잠금 명단 · 경기 당시 소속</h3>
          {Object.entries(m.rosters).map(([id, members]) => (
            <p key={id}>
              <strong>{state.boxes.find((b) => b.id === id)?.name}</strong> ·{" "}
              {members
                .map(
                  (uid) => state.users.find((u) => u.id === uid)?.name || uid,
                )
                .join(", ")}
            </p>
          ))}
        </section>
      )}
      {Object.entries(m.submissions).map(([id, submission]) => (
        <section className="detail-section" key={id}>
          <h3>{state.boxes.find((b) => b.id === id)?.name} 제출 기록</h3>
          {submission.records.map((r) => (
            <div key={r.userId} className="score-row">
              <strong>
                {state.users.find((u) => u.id === r.userId)?.name}
              </strong>
              <span>
                {r.reps} reps · {r.seconds}s · 무효 {r.noReps}
              </span>
              <p>
                {r.completed
                  ? "완료"
                  : m.template.kind === "amrap"
                    ? "AMRAP 기록"
                    : "미완료"}{" "}
                · 영상 {r.videoSecond}초 · {r.note || "별도 메모 없음"}
              </p>
            </div>
          ))}
          <VideoPlayer id={submission.videoId} />
        </section>
      ))}
      <details className="history">
        <summary>경기 진행 이력 ({m.history.length})</summary>
        {m.history.map((h, i) => (
          <p key={i}>
            <time>{date(h.at)}</time>
            <span>
              {String(h.action || h.type || "상태 변경")}
              {h.reason ? ` · ${h.reason}` : ""}
            </span>
          </p>
        ))}
      </details>
      {party && owner && ["open", "applied", "locked"].includes(m.status) && (
        <button
          className="text-button danger"
          onClick={() => setDialog("cancel")}
        >
          경기 취소 요청
        </button>
      )}
      {party && owner && ["live", "submitted"].includes(m.status) && (
        <p className="fine-print">
          시작한 경기는 취소할 수 없습니다. 수행 불가·미제출 등은 운영자의 근거
          검토로 무효 처리합니다.
        </p>
      )}
      {dialog && (
        <Modal
          title={dialog === "cancel" ? "경기 취소" : "기록 이의 제기"}
          close={() => setDialog(null)}
        >
          <p className="muted">
            {dialog === "cancel"
              ? "취소 경기는 점수에 반영되지 않습니다. 상대에게 전달할 사유를 남겨 주세요."
              : "논쟁 구간의 영상 시점과 사유를 구체적으로 남겨 주세요. 판정 전 점수 반영을 보류합니다."}
          </p>
          <Form
            label={dialog === "cancel" ? "사유를 남기고 취소" : "이의 접수"}
            onSubmit={async (data) => {
              await mutate(
                `/matches/${m.id}/${dialog === "cancel" ? "cancel" : "review"}`,
                {
                  reason: data.get("reason"),
                  ...(dialog === "dispute" ? { approved: false } : {}),
                },
              );
              setDialog(null);
              toast("사유와 함께 접수했습니다.");
            }}
          >
            <Field label="사유">
              <textarea
                name="reason"
                required
                minLength={5}
                maxLength={1000}
                rows={4}
              />
            </Field>
          </Form>
        </Modal>
      )}
    </article>
  );
}
