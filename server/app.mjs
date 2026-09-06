import express from "express";
import multer from "multer";
import { DatabaseSync } from "node:sqlite";
import {
  randomUUID,
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import {
  mkdirSync,
  openSync,
  readSync,
  closeSync,
  unlinkSync,
  existsSync,
} from "node:fs";
import { resolve, join } from "node:path";
import {
  POLICY,
  TEMPLATES,
  requireThat,
  fail,
  string,
  number,
  distance,
  active,
  publicUser,
  publicBox,
  participant,
  canSeeMatch,
  visibleMatch,
  validateRecords,
  calculatedResult,
  event,
  recompute,
} from "./domain.mjs";

const digest = (token) => createHash("sha256").update(token).digest("hex");
function passwordHash(password) {
  const salt = randomBytes(16).toString("hex");
  return salt + ":" + scryptSync(password, salt, 64).toString("hex");
}
function passwordMatches(password, stored) {
  const [salt, hash] = stored.split(":");
  return timingSafeEqual(
    scryptSync(password, salt, 64),
    Buffer.from(hash, "hex"),
  );
}
const EMPTY = () => ({
  users: {},
  boxes: {},
  matches: {},
  videos: {},
  sessions: {},
  joins: [],
  ledger: [],
  notifications: [],
  ratings: {},
  games: {},
  rewards: {},
  points: {},
  nextFinalOrder: 1,
});

export function createApp({
  dataDir = "data",
  clock = () => new Date(),
  operatorEmail,
  operatorPassword,
  allowedOrigins = [
    "https://localhost",
    "http://localhost",
    "http://127.0.0.1:5173",
    "http://localhost:5173",
    "http://127.0.0.1:4173",
  ],
  trustProxy = false,
} = {}) {
  const directory = resolve(dataDir);
  const uploadDir = join(directory, "uploads");
  mkdirSync(uploadDir, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(join(directory, "wodsiege.sqlite"));
  db.exec(
    "PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL)",
  );
  const load = db.prepare("SELECT data FROM state WHERE id=1");
  const save = db.prepare(
    "INSERT INTO state(id,data) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
  );
  if (!load.get()) save.run(JSON.stringify(EMPTY()));
  const now = () => {
    const value = clock();
    return value instanceof Date ? value : new Date(value);
  };
  const transact = (work) => {
    db.exec("BEGIN IMMEDIATE");
    try {
      const s = JSON.parse(load.get().data);
      const result = work(s);
      save.run(JSON.stringify(s));
      db.exec("COMMIT");
      return result;
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  };
  const read = () => JSON.parse(load.get().data);
  const email = (value) => {
    const v = string(value, "이메일", 254).toLowerCase();
    requireThat(
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
      400,
      "이메일 형식을 확인해주세요.",
    );
    return v;
  };
  const password = (value) => string(value, "비밀번호 (10자 이상)", 200, 10);
  if (operatorEmail || operatorPassword) {
    requireThat(
      operatorEmail && operatorPassword,
      400,
      "운영자 이메일과 비밀번호를 모두 설정해주세요.",
    );
    const mail = email(operatorEmail);
    const secret = password(operatorPassword);
    transact((s) => {
      const existing = Object.values(s.users).find((u) => u.email === mail);
      requireThat(
        !existing || existing.role === "operator",
        409,
        "동일 이메일의 일반 사용자가 있습니다. 운영자 권한을 자동으로 변경하지 않습니다.",
      );
      if (!existing) {
        const id = randomUUID();
        s.users[id] = {
          id,
          name: "파일럿 운영자",
          email: mail,
          hash: passwordHash(secret),
          role: "operator",
          boxId: null,
        };
      }
    });
  }
  const app = express();
  app.disable("x-powered-by");
  // Production uses exactly one private ingress proxy; direct development
  // requests must not trust user-supplied forwarding headers.
  if (trustProxy !== false) app.set("trust proxy", trustProxy);
  const allowedOriginSet = new Set(allowedOrigins);
  app.use((req, res, next) => {
    res.set("X-Content-Type-Options", "nosniff");
    res.set("Cache-Control", "no-store");
    res.vary("Origin");
    const origin = req.get("Origin");
    requireThat(
      !origin || allowedOriginSet.has(origin),
      403,
      "허용되지 않은 앱 또는 웹 출처입니다.",
    );
    if (origin) {
      res.set("Access-Control-Allow-Origin", origin);
      res.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
      res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    }
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });
  app.use(express.json({ limit: "256kb" }));
  app.use((req, _res, next) => {
    if (req.method === "POST" && !req.is("multipart/form-data")) {
      requireThat(
        req.body && typeof req.body === "object" && !Array.isArray(req.body),
        400,
        "JSON 객체를 입력해주세요.",
      );
    }
    next();
  });
  app.use((req, _res, next) => {
    req.body ??= {};
    requireThat(
      typeof req.body === "object" && !Array.isArray(req.body),
      400,
      "JSON 객체를 입력해주세요.",
    );
    next();
  });
  app.get("/api/health", (_req, res) => res.json({ ok: true, mode: "pilot" }));
  const attempts = new Map();
  const authLimit = (req, _res, next) => {
    const key = req.ip;
    const time = now().getTime();
    const item = attempts.get(key) || { since: time, count: 0 };
    if (time - item.since > 60000) {
      item.since = time;
      item.count = 0;
    }
    item.count++;
    attempts.set(key, item);
    if (attempts.size > 10000) attempts.clear();
    requireThat(
      item.count <= 60,
      429,
      "로그인 시도가 많습니다. 잠시 후 다시 시도해주세요.",
    );
    next();
  };
  const issue = (s, user) => {
    const token = randomBytes(32).toString("hex");
    const time = now().getTime();
    for (const [id, session] of Object.entries(s.sessions))
      if (session.expires <= time) delete s.sessions[id];
    s.sessions[digest(token)] = {
      userId: user.id,
      expires: time + POLICY.sessionHours * 3600000,
    };
    return { token, user: publicUser(user) };
  };
  app.post("/api/auth/register", authLimit, (req, res) =>
    res.status(201).json(
      transact((s) => {
        const name = string(req.body.name, "이름", 60);
        const mail = email(req.body.email);
        const secret = password(req.body.password);
        requireThat(
          !Object.values(s.users).some((u) => u.email === mail),
          409,
          "이미 가입한 이메일입니다.",
        );
        const id = randomUUID();
        const u = {
          id,
          name,
          email: mail,
          hash: passwordHash(secret),
          role: "athlete",
          boxId: null,
        };
        s.users[id] = u;
        return issue(s, u);
      }),
    ),
  );
  app.post("/api/auth/login", authLimit, (req, res) =>
    res.json(
      transact((s) => {
        const mail = email(req.body.email);
        const secret = password(req.body.password);
        const u = Object.values(s.users).find((u) => u.email === mail);
        requireThat(
          u && passwordMatches(secret, u.hash),
          401,
          "이메일 또는 비밀번호를 확인해주세요.",
        );
        return issue(s, u);
      }),
    ),
  );
  app.use("/api", (req, _res, next) => {
    const raw = req.get("Authorization") || "";
    requireThat(/^Bearer [a-f0-9]{64}$/.test(raw), 401, "로그인이 필요합니다.");
    const token = digest(raw.slice(7));
    const s = read();
    const session = s.sessions[token];
    requireThat(
      session && session.expires > now().getTime() && s.users[session.userId],
      401,
      "로그인이 만료되었습니다. 다시 로그인해주세요.",
    );
    req.userId = session.userId;
    req.sessionId = token;
    next();
  });
  app.post("/api/auth/logout", (req, res) => {
    transact((s) => delete s.sessions[req.sessionId]);
    res.json({ ok: true });
  });
  const boxById = (s, id) => {
    requireThat(s.boxes[id], 404, "Box를 찾을 수 없습니다.");
    return s.boxes[id];
  };
  const matchById = (s, id) => {
    requireThat(s.matches[id], 404, "경기를 찾을 수 없습니다.");
    return s.matches[id];
  };
  const owner = (s, id, u) => {
    const b = boxById(s, id);
    requireThat(b.ownerId === u.id, 403, "Box 관리자만 처리할 수 있습니다.");
    return b;
  };
  const eligible = (b) =>
    requireThat(
      b.active && b.operatorVerified,
      409,
      "구성원 3명 위치 확인과 운영 승인을 완료한 Box만 공식전에 참가할 수 있습니다.",
    );
  const ownSide = (s, m, u) => {
    const id = [m.defenderId, m.challengerId].find(
      (id) => id && s.boxes[id]?.ownerId === u.id,
    );
    requireThat(id, 403, "경기에 참가한 Box 관리자만 처리할 수 있습니다.");
    return id;
  };
  const independent = (s, m, u) => {
    requireThat(u.role === "operator", 403, "서비스 운영자 권한이 필요합니다.");
    requireThat(
      !participant(s, m, u) &&
        ![m.defenderId, m.challengerId].includes(u.boxId),
      403,
      "자기 출전 또는 소속 경기는 판정할 수 없습니다.",
    );
  };
  const notify = (s, boxIds, title, body, matchId) => {
    for (const boxId of boxIds.filter(Boolean))
      s.notifications.push({
        id: randomUUID(),
        boxId,
        title,
        body,
        ...(matchId ? { matchId } : {}),
        at: now().toISOString(),
      });
  };
  const act = (path, fn) =>
    app.post("/api" + path, (req, res) =>
      res.json(
        transact((s) =>
          fn(s, s.users[req.userId], req.body || {}, req.params, req),
        ),
      ),
    );
  const matchAct = (path, fn) =>
    act("/matches/:id/" + path, (s, u, b, p) => {
      const m = matchById(s, p.id);
      fn(s, u, b, m);
      return visibleMatch(s, m, u);
    });

  app.get("/api/state", (req, res) => {
    const s = read();
    const u = s.users[req.userId];
    const op = u.role === "operator";
    const time = now().getTime();
    const matches = Object.values(s.matches).filter((m) =>
      canSeeMatch(s, m, u),
    );
    const notifications = s.notifications
      .filter((n) => op || n.boxId === u.boxId)
      .slice(-100);
    for (const m of matches)
      if (
        participant(s, m, u) &&
        !["finalized", "void", "cancelled", "open"].includes(m.status)
      )
        notifications.push({
          id: "deadline-" + m.id,
          title:
            time > Date.parse(m.submitBy)
              ? "제출 기한 경과 · 검토 확인"
              : "경기 제출 안내",
          body: `제출 ${m.submitBy} · 검토 ${m.reviewBy}`,
          matchId: m.id,
        });
    const all = Object.values(s.matches);
    const boxes = Object.values(s.boxes);
    const metrics = op
      ? {
          boxes: boxes.length,
          activeBoxes: boxes.filter((b) => b.active).length,
          verifiedBoxes: boxes.filter((b) => b.operatorVerified).length,
          matches: all.length,
          finalized: all.filter((m) => m.status === "finalized").length,
          disputed: all.filter((m) => m.status === "disputed").length,
          cancelled: all.filter((m) => m.status === "cancelled").length,
          overdue: all.filter(
            (m) =>
              time > Date.parse(m.reviewBy) &&
              !["finalized", "cancelled", "void"].includes(m.status),
          ).length,
          videoBytes: Object.values(s.videos).reduce((n, v) => n + v.size, 0),
        }
      : null;
    res.json({
      user: publicUser(u),
      users: Object.values(s.users).map(({ id, name, boxId, role }) => ({
        id,
        name,
        boxId,
        role,
      })),
      boxes: boxes.map((b) => publicBox(b, u)),
      templates: TEMPLATES,
      matches: matches.map((m) => visibleMatch(s, m, u)),
      ledger: s.ledger.filter((l) => op || l.boxId === u.boxId),
      notifications,
      joinRequests: s.joins.filter(
        (j) => op || j.userId === u.id || s.boxes[j.boxId]?.ownerId === u.id,
      ),
      policy: POLICY,
      updatedAt: now().toISOString(),
      metrics,
    });
  });
  act("/boxes", (s, u, b) => {
    requireThat(!u.boxId, 409, "이미 주 소속 Box가 있습니다.");
    const id = randomUUID();
    const name = string(b.name, "Box 이름", 80);
    const address = string(b.address, "주소", 200);
    requireThat(
      !Object.values(s.boxes).some(
        (x) =>
          x.name.toLowerCase() === name.toLowerCase() &&
          x.address.toLowerCase() === address.toLowerCase(),
      ),
      409,
      "같은 이름과 주소의 Box가 있습니다. 기존 Box 가입을 신청해주세요.",
    );
    const box = {
      id,
      name,
      address,
      dong: string(b.dong, "동", 60),
      district: string(b.district, "지역구", 60),
      lat: number(b.lat, "위도", -90, 90),
      lng: number(b.lng, "경도", -180, 180),
      description: string(b.description ?? "", "소개", 2000, 0),
      ownerId: u.id,
      members: [u.id],
      checks: [],
      checkCoordinates: {},
      operatorVerified: false,
      active: false,
      decoration: false,
    };
    s.boxes[id] = box;
    u.boxId = id;
    return publicBox(box);
  });
  act("/boxes/:id/join", (s, u, _b, p) => {
    const box = boxById(s, p.id);
    requireThat(u.boxId !== box.id, 409, "이미 소속된 Box입니다.");
    requireThat(
      !Object.values(s.boxes).some((x) => x.ownerId === u.id),
      409,
      "Box 관리자는 소속 이전 전에 관리 권한 이전 절차가 필요합니다. 파일럿에서 운영자에게 문의해주세요.",
    );
    const previous = s.joins.find(
      (j) => j.userId === u.id && j.boxId === box.id && j.status === "pending",
    );
    if (previous) return previous;
    const request = {
      id: randomUUID(),
      userId: u.id,
      boxId: box.id,
      status: "pending",
    };
    s.joins.push(request);
    notify(
      s,
      [box.id],
      "소속 가입 신청",
      `${u.name} 님의 가입 신청을 확인해주세요.`,
    );
    return request;
  });
  act("/boxes/:id/approve-member", (s, u, b, p) => {
    const box = owner(s, p.id, u);
    const joining = s.users[b.userId];
    const request = s.joins.find(
      (j) =>
        j.boxId === box.id && j.userId === b.userId && j.status === "pending",
    );
    requireThat(joining && request, 409, "대기 중인 가입 신청이 없습니다.");
    requireThat(
      !Object.values(s.boxes).some((x) => x.ownerId === joining.id),
      409,
      "Box 관리자는 소속을 이전할 수 없습니다.",
    );
    if (joining.boxId) {
      const old = s.boxes[joining.boxId];
      old.members = old.members.filter((id) => id !== joining.id);
      old.checks = old.checks.filter((c) => c.userId !== joining.id);
      delete old.checkCoordinates[joining.id];
      active(old);
    }
    joining.boxId = box.id;
    box.members.push(joining.id);
    active(box);
    request.status = "approved";
    for (const other of s.joins)
      if (
        other !== request &&
        other.userId === joining.id &&
        other.status === "pending"
      )
        other.status = "superseded";
    return publicBox(box);
  });
  act("/boxes/:id/check-in", (s, u, b, p) => {
    const box = boxById(s, p.id);
    requireThat(
      u.boxId === box.id && box.members.includes(u.id),
      403,
      "승인된 주 소속 구성원만 위치를 확인할 수 있습니다.",
    );
    requireThat(b.consent === true, 400, "위치 확인 동의가 필요합니다.");
    const lat = number(b.lat, "위도", -90, 90);
    const lng = number(b.lng, "경도", -180, 180);
    number(b.accuracy, "위치 정확도", 0, 100);
    const measuredAt =
      typeof b.timestamp === "number" ? b.timestamp : Date.parse(b.timestamp);
    const age = now().getTime() - measuredAt;
    requireThat(
      Number.isFinite(age) && age >= 0 && age <= 600000,
      400,
      "최근 10분 이내의 위치가 필요하며 미래 시각은 사용할 수 없습니다.",
    );
    requireThat(
      distance(lat, lng, box.lat, box.lng) <= 150,
      400,
      "Box 중심 150m 이내에서 위치를 다시 확인해주세요.",
    );
    if (!box.checks.some((c) => c.userId === u.id))
      box.checks.push({ userId: u.id, at: now().toISOString() });
    box.checkCoordinates[u.id] = { lat, lng, accuracy: b.accuracy, measuredAt };
    active(box);
    return publicBox(box);
  });
  act("/boxes/:id/verify", (s, u, b, p) => {
    requireThat(u.role === "operator", 403, "서비스 운영자 권한이 필요합니다.");
    const box = boxById(s, p.id);
    const reason = string(b.reason, "운영 승인 근거", 2000);
    requireThat(
      typeof b.approved === "boolean",
      400,
      "승인 여부를 입력해주세요.",
    );
    requireThat(
      box.ownerId !== u.id && u.boxId !== box.id,
      403,
      "본인 소속 Box의 운영 승인은 다른 운영자가 처리해야 합니다.",
    );
    box.operatorVerified = b.approved;
    box.verification = { by: u.id, reason, at: now().toISOString() };
    notify(
      s,
      [box.id],
      b.approved ? "Box 운영 승인" : "Box 운영 승인 보류",
      reason,
    );
    return publicBox(box);
  });
  act("/boxes/:id/decorate", (s, u, _b, p) => {
    const box = owner(s, p.id, u);
    requireThat(!box.decoration, 409, "이미 프로필 꾸미기를 적용했습니다.");
    const balance = s.points[box.id] || 0;
    requireThat(
      balance >= 30,
      409,
      "사용 가능한 포인트가 부족합니다. 30P가 필요합니다.",
    );
    box.decoration = true;
    s.points[box.id] = balance - 30;
    s.ledger.push({
      id: randomUUID(),
      boxId: box.id,
      kind: "points",
      amount: -30,
      balance: balance - 30,
      reason: "Box 프로필 꾸미기",
      at: now().toISOString(),
    });
    return publicBox(box);
  });
  act("/matches", (s, u, b) => {
    const box = owner(s, u.boxId, u);
    eligible(box);
    const template = TEMPLATES.find((t) => t.id === b.templateId);
    requireThat(template, 400, "지원하는 WOD 템플릿을 선택해주세요.");
    requireThat(
      ["individual", "team3"].includes(b.format),
      400,
      "개인전 또는 3인 팀전을 선택해주세요.",
    );
    requireThat(
      ["together", "separate"].includes(b.venue),
      400,
      "개최 방식을 선택해주세요.",
    );
    const time = Date.parse(b.scheduledAt);
    requireThat(
      Number.isFinite(time) &&
        time >= now().getTime() &&
        time < now().getTime() + 366 * 86400000,
      400,
      "경기 일정은 현재부터 1년 이내여야 합니다.",
    );
    const id = randomUUID();
    const m = {
      id,
      title: string(b.title, "경기 이름", 120),
      defenderId: box.id,
      challengerId: null,
      template: structuredClone(template),
      format: b.format,
      level: template.level,
      venue: b.venue,
      location: string(b.location, "경기 장소", 300),
      scheduledAt: new Date(time).toISOString(),
      submitBy: new Date(time + 86400000).toISOString(),
      reviewBy: new Date(time + 172800000).toISOString(),
      status: "open",
      rosters: {},
      agreements: [],
      submissions: {},
      reviews: [],
      history: [],
      createdAt: now().toISOString(),
    };
    event(m, u, "created", now().toISOString());
    s.matches[id] = m;
    return visibleMatch(s, m, u);
  });
  matchAct("apply", (s, u, _b, m) => {
    requireThat(
      m.status === "open" && now().getTime() <= Date.parse(m.scheduledAt),
      409,
      "신청 가능한 도전장이 아닙니다.",
    );
    const box = owner(s, u.boxId, u);
    eligible(box);
    requireThat(box.id !== m.defenderId, 409, "자기 Box에 도전할 수 없습니다.");
    m.challengerId = box.id;
    m.status = "applied";
    event(m, u, "applied", now().toISOString());
    notify(s, [m.defenderId], "새로운 도전 신청", m.title, m.id);
  });
  matchAct("accept", (s, u, _b, m) => {
    owner(s, m.defenderId, u);
    requireThat(
      m.status === "applied" &&
        !m.acceptedAt &&
        now().getTime() <= Date.parse(m.scheduledAt),
      409,
      "수락할 수 있는 신청이 아닙니다.",
    );
    eligible(s.boxes[m.defenderId]);
    eligible(s.boxes[m.challengerId]);
    m.acceptedAt = now().toISOString();
    event(m, u, "accepted", now().toISOString());
    notify(
      s,
      [m.challengerId],
      "도전 수락",
      "양측 출전 명단을 합의해주세요.",
      m.id,
    );
  });
  matchAct("agree", (s, u, b, m) => {
    const side = ownSide(s, m, u);
    requireThat(
      m.status === "applied" &&
        m.acceptedAt &&
        now().getTime() <= Date.parse(m.scheduledAt),
      409,
      "수락 후 경기 시작 시각 전에 명단을 합의해주세요.",
    );
    eligible(s.boxes[m.defenderId]);
    eligible(s.boxes[m.challengerId]);
    const count = m.format === "team3" ? 3 : 1;
    requireThat(
      Array.isArray(b.roster) &&
        b.roster.length === count &&
        new Set(b.roster).size === count &&
        b.roster.every((id) => s.users[id]?.boxId === side),
      400,
      `현재 소속 선수 ${count}명을 중복 없이 선택해주세요.`,
    );
    requireThat(
      !m.agreements.includes(side),
      409,
      "이미 동의한 명단은 변경할 수 없습니다.",
    );
    m.rosters[side] = [...b.roster];
    m.agreements.push(side);
    event(m, u, "agreed", now().toISOString(), {
      boxId: side,
      roster: b.roster,
    });
    if (m.agreements.length === 2) {
      for (const id of [m.defenderId, m.challengerId])
        requireThat(
          m.rosters[id].every((uid) => s.users[uid]?.boxId === id),
          409,
          "합의 중 소속이 변경된 선수가 있습니다. 경기를 취소하고 다시 합의해주세요.",
        );
      m.status = "locked";
      m.lockedAt = now().toISOString();
      m.membershipSnapshot = Object.fromEntries(
        Object.entries(m.rosters).map(([id, ids]) => [
          id,
          ids.map((userId) => ({
            userId,
            name: s.users[userId].name,
            boxId: id,
          })),
        ]),
      );
      notify(
        s,
        [m.defenderId, m.challengerId],
        "경기 조건 확정",
        m.title,
        m.id,
      );
    }
  });
  matchAct("start", (s, u, _b, m) => {
    ownSide(s, m, u);
    requireThat(
      m.status === "locked",
      409,
      "양측 명단 합의가 완료된 경기만 시작할 수 있습니다.",
    );
    requireThat(
      now().getTime() >= Date.parse(m.scheduledAt) &&
        now().getTime() <= Date.parse(m.submitBy),
      409,
      "경기 시작 시각과 제출 기한을 확인해주세요.",
    );
    m.status = "live";
    event(m, u, "started", now().toISOString());
  });
  matchAct("cancel", (s, u, b, m) => {
    ownSide(s, m, u);
    requireThat(
      ["open", "applied", "locked"].includes(m.status),
      409,
      "이미 시작했거나 판정 중인 경기는 취소할 수 없습니다. 운영자 무효 판정을 요청해주세요.",
    );
    m.status = "cancelled";
    event(m, u, "cancelled", now().toISOString(), {
      reason: string(b.reason, "취소 사유", 2000),
    });
    notify(s, [m.defenderId, m.challengerId], "경기 취소", m.title, m.id);
  });

  const upload = multer({
    storage: multer.diskStorage({
      destination: uploadDir,
      filename: (_req, _file, cb) => cb(null, randomUUID()),
    }),
    limits: {
      fileSize: POLICY.maxVideoBytes,
      files: 1,
      fields: 2,
      fieldSize: 200,
    },
  });
  app.post(
    "/api/matches/:id/video",
    (req, _res, next) => {
      const s = read();
      const m = matchById(s, req.params.id);
      const u = s.users[req.userId];
      requireThat(
        participant(s, m, u),
        403,
        "출전 선수 또는 해당 Box 관리자만 영상을 등록할 수 있습니다.",
      );
      requireThat(
        ["live", "submitted"].includes(m.status) &&
          now().getTime() <= Date.parse(m.submitBy),
        409,
        "현재 영상 제출 기간이 아닙니다.",
      );
      next();
    },
    upload.single("video"),
    (req, res) => {
      try {
        requireThat(req.file, 400, "영상 파일을 선택해주세요.");
        requireThat(
          req.body.consent === "true",
          400,
          "영상 촬영·제출 동의가 필요합니다.",
        );
        const header = Buffer.alloc(12);
        const fd = openSync(req.file.path, "r");
        try {
          readSync(fd, header, 0, 12, 0);
        } finally {
          closeSync(fd);
        }
        const mp4 =
          req.file.mimetype === "video/mp4" &&
          header.subarray(4, 8).toString() === "ftyp";
        const webm =
          req.file.mimetype === "video/webm" &&
          header.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
        requireThat(
          req.file.size >= 12 && (mp4 || webm),
          400,
          "유효한 MP4 또는 WebM 영상 파일만 등록할 수 있습니다.",
        );
        const result = transact((s) => {
          const m = matchById(s, req.params.id);
          const u = s.users[req.userId];
          requireThat(
            ["live", "submitted"].includes(m.status) &&
              now().getTime() <= Date.parse(m.submitBy),
            409,
            "영상 제출 기한이 지났습니다.",
          );
          const boxId = [m.defenderId, m.challengerId].find(
            (id) =>
              s.boxes[id]?.ownerId === u.id ||
              (m.rosters[id] || []).includes(u.id),
          );
          requireThat(boxId, 403, "영상 제출 권한이 없습니다.");
          requireThat(
            !m.submissions[boxId],
            409,
            "이미 제출된 기록의 영상은 변경할 수 없습니다.",
          );
          const videoId = req.file.filename;
          s.videos[videoId] = {
            id: videoId,
            matchId: m.id,
            boxId,
            userId: u.id,
            mime: req.file.mimetype,
            size: req.file.size,
            at: now().toISOString(),
            consentAt: now().toISOString(),
          };
          return { videoId };
        });
        res.status(201).json(result);
      } catch (e) {
        if (req.file && existsSync(req.file.path)) unlinkSync(req.file.path);
        throw e;
      }
    },
  );
  app.get("/api/videos/:id", (req, res) => {
    const s = read();
    const v = s.videos[req.params.id];
    requireThat(v, 404, "영상을 찾을 수 없습니다.");
    const m = s.matches[v.matchId];
    const u = s.users[req.userId];
    requireThat(
      u.role === "operator" || participant(s, m, u),
      403,
      "영상 열람 권한이 없습니다.",
    );
    const sameSide =
      s.boxes[v.boxId]?.ownerId === u.id ||
      (m.rosters[v.boxId] || []).includes(u.id);
    requireThat(
      u.role === "operator" ||
        sameSide ||
        (Object.keys(m.submissions).length === 2 &&
          m.submissions[v.boxId]?.videoId === v.id),
      403,
      "양측 제출이 완료되어야 제출된 상대 영상을 확인할 수 있습니다.",
    );
    res.type(v.mime);
    res.set("Content-Disposition", "inline");
    res.sendFile(join(uploadDir, v.id), { cacheControl: false });
  });
  matchAct("submit", (s, u, b, m) => {
    const side = ownSide(s, m, u);
    const video = s.videos[b.videoId];
    requireThat(
      video && video.matchId === m.id && video.boxId === side,
      400,
      "이 경기의 자기 Box 영상이 필요합니다.",
    );
    const records = validateRecords(
      m.template,
      m.rosters[side] || [],
      b.records,
    );
    requireThat(records.length > 0, 409, "잠긴 명단이 필요합니다.");
    if (m.submissions[side]) {
      requireThat(
        m.submissions[side].videoId === b.videoId &&
          JSON.stringify(m.submissions[side].records) ===
            JSON.stringify(records),
        409,
        "제출된 기록은 덮어쓸 수 없습니다.",
      );
      return;
    }
    requireThat(
      ["live", "submitted"].includes(m.status) &&
        now().getTime() <= Date.parse(m.submitBy),
      409,
      "기록 제출 상태 또는 기한을 확인해주세요.",
    );
    m.submissions[side] = {
      videoId: b.videoId,
      records,
      submittedAt: now().toISOString(),
    };
    m.status = Object.keys(m.submissions).length === 2 ? "review" : "submitted";
    event(m, u, "submitted", now().toISOString(), { boxId: side });
    notify(
      s,
      [m.defenderId, m.challengerId],
      m.status === "review" ? "양측 제출 완료 · 상호 검토" : "기록 제출 완료",
      m.title,
      m.id,
    );
  });
  matchAct("review", (s, u, b, m) => {
    const side = ownSide(s, m, u);
    requireThat(
      m.status === "review",
      409,
      "양측 제출이 완료된 검토 중 경기만 처리할 수 있습니다.",
    );
    requireThat(
      now().getTime() <= Date.parse(m.reviewBy),
      409,
      "검토 기한이 지났습니다. 운영자 판정을 요청해주세요.",
    );
    requireThat(
      typeof b.approved === "boolean",
      400,
      "검토 결과를 선택해주세요.",
    );
    if (!b.approved) {
      m.status = "disputed";
      m.dispute = {
        reason: string(b.reason, "이의 사유", 2000),
        by: u.id,
        at: now().toISOString(),
      };
      event(m, u, "disputed", now().toISOString(), {
        reason: m.dispute.reason,
      });
    } else if (!m.reviews.includes(side)) {
      m.reviews.push(side);
      event(m, u, "reviewed-opponent", now().toISOString(), { boxId: side });
    }
    notify(
      s,
      [m.defenderId, m.challengerId],
      m.status === "disputed" ? "이의 제기 · 판정 보류" : "상대 기록 검토 완료",
      m.title,
      m.id,
    );
  });
  const finish = (s, u, m, result, reason) => {
    m.status = "finalized";
    m.result = result;
    m.finalizedAt = now().toISOString();
    m.finalOrder ??= s.nextFinalOrder++;
    event(m, u, "finalized", now().toISOString(), { result, reason });
    recompute(s, now().toISOString(), reason, m.id);
    notify(
      s,
      [m.defenderId, m.challengerId],
      "경기 결과 확정",
      result.reason,
      m.id,
    );
  };
  matchAct("finalize", (s, u, _b, m) => {
    ownSide(s, m, u);
    if (m.status === "finalized") return;
    requireThat(
      m.status === "review" && m.reviews.length === 2,
      409,
      "양측의 상대 기록 검토가 모두 필요합니다.",
    );
    requireThat(
      now().getTime() >= Date.parse(m.reviewBy),
      409,
      "이의 제기 기간 종료 후 확정할 수 있습니다.",
    );
    finish(s, u, m, calculatedResult(m), "양측 검토 및 이의 기간 종료");
  });
  matchAct("resolve", (s, u, b, m) => {
    independent(s, m, u);
    const reason = string(b.reason, "판정 근거", 2000);
    requireThat(
      ["finalize", "void"].includes(b.action),
      400,
      "확정 또는 무효를 선택해주세요.",
    );
    requireThat(
      !["finalized", "void", "cancelled", "open"].includes(m.status),
      409,
      "운영 판정 가능한 경기가 아닙니다.",
    );
    requireThat(
      m.status === "disputed" || now().getTime() >= Date.parse(m.reviewBy),
      409,
      "분쟁 또는 검토 기한이 경과한 경기에만 운영 판정할 수 있습니다.",
    );
    if (b.action === "finalize")
      finish(s, u, m, { ...calculatedResult(m), reason }, reason);
    else {
      m.status = "void";
      m.result = { winnerId: null, reason };
      event(m, u, "voided", now().toISOString(), { reason });
      notify(s, [m.defenderId, m.challengerId], "경기 무효", reason, m.id);
    }
  });
  matchAct("correct", (s, u, b, m) => {
    independent(s, m, u);
    const reason = string(b.reason, "정정 근거", 2000);
    requireThat(
      ["finalized", "void"].includes(m.status),
      409,
      "확정 또는 무효 경기만 정정할 수 있습니다.",
    );
    requireThat(
      ["void", "result"].includes(b.action),
      400,
      "정정 유형을 선택해주세요.",
    );
    if (b.action === "result") {
      requireThat(
        b.winnerId === null ||
          [m.defenderId, m.challengerId].includes(b.winnerId),
        400,
        "양측 Box 또는 무승부를 선택해주세요.",
      );
      requireThat(
        Object.keys(m.submissions).length === 2,
        409,
        "양측 증거가 없는 경기는 정상 결과로 정정할 수 없습니다.",
      );
    }
    const result = {
      winnerId: b.action === "void" ? null : b.winnerId,
      reason,
    };
    const status = b.action === "void" ? "void" : "finalized";
    if (
      m.status === status &&
      m.result?.winnerId === result.winnerId &&
      m.result?.reason === reason
    )
      return;
    event(m, u, "corrected", now().toISOString(), {
      previous: {
        status: m.status,
        result: m.result,
        finalizedAt: m.finalizedAt,
      },
      result,
      reason,
    });
    m.status = status;
    m.result = result;
    if (status === "finalized") {
      m.finalOrder ??= s.nextFinalOrder++;
      m.finalizedAt ??= now().toISOString();
    }
    recompute(s, now().toISOString(), `결과 정정: ${reason}`, m.id);
    notify(s, [m.defenderId, m.challengerId], "경기 결과 정정", reason, m.id);
  });
  app.get("/api/rankings", (req, res) => {
    const s = read();
    const format = req.query.format || "individual";
    const level = req.query.level || "Rx";
    requireThat(
      ["individual", "team3"].includes(format) &&
        ["Rx", "Scaled"].includes(level),
      400,
      "순위 부문을 확인해주세요.",
    );
    const rows = Object.values(s.boxes)
      .filter(
        (b) =>
          b.operatorVerified &&
          (!req.query.district || b.district === req.query.district) &&
          (!req.query.dong || b.dong === req.query.dong),
      )
      .map((b) => {
        const key = `${b.id}:${format}:${level}`;
        const games = s.games[key] || 0;
        return {
          boxId: b.id,
          name: b.name,
          rating: Math.round((s.ratings[key] ?? 1000) * 100) / 100,
          games,
          rank: 0,
          provisional: games < 3,
          dong: b.dong,
          district: b.district,
        };
      })
      .sort(
        (a, b) => b.rating - a.rating || a.name.localeCompare(b.name, "ko"),
      );
    rows.forEach(
      (r, i) =>
        (r.rank =
          i && rows[i - 1].rating === r.rating ? rows[i - 1].rank : i + 1),
    );
    res.json({ rankings: rows, updatedAt: now().toISOString() });
  });
  app.use("/api", (_req, _res) => fail(404, "요청한 API를 찾을 수 없습니다."));
  app.use((error, _req, res, _next) => {
    if (res.headersSent) return res.end();
    const status =
      error.code === "LIMIT_FILE_SIZE"
        ? 413
        : error instanceof multer.MulterError
          ? 400
          : error.status || 500;
    const message =
      error.code === "LIMIT_FILE_SIZE"
        ? "영상은 100MB 이하만 등록할 수 있습니다."
        : error instanceof multer.MulterError
          ? "영상 업로드 형식을 확인해주세요."
          : status === 500
            ? "서버 처리 중 오류가 발생했습니다."
            : error.type === "entity.parse.failed"
              ? "JSON 입력을 확인해주세요."
              : error.message;
    if (status === 500) console.error("WODSiege API error:", error);
    res.status(status).json({ error: message });
  });
  return { app, close: () => db.close() };
}
