import { randomUUID } from "node:crypto";

export const POLICY = {
  version: "pilot-v1",
  radiusMeters: 150,
  maxAccuracy: 100,
  checkAgeMinutes: 10,
  minimumMembers: 3,
  initialRating: 1000,
  k: 24,
  reward: 20,
  decorationCost: 30,
  dayTimezone: "Asia/Seoul",
  sessionHours: 24,
  maxVideoBytes: 100 * 1024 * 1024,
};
export const TEMPLATES = [
  {
    id: "sprint-rx",
    name: "SIEGE 90",
    version: 1,
    kind: "for-time",
    description:
      "3라운드: 에어 스쿼트 15회 · 버피 15회. 스쿼트는 고관절이 무릎 아래, 버피는 가슴 바닥 접촉 후 점프. 시작 신호부터 마지막 동작 종료까지.",
    movements: ["에어 스쿼트 15회 × 3", "버피 15회 × 3"],
    timeCap: 600,
    totalReps: 90,
    level: "Rx",
  },
  {
    id: "sprint-scaled",
    name: "SIEGE 60",
    version: 1,
    kind: "for-time",
    description:
      "3라운드: 에어 스쿼트 10회 · 스텝백 버피 10회. 스쿼트 고관절 무릎 아래, 버피 가슴 바닥 접촉 후 직립.",
    movements: ["에어 스쿼트 10회 × 3", "스텝백 버피 10회 × 3"],
    timeCap: 600,
    totalReps: 60,
    level: "Scaled",
  },
  {
    id: "engine-rx",
    name: "ENGINE 8",
    version: 1,
    kind: "amrap",
    description:
      "8분 동안 스쿼트 10회 · 푸시업 5회 반복. 스쿼트 고관절 무릎 아래, 푸시업 가슴 바닥 접촉 후 팔꿈치 완전 신전. 유효 반복 수 합계.",
    movements: ["에어 스쿼트 10회", "푸시업 5회"],
    timeCap: 480,
    totalReps: 15,
    level: "Rx",
  },
  {
    id: "engine-scaled",
    name: "ENGINE 8 S",
    version: 1,
    kind: "amrap",
    description:
      "8분 동안 스쿼트 10회 · 무릎 푸시업 5회 반복. 무릎 접지, 가슴 바닥 접촉 후 팔꿈치 완전 신전. 유효 반복 수 합계.",
    movements: ["에어 스쿼트 10회", "무릎 푸시업 5회"],
    timeCap: 480,
    totalReps: 15,
    level: "Scaled",
  },
];
export function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  throw error;
}
export function requireThat(value, status, message) {
  if (!value) fail(status, message);
}
export function string(value, label, max = 200, min = 1) {
  requireThat(
    typeof value === "string" &&
      value.trim().length >= min &&
      value.trim().length <= max,
    400,
    `${label} 입력을 확인해주세요.`,
  );
  return value.trim();
}
export function number(value, label, min, max, integer = false) {
  requireThat(
    typeof value === "number" &&
      Number.isFinite(value) &&
      value >= min &&
      value <= max &&
      (!integer || Number.isInteger(value)),
    400,
    `${label} 값이 올바르지 않습니다.`,
  );
  return value;
}
export function distance(lat1, lng1, lat2, lng2) {
  const rad = Math.PI / 180;
  const a =
    Math.sin(((lat2 - lat1) * rad) / 2) ** 2 +
    Math.cos(lat1 * rad) *
      Math.cos(lat2 * rad) *
      Math.sin(((lng2 - lng1) * rad) / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
export function compareRecords(template, a, b) {
  const score = (records) =>
    template.kind === "amrap"
      ? [records.reduce((v, r) => v + r.reps, 0)]
      : [
          records.filter((r) => r.completed).length,
          records.filter((r) => !r.completed).reduce((v, r) => v + r.reps, 0),
          -records
            .filter((r) => r.completed)
            .reduce((v, r) => v + r.seconds, 0),
        ];
  const x = score(a);
  const y = score(b);
  for (let i = 0; i < x.length; i++)
    if (x[i] !== y[i]) return x[i] > y[i] ? 1 : -1;
  return 0;
}
export function validateRecords(template, roster, records) {
  requireThat(
    Array.isArray(records) && records.length === roster.length,
    400,
    "잠긴 출전 명단 전원의 기록이 필요합니다.",
  );
  requireThat(
    new Set(records.map((r) => r?.userId)).size === roster.length &&
      records.every((r) => r && roster.includes(r.userId)),
    400,
    "기록의 선수와 잠긴 명단이 일치하지 않습니다.",
  );
  return roster.map((userId) => {
    const r = records.find((item) => item.userId === userId);
    requireThat(
      typeof r.completed === "boolean",
      400,
      "완료 여부를 입력해주세요.",
    );
    const seconds = number(r.seconds, "수행 시간", 0, template.timeCap);
    const reps = number(r.reps, "유효 반복 수", 0, 100000, true);
    const noReps = number(r.noReps, "무효 반복 수", 0, 100000, true);
    if (template.kind === "for-time")
      requireThat(
        r.completed
          ? reps === template.totalReps && seconds > 0
          : reps < template.totalReps && seconds === template.timeCap,
        400,
        "완료 시 전체 반복 수와 완료 시간을, 미완료 시 제한 시간과 미완료 반복 수를 입력해주세요.",
      );
    else
      requireThat(
        seconds === template.timeCap,
        400,
        "AMRAP 기록 시간은 WOD 제한 시간과 같아야 합니다.",
      );
    return {
      userId,
      completed: r.completed,
      seconds,
      reps,
      noReps,
      note: string(r.note ?? "", "판정 메모", 2000, 0),
      videoSecond: number(r.videoSecond ?? 0, "영상 시점", 0, 86400),
    };
  });
}
export function calculatedResult(match) {
  requireThat(
    match.submissions[match.defenderId] &&
      match.submissions[match.challengerId],
    409,
    "양측 기록이 있어야 승패를 판정할 수 있습니다.",
  );
  const order = compareRecords(
    match.template,
    match.submissions[match.defenderId].records,
    match.submissions[match.challengerId].records,
  );
  return {
    winnerId:
      order === 0 ? null : order > 0 ? match.defenderId : match.challengerId,
    reason:
      order === 0
        ? "동일 지표에 따른 무승부"
        : `${match.template.kind === "amrap" ? "유효 반복 수 합계" : "완료 인원·미완료 반복 수·완료 시간"} 비교`,
  };
}
export function event(match, user, type, at, detail = {}) {
  match.history.push({
    id: randomUUID(),
    by: user.id,
    type,
    at,
    ...structuredClone(detail),
  });
}
export function active(box) {
  box.active =
    box.members.length >= 3 &&
    box.checks.filter((c) => box.members.includes(c.userId)).length >= 3;
}
export function publicUser(u) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    boxId: u.boxId,
  };
}
export function publicBox(box, user) {
  const { checkCoordinates, verification, ...safe } = box;
  if (
    verification &&
    user &&
    (user.role === "operator" || box.ownerId === user.id)
  )
    safe.verification = verification;
  return structuredClone(safe);
}
export function participant(state, match, user) {
  return [match.defenderId, match.challengerId].some(
    (id) =>
      id &&
      (state.boxes[id]?.ownerId === user.id ||
        (match.rosters[id] || []).includes(user.id)),
  );
}
export function canSeeMatch(state, match, user) {
  return (
    match.status === "open" ||
    user.role === "operator" ||
    participant(state, match, user)
  );
}
export function visibleMatch(state, match, user) {
  const safe = structuredClone(match);
  safe.submissionBoxes = Object.keys(match.submissions);
  if (user.role !== "operator" && safe.submissionBoxes.length < 2)
    for (const boxId of safe.submissionBoxes)
      if (
        state.boxes[boxId]?.ownerId !== user.id &&
        !(match.rosters[boxId] || []).includes(user.id)
      )
        delete safe.submissions[boxId];
  // Audit metadata contains only post-reveal results, never hidden submissions.
  return safe;
}
const round = (n) => Math.round(n * 1000000) / 1000000;
export function recompute(state, at, reason, matchId) {
  const ratings = {};
  const games = {};
  const rewards = {};
  const used = new Set();
  const matches = Object.values(state.matches)
    .filter((m) => m.status === "finalized")
    .sort((a, b) => a.finalOrder - b.finalOrder);
  for (const m of matches) {
    const day = new Date(Date.parse(m.scheduledAt) + 9 * 3600000)
      .toISOString()
      .slice(0, 10);
    const pair = [m.defenderId, m.challengerId].sort().join(":") + ":" + day;
    m.rewardEligible = !used.has(pair);
    if (!m.rewardEligible) continue;
    used.add(pair);
    const division = `${m.format}:${m.level}`;
    const a = `${m.defenderId}:${division}`;
    const b = `${m.challengerId}:${division}`;
    const ra = ratings[a] ?? 1000;
    const rb = ratings[b] ?? 1000;
    const outcome =
      m.result.winnerId === null
        ? 0.5
        : m.result.winnerId === m.defenderId
          ? 1
          : 0;
    const delta = round(24 * (outcome - 1 / (1 + 10 ** ((rb - ra) / 400))));
    ratings[a] = round(ra + delta);
    ratings[b] = round(rb - delta);
    games[a] = (games[a] || 0) + 1;
    games[b] = (games[b] || 0) + 1;
    rewards[`${m.id}:${m.defenderId}`] = 20;
    rewards[`${m.id}:${m.challengerId}`] = 20;
  }
  // Append adjustments instead of deleting old ledger entries; correction history remains auditable.
  for (const key of new Set([
    ...Object.keys(state.ratings),
    ...Object.keys(ratings),
  ])) {
    const before = state.ratings[key] ?? 1000;
    const balance = ratings[key] ?? 1000;
    if (before !== balance) {
      const [boxId, format, level] = key.split(":");
      state.ledger.push({
        id: randomUUID(),
        boxId,
        ...(matchId ? { matchId } : {}),
        kind: "rating",
        format,
        level,
        amount: round(balance - before),
        balance,
        reason,
        at,
      });
    }
  }
  for (const key of new Set([
    ...Object.keys(state.rewards),
    ...Object.keys(rewards),
  ])) {
    const change = (rewards[key] || 0) - (state.rewards[key] || 0);
    if (change) {
      const [matchId, boxId] = key.split(":");
      const balance = (state.points[boxId] || 0) + change;
      state.points[boxId] = balance;
      state.ledger.push({
        id: randomUUID(),
        boxId,
        matchId,
        kind: "points",
        amount: change,
        balance,
        reason,
        at,
      });
    }
  }
  state.ratings = ratings;
  state.games = games;
  state.rewards = rewards;
}
