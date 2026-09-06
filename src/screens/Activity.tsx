import { useEffect, useState } from "react";
import {
  ArrowUpRight,
  Award,
  Coins,
  LogOut,
  Settings2,
  Shield,
  Sparkles,
  Trophy,
} from "lucide-react";
import { usePilot } from "../context";
import { api } from "../api";
import {
  BoxMark,
  date,
  Empty,
  Field,
  Form,
  formatLabel,
  Modal,
  statusLabels,
} from "../components";
import type { Match, Ranking } from "../types";

export function Rankings() {
  const { state } = usePilot();
  const [format, setFormat] = useState("individual");
  const [level, setLevel] = useState("Rx");
  const [district, setDistrict] = useState("");
  const [dong, setDong] = useState("");
  const [rankings, setRankings] = useState<Ranking[]>([]);
  const [updatedAt, setUpdatedAt] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    api<{ rankings: Ranking[]; updatedAt: string }>(
      `/rankings?${new URLSearchParams({ format, level, district, dong })}`,
    )
      .then((data) => {
        if (active) {
          setRankings(data.rankings);
          setUpdatedAt(data.updatedAt);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [format, level, district, dong, state.updatedAt, retry]);
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">PROVE IT TOGETHER</span>
          <h1>우리 동네의 승부.</h1>
          <p>같은 부문의 확정 경기로 쌓아 올린 Box 순위입니다.</p>
        </div>
        <Trophy className="heading-icon" size={42} strokeWidth={1.2} />
      </div>
      <section className="ranking-banner">
        <div>
          <span className="eyebrow">FAIR PLAY, REAL PROGRESS</span>
          <h2>
            실력은 기록으로.
            <br />
            명예는 함께.
          </h2>
        </div>
        <p>
          소비하는 포인트와 경쟁 레이팅은 별개예요.
          <br />
          동점은 공동 순위로 표시합니다.
        </p>
      </section>
      <div className="ranking-filters">
        <Field label="경기 구성">
          <select value={format} onChange={(e) => setFormat(e.target.value)}>
            <option value="individual">개인전</option>
            <option value="team3">3인 팀전</option>
          </select>
        </Field>
        <Field label="운동 수준">
          <select value={level} onChange={(e) => setLevel(e.target.value)}>
            <option>Rx</option>
            <option>Scaled</option>
          </select>
        </Field>
        <Field label="지역구">
          <select
            value={district}
            onChange={(e) => {
              setDistrict(e.target.value);
              setDong("");
            }}
          >
            <option value="">파일럿 전체</option>
            {[...new Set(state.boxes.map((b) => b.district))].map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
        </Field>
        <Field label="동네">
          <select value={dong} onChange={(e) => setDong(e.target.value)}>
            <option value="">모든 동네</option>
            {[
              ...new Set(
                state.boxes
                  .filter((b) => !district || b.district === district)
                  .map((b) => b.dong),
              ),
            ].map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
        </Field>
      </div>
      {error ? (
        <div className="error" role="alert">
          {error}
          <button className="secondary" onClick={() => setRetry(retry + 1)}>
            다시 시도
          </button>
        </div>
      ) : loading ? (
        <p className="muted" role="status">
          순위를 불러오고 있어요.
        </p>
      ) : rankings.length ? (
        <section className="panel ranking-table">
          <div className="ranking-row ranking-header">
            <span>순위</span>
            <span>BOX</span>
            <span>경기</span>
            <span>레이팅</span>
          </div>
          {rankings.map((r) => (
            <div
              key={r.boxId}
              className={`ranking-row ${r.boxId === state.user.boxId ? "my-ranking" : ""}`}
            >
              <strong
                className={`rank-number ${r.rank <= 3 ? "top-rank" : ""}`}
              >
                {String(r.rank).padStart(2, "0")}
              </strong>
              <div className="ranking-box">
                <BoxMark
                  box={state.boxes.find((b) => b.id === r.boxId)}
                  small
                />
                <span>
                  <strong>{r.name}</strong>
                  <small>
                    {r.district} · {r.dong}
                    {r.provisional ? " · 임시 등급" : ""}
                  </small>
                </span>
              </div>
              <span className="mono">{r.games}</span>
              <strong className="rating-value">{r.rating}</strong>
            </div>
          ))}
        </section>
      ) : (
        <Empty title="아직 이 부문의 순위가 없어요">
          <p>경기가 확정되면 순위를 확인할 수 있습니다.</p>
        </Empty>
      )}
      <p className="fine-print">
        개발용 Elo 1000 / K24 · 3경기 전 임시 등급 ·{" "}
        {updatedAt ? `${date(updatedAt)} 갱신` : "아직 집계 전"}. 공식 운영
        산식은 검토 중입니다.
      </p>
    </>
  );
}

export function Profile({
  settings,
  logout,
}: {
  settings: () => void;
  logout: () => Promise<void>;
}) {
  const { state, go, run } = usePilot();
  const [purchase, setPurchase] = useState(false);
  const box = state.boxes.find((b) => b.id === state.user.boxId);
  const entries = state.ledger.filter((l) => l.boxId === box?.id);
  const points = entries
    .filter((l) => l.kind === "points")
    .reduce((sum, l) => sum + l.amount, 0);
  const matches = state.matches.filter((m) =>
    Object.values(m.rosters).flat().includes(state.user.id),
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">YOUR JOURNEY</span>
          <h1>{state.user.name}님의 기록.</h1>
          <p>함께한 경기와 Box의 성취를 돌아보세요.</p>
        </div>
        <button className="secondary" onClick={settings}>
          <Settings2 size={18} /> 연결 설정
        </button>
      </div>
      <div className="profile-grid">
        <section className="panel profile-card">
          <BoxMark box={box} />
          <h2>{state.user.name}</h2>
          <p className="muted">{state.user.email}</p>
          <span className="tag">
            {state.user.role === "operator"
              ? "서비스 운영자"
              : box?.ownerId === state.user.id
                ? "Box 관리자 · 운동자"
                : "운동자"}
          </span>
          <button className="text-button" onClick={() => go("boxes")}>
            {box?.name || "소속 Box 찾기"} <ArrowUpRight size={17} />
          </button>
          {state.user.role === "operator" && (
            <button className="secondary" onClick={() => go("operations")}>
              <Shield size={18} /> 운영 관리
            </button>
          )}
        </section>
        <section className="panel wallet">
          <div className="section-label">
            <span>BOX ACTIVITY POINTS</span>
            <Coins size={20} />
          </div>
          <h2>
            {points.toLocaleString()}
            <small> P</small>
          </h2>
          <p className="muted">
            Box가 함께 쌓은 활동 포인트입니다.
            <br />
            포인트를 사용해도 경쟁 레이팅은 줄어들지 않아요.
          </p>
          {points < 0 && (
            <p className="error">
              경기 정정으로 보상이 회수되어 {Math.abs(points)}P의 미정산 잔액이
              있습니다. 잔액 회복 전에는 추가 소비할 수 없습니다.
            </p>
          )}
          <div className="decoration-product">
            <span className="decoration-icon">
              <Sparkles size={25} />
            </span>
            <div>
              <strong>챔피언 실드</strong>
              <p>Box 프로필에 빛나는 테두리를 더하세요.</p>
            </div>
            <button
              className="secondary"
              disabled={
                !box ||
                box.ownerId !== state.user.id ||
                box.decoration ||
                points < 30
              }
              onClick={() => setPurchase(true)}
            >
              {box?.decoration ? "사용 중" : "30 P"}
            </button>
          </div>
          <small className="muted">
            정상 경기 완료 시 Box별 20P · Box 관리자만 사용할 수 있어요.
          </small>
        </section>
      </div>
      <div className="section-heading">
        <h2>나의 출전 이력</h2>
        <span className="count">{matches.length}경기</span>
      </div>
      {matches.length ? (
        <div className="activity-list">
          {matches.map((m) => (
            <button key={m.id} onClick={() => go(`matches/${m.id}`)}>
              <Award size={23} />
              <div>
                <strong>{m.title}</strong>
                <p>
                  {formatLabel(m.format)} · {date(m.scheduledAt)}
                </p>
              </div>
              <span className={`status ${m.status}`}>
                {statusLabels[m.status]}
              </span>
              <ArrowUpRight size={18} />
            </button>
          ))}
        </div>
      ) : (
        <Empty title="첫 출전 기록을 기다리고 있어요">
          <p>경기 명단에 등록되면 이곳에서 확인할 수 있습니다.</p>
        </Empty>
      )}
      <div className="section-heading">
        <h2>Box 포인트 · 레이팅 내역</h2>
      </div>
      {entries.length ? (
        <div className="ledger-list">
          {entries
            .slice()
            .reverse()
            .map((l) => (
              <div key={l.id}>
                <span className="ledger-icon">
                  {l.kind === "points" ? (
                    <Coins size={19} />
                  ) : (
                    <Trophy size={19} />
                  )}
                </span>
                <div>
                  <strong>{l.reason}</strong>
                  <p>
                    {l.kind === "points"
                      ? "활동 포인트"
                      : `레이팅 ${l.format ? formatLabel(l.format) : ""} ${l.level || ""}`}{" "}
                    · {date(l.at)}
                  </p>
                </div>
                <span className={l.amount >= 0 ? "lime mono" : "orange mono"}>
                  {l.amount > 0 ? "+" : ""}
                  {l.amount}
                  {l.kind === "points" ? "P" : ""}
                </span>
              </div>
            ))}
        </div>
      ) : (
        <p className="muted">아직 적립·소비 내역이 없습니다.</p>
      )}
      <button
        className="text-button logout-button"
        onClick={() => void logout()}
      >
        <LogOut size={17} /> 로그아웃
      </button>
      {purchase && (
        <Modal title="챔피언 실드 사용" close={() => setPurchase(false)}>
          <p>
            Box 활동 포인트 30P를 사용해 프로필을 꾸밉니다. 한 번만 구매할 수
            있으며 경쟁 레이팅에는 영향이 없습니다.
          </p>
          <button
            className="primary"
            onClick={async () => {
              await run(
                `/boxes/${box!.id}/decorate`,
                {},
                "챔피언 실드를 적용했습니다.",
              );
              setPurchase(false);
            }}
          >
            30P 사용하기
          </button>
        </Modal>
      )}
    </>
  );
}

export function Operations() {
  const { state, mutate, toast, go } = usePilot();
  const [review, setReview] = useState<{
    type: "box" | "resolve" | "correct";
    id: string;
  } | null>(null);
  const pending = state.boxes.filter((b) => !b.operatorVerified);
  const matches = state.matches.filter((m) =>
    ["disputed", "review", "submitted", "live"].includes(m.status),
  );
  const match = state.matches.find((m) => m.id === review?.id);
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">KEEP THE GAME FAIR</span>
          <h1>운영 검토함.</h1>
          <p>
            확인 근거와 판정 이력을 남겨 주세요. 자신의 경기는 판정할 수
            없습니다.
          </p>
        </div>
        <Shield size={38} className="heading-icon" />
      </div>
      <div className="metrics-grid">
        {Object.entries(state.metrics ?? {}).map(([key, value]) => (
          <div className="panel" key={key}>
            <strong>{value}</strong>
            <span>
              {(
                {
                  users: "사용자",
                  boxes: "등록 Box",
                  activeBoxes: "활성 Box",
                  verifiedBoxes: "운영 확인 Box",
                  overdue: "검토 기한 경과",
                  videoBytes: "영상 저장량 (바이트)",
                  matches: "전체 경기",
                  finalized: "확정 경기",
                  disputed: "분쟁",
                  cancelled: "취소",
                  videos: "증빙 영상",
                  pendingBoxes: "확인 대기",
                  completedMatches: "확정 경기",
                  disputedMatches: "분쟁 경기",
                } as Record<string, string>
              )[key] || key}
            </span>
          </div>
        ))}
      </div>
      <div className="section-heading">
        <h2>Box 운영 권한 확인</h2>
        <span className="count">{pending.length}건</span>
      </div>
      {pending.length ? (
        <div className="operations-list">
          {pending.map((b) => (
            <div key={b.id}>
              <BoxMark box={b} small />
              <div>
                <h3>{b.name}</h3>
                <p>
                  {b.address} · 위치 {b.checks.length}/3
                </p>
              </div>
              <button
                className="secondary"
                onClick={() => setReview({ type: "box", id: b.id })}
              >
                근거 검토
              </button>
            </div>
          ))}
        </div>
      ) : (
        <Empty title="운영 확인 대기가 없습니다" />
      )}
      <div className="section-heading">
        <h2>분쟁 · 미응답 · 제출 검토</h2>
      </div>
      {matches.length ? (
        <div className="operations-list">
          {matches.map((m) => (
            <div key={m.id}>
              <Shield size={23} />
              <div>
                <button
                  className="text-button"
                  onClick={() => go(`matches/${m.id}`)}
                >
                  {m.title} <ArrowUpRight size={16} />
                </button>
                <p>
                  {statusLabels[m.status]} · 검토 {date(m.reviewBy)}
                </p>
              </div>
              <button
                className="secondary"
                onClick={() => setReview({ type: "resolve", id: m.id })}
              >
                판정
              </button>
            </div>
          ))}
        </div>
      ) : (
        <Empty title="현재 검토할 경기가 없습니다" />
      )}
      <div className="section-heading">
        <h2>확정 결과 정정</h2>
      </div>
      <div className="operations-list">
        {state.matches
          .filter((m) => ["finalized", "void"].includes(m.status))
          .map((m) => (
            <div key={m.id}>
              <div>
                <h3>{m.title}</h3>
                <p>{statusLabels[m.status]} · 원본과 정정 이력 보존</p>
              </div>
              <button
                className="secondary"
                onClick={() => setReview({ type: "correct", id: m.id })}
              >
                정정 검토
              </button>
            </div>
          ))}
      </div>
      {review && (
        <Modal
          title={
            review.type === "box"
              ? "운영 권한 확인"
              : review.type === "correct"
                ? "결과 정정"
                : "경기 판정"
          }
          close={() => setReview(null)}
        >
          <p className="muted">
            {review.type === "box"
              ? "GPS 참여는 운영 권한의 증명이 아닙니다. 별도 증빙을 확인하고 근거를 기록하세요."
              : "증빙 영상을 확인한 뒤 결정하세요. 정정 시 이후 레이팅과 보상도 다시 계산합니다."}
          </p>
          <Form
            label="근거와 결정 저장"
            onSubmit={async (data) => {
              const action = String(data.get("action") || "");
              const payload =
                review.type === "box"
                  ? { approved: true, reason: data.get("reason") }
                  : {
                      action,
                      reason: data.get("reason"),
                      ...(action === "result"
                        ? { winnerId: data.get("winnerId") || null }
                        : {}),
                    };
              await mutate(
                review.type === "box"
                  ? `/boxes/${review.id}/verify`
                  : `/matches/${review.id}/${review.type}`,
                payload,
              );
              setReview(null);
              toast("검토 근거와 결정을 저장했습니다.");
            }}
          >
            {review.type !== "box" && (
              <>
                <Field label="판정">
                  <select name="action">
                    <option value="void">무효 처리 · 점수와 보상 제외</option>
                    <option
                      value={review.type === "correct" ? "result" : "finalize"}
                    >
                      {review.type === "correct"
                        ? "승패 정정"
                        : "제출된 기록 기준 결과 확정"}
                    </option>
                  </select>
                </Field>
                {review.type === "correct" && match && (
                  <Field label="정정 승자 (승패 정정 선택 시)">
                    <select name="winnerId">
                      <option value="">무승부</option>
                      {[match.defenderId, match.challengerId]
                        .filter(Boolean)
                        .map((id) => (
                          <option key={id} value={id!}>
                            {state.boxes.find((b) => b.id === id)?.name}
                          </option>
                        ))}
                    </select>
                  </Field>
                )}
              </>
            )}
            <Field label="확인 근거 / 판정 사유">
              <textarea
                name="reason"
                required
                minLength={5}
                maxLength={1000}
                rows={4}
                placeholder="확인한 증빙과 결정 이유를 구체적으로 입력해 주세요."
              />
            </Field>
            <label className="check-label">
              <input type="checkbox" required />
              증빙을 확인했고, 결정이 기록과 원장에 반영됨을 확인했습니다.
            </label>
          </Form>
        </Modal>
      )}
    </>
  );
}
