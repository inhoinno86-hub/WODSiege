import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server/app.mjs";

const PASSWORD = "test-only-password-123";
const MP4 = Buffer.concat([
  Buffer.from([0, 0, 0, 24]),
  Buffer.from("ftypisom"),
  Buffer.alloc(40),
]);
async function fixture(t, setup = true) {
  const dir = mkdtempSync(join(tmpdir(), "wodsiege-api-test-"));
  let timestamp = Date.parse("2026-09-06T00:00:00Z");
  let service;
  let listener;
  let base;
  async function start() {
    service = createApp({
      dataDir: dir,
      clock: () => new Date(timestamp),
      operatorEmail: "operator@test.local",
      operatorPassword: PASSWORD,
    });
    listener = service.app.listen(0, "127.0.0.1");
    await new Promise((r) => listener.once("listening", r));
    base = `http://127.0.0.1:${listener.address().port}/api`;
  }
  async function stop() {
    await new Promise((r) => listener.close(r));
    service.close();
  }
  await start();
  t.after(async () => {
    await stop();
    rmSync(dir, { recursive: true, force: true });
  });
  async function req(
    path,
    account,
    body,
    expected = 200,
    method = body === undefined ? "GET" : "POST",
  ) {
    const res = await fetch(base + path, {
      method,
      headers: {
        ...(account ? { Authorization: "Bearer " + account.token } : {}),
        ...(body !== undefined && !(body instanceof FormData)
          ? { "Content-Type": "application/json" }
          : {}),
      },
      ...(body !== undefined
        ? { body: body instanceof FormData ? body : JSON.stringify(body) }
        : {}),
    });
    const data = (res.headers.get("content-type") || "").includes(
      "application/json",
    )
      ? await res.json()
      : Buffer.from(await res.arrayBuffer());
    assert.equal(
      res.status,
      expected,
      `${method} ${path}: ${JSON.stringify(data)}`,
    );
    return data;
  }
  const accounts = [];
  async function register(name, extra = {}) {
    const a = await req(
      "/auth/register",
      null,
      { name, email: `${name}@test.local`, password: PASSWORD, ...extra },
      201,
    );
    accounts.push(a);
    return a;
  }
  const operator = await req("/auth/login", null, {
    email: "operator@test.local",
    password: PASSWORD,
  });
  accounts.push(operator);
  async function refresh() {
    for (const a of accounts)
      Object.assign(
        a,
        await req("/auth/login", null, {
          email: a.user.email,
          password: PASSWORD,
        }),
      );
  }
  async function advance(ms) {
    timestamp += ms;
    if (ms >= 23 * 3600000) await refresh();
  }
  async function box(owner, name) {
    return req("/boxes", owner, {
      name,
      address: `서울 성동구 ${name} 1`,
      dong: "성수동",
      district: "성동구",
      lat: 37.5445,
      lng: 127.0557,
      description: "테스트 Box",
    });
  }
  async function add(box, owner, member) {
    await req(`/boxes/${box.id}/join`, member, {});
    await req(`/boxes/${box.id}/approve-member`, owner, {
      userId: member.user.id,
    });
  }
  const check = (box, account, change = {}, expected = 200) =>
    req(
      `/boxes/${box.id}/check-in`,
      account,
      {
        lat: box.lat,
        lng: box.lng,
        accuracy: 10,
        timestamp,
        consent: true,
        ...change,
      },
      expected,
    );
  let a;
  let b;
  let outsider;
  let aa;
  let bb;
  if (setup) {
    aa = await Promise.all(
      ["alpha", "alpha2", "alpha3"].map((n) => register(n)),
    );
    bb = await Promise.all(["beta", "beta2", "beta3"].map((n) => register(n)));
    outsider = await register("outsider");
    a = await box(aa[0], "ALPHA");
    b = await box(bb[0], "BETA");
    for (const [x, members] of [
      [a, aa],
      [b, bb],
    ]) {
      for (const member of members.slice(1)) await add(x, members[0], member);
      for (const member of members) await check(x, member);
      await req(`/boxes/${x.id}/verify`, operator, {
        approved: true,
        reason: "테스트 운영권 확인",
      });
    }
  }
  async function match({
    format = "individual",
    templateId = "sprint-rx",
    venue = "separate",
    rosterA = aa,
    rosterB = bb,
  } = {}) {
    let m = await req("/matches", aa[0], {
      title: "ALPHA vs BETA",
      templateId,
      format,
      venue,
      location: "각자의 Box",
      scheduledAt: new Date(timestamp + 1000).toISOString(),
    });
    await req(`/matches/${m.id}/apply`, bb[0], {});
    await req(`/matches/${m.id}/accept`, aa[0], {});
    await req(`/matches/${m.id}/agree`, aa[0], {
      roster: rosterA
        .slice(0, format === "team3" ? 3 : 1)
        .map((a) => a.user.id),
    });
    m = await req(`/matches/${m.id}/agree`, bb[0], {
      roster: rosterB
        .slice(0, format === "team3" ? 3 : 1)
        .map((a) => a.user.id),
    });
    await advance(1000);
    return req(`/matches/${m.id}/start`, aa[0], {});
  }
  async function upload(
    m,
    account,
    { bytes = MP4, type = "video/mp4", consent = true } = {},
    expected = 201,
  ) {
    const form = new FormData();
    form.append("video", new Blob([bytes], { type }), "recording.mp4");
    if (consent) form.append("consent", "true");
    return req(`/matches/${m.id}/video`, account, form, expected);
  }
  async function submit(m, account, box, seconds = 100, reps) {
    const { videoId } = await upload(m, account);
    const amrap = m.template.kind === "amrap";
    const records = m.rosters[box.id].map((userId) => ({
      userId,
      completed: !amrap,
      seconds: amrap ? m.template.timeCap : seconds,
      reps: reps ?? (amrap ? 50 : m.template.totalReps),
      noReps: 2,
      note: "동작 확인",
      videoSecond: 10,
    }));
    const body = { videoId, records };
    return { body, match: await req(`/matches/${m.id}/submit`, account, body) };
  }
  async function completed(options = {}) {
    let m = await match(options);
    await submit(m, aa[0], a, 100, options.repsA);
    await submit(m, bb[0], b, 120, options.repsB);
    await req(`/matches/${m.id}/review`, aa[0], { approved: true });
    await req(`/matches/${m.id}/review`, bb[0], { approved: true });
    await advance(48 * 3600000);
    m = await req(`/matches/${m.id}/finalize`, aa[0], {});
    return m;
  }
  return {
    dir,
    req,
    register,
    operator,
    a,
    b,
    aa,
    bb,
    outsider,
    box,
    add,
    check,
    match,
    upload,
    submit,
    completed,
    advance,
    refresh,
    timestamp: () => timestamp,
    restart: async () => {
      await stop();
      await start();
    },
    raw: () => base,
  };
}

test("authentication enforces athlete roles, expiry, logout, hash storage and persistence", async (t) => {
  const f = await fixture(t, false);
  const a = await f.register("athlete", { role: "operator", boxId: "forged" });
  assert.equal(a.user.role, "athlete");
  assert.equal(a.user.boxId, null);
  await f.req("/state", null, undefined, 401);
  await f.req(
    "/auth/login",
    null,
    { email: a.user.email, password: "wrong-password" },
    401,
  );
  const box = await f.box(a, "Persisted");
  await f.restart();
  const state = await f.req("/state", a);
  assert.equal(state.boxes[0].id, box.id);
  assert.equal(state.user.email, a.user.email);
  assert.ok(state.users.every((u) => !("email" in u) && !("hash" in u)));
  assert.equal(
    readFileSync(join(f.dir, "wodsiege.sqlite")).includes(
      Buffer.from(PASSWORD),
    ),
    false,
  );
  await f.req("/auth/logout", a, {});
  await f.req("/state", a, undefined, 401);
  const login = await f.req("/auth/login", null, {
    email: a.user.email,
    password: PASSWORD,
  });
  await f.advance(25 * 3600000);
  await f.req("/state", login, undefined, 401);
});

test("Box registration requires 3 distinct approved members; invalid GPS and elevation fail", async (t) => {
  const f = await fixture(t, false);
  const a = await f.register("one");
  const b = await f.register("two");
  const c = await f.register("three");
  const box = await f.box(a, "Three");
  await f.check(box, b, {}, 403);
  await f.add(box, a, b);
  await f.add(box, a, c);
  await f.check(box, a);
  let current = await f.check(box, b);
  assert.equal(current.active, false);
  current = await f.check(box, b);
  assert.equal(current.checks.length, 2);
  await f.check(box, c, { accuracy: 101 }, 400);
  await f.check(box, c, { lat: box.lat + 0.1 }, 400);
  await f.check(box, c, { timestamp: f.timestamp() - 600001 }, 400);
  await f.check(box, c, { timestamp: f.timestamp() + 1 }, 400);
  await f.check(box, c, { consent: false }, 400);
  current = await f.check(box, c);
  assert.equal(current.active, true);
  assert.equal(current.operatorVerified, false);
  assert.equal("checkCoordinates" in current, false);
  await f.req(
    `/boxes/${box.id}/verify`,
    a,
    { approved: true, reason: "forged" },
    403,
  );
  await f.req("/matches", a, { title: "premature" }, 409);
  await f.req(`/boxes/${box.id}/verify`, f.operator, {
    approved: true,
    reason: "운영 확인",
  });
  await f.req(`/boxes/${box.id}/join`, f.operator, {});
  await f.req(
    `/boxes/${box.id}/approve-member`,
    b,
    { userId: f.operator.user.id },
    403,
  );
  const second = await f.box(await f.register("other"), "Other");
  await f.req(`/boxes/${second.id}/join`, a, {}, 409);
});

test("locked rosters are immutable, state transitions enforce time and blind evidence access", async (t) => {
  const f = await fixture(t);
  const m = await f.match();
  await f.req(
    `/matches/${m.id}/agree`,
    f.aa[0],
    { roster: [f.aa[1].user.id] },
    409,
  );
  await f.req(`/matches/${m.id}/cancel`, f.aa[0], { reason: "losing" }, 409);
  await f.req(`/matches/${m.id}/finalize`, f.aa[0], {}, 409);
  assert.equal((await f.req("/state", f.outsider)).matches.length, 0);
  await f.upload(m, f.outsider, {}, 403);
  const submitted = await f.submit(m, f.aa[0], f.a);
  const blind = (await f.req("/state", f.bb[0])).matches[0];
  assert.deepEqual(blind.submissionBoxes, [f.a.id]);
  assert.deepEqual(blind.submissions, {});
  await f.req(`/videos/${submitted.body.videoId}`, f.bb[0], undefined, 403);
  await f.req(`/videos/${submitted.body.videoId}`, f.outsider, undefined, 403);
  assert.ok(
    Buffer.isBuffer(await f.req(`/videos/${submitted.body.videoId}`, f.aa[0])),
  );
  await f.req(`/videos/${submitted.body.videoId}`, f.operator);
  await f.req(`/matches/${m.id}/review`, f.aa[0], { approved: true }, 409);
  await f.req(`/matches/${m.id}/submit`, f.aa[0], submitted.body);
  await f.req(
    `/matches/${m.id}/submit`,
    f.aa[0],
    {
      ...submitted.body,
      records: [{ ...submitted.body.records[0], seconds: 90 }],
    },
    409,
  );
  await f.submit(m, f.bb[0], f.b, 120);
  const revealed = (await f.req("/state", f.bb[0])).matches[0];
  assert.equal(Object.keys(revealed.submissions).length, 2);
  await f.req(`/videos/${submitted.body.videoId}`, f.bb[0]);
  await f.req(`/matches/${m.id}/review`, f.aa[0], { approved: true });
  await f.req(`/matches/${m.id}/review`, f.aa[0], { approved: true });
  await f.req(`/matches/${m.id}/finalize`, f.aa[0], {}, 409);
  await f.req(`/matches/${m.id}/review`, f.bb[0], { approved: true });
  await f.req(`/matches/${m.id}/finalize`, f.aa[0], {}, 409);
  await f.advance(48 * 3600000);
  const result = await f.req(`/matches/${m.id}/finalize`, f.aa[0], {});
  assert.equal(result.result.winnerId, f.a.id);
  const before = (await f.req("/state", f.aa[0])).ledger;
  await Promise.all([
    f.req(`/matches/${m.id}/finalize`, f.aa[0], {}),
    f.req(`/matches/${m.id}/finalize`, f.bb[0], {}),
  ]);
  assert.deepEqual((await f.req("/state", f.aa[0])).ledger, before);
  assert.ok(before.every((l) => l.matchId === m.id));
  const ranks = await f.req(
    "/rankings?format=individual&level=Rx&dong=성수동",
    f.aa[0],
  );
  assert.deepEqual(
    ranks.rankings.map((r) => r.rating),
    [1012, 988],
  );
  assert.deepEqual(
    (await f.req("/rankings?format=team3&level=Rx", f.aa[0])).rankings.map(
      (r) => r.rating,
    ),
    [1000, 1000],
  );
  await f.req(`/boxes/${f.a.id}/decorate`, f.aa[0], {}, 409);
});

test("video requires consent, MIME/header validation, secure owner linkage and deadline", async (t) => {
  const f = await fixture(t);
  const m = await f.match();
  await f.upload(m, f.aa[0], { consent: false }, 400);
  await f.upload(m, f.aa[0], { bytes: Buffer.from("not a video at all") }, 400);
  await f.upload(m, f.aa[0], { type: "text/plain" }, 400);
  assert.equal(readdirSync(join(f.dir, "uploads")).length, 0);
  const v = await f.upload(m, f.aa[0]);
  const record = {
    userId: f.bb[0].user.id,
    completed: true,
    seconds: 100,
    reps: 90,
    noReps: 0,
  };
  await f.req(
    `/matches/${m.id}/submit`,
    f.bb[0],
    { videoId: v.videoId, records: [record] },
    400,
  );
  await f.advance(25 * 3600000);
  await f.upload(m, f.aa[0], {}, 409);
  await f.req(
    `/matches/${m.id}/submit`,
    f.aa[0],
    { videoId: v.videoId, records: [{ ...record, userId: f.aa[0].user.id }] },
    409,
  );
});

test("100MB video ceiling rejects streaming oversized uploads and cleans temporary files", async (t) => {
  const f = await fixture(t);
  const m = await f.match();
  const boundary = "wodsiege-test-boundary";
  let part = 0;
  const header = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="consent"\r\n\r\ntrue\r\n--${boundary}\r\nContent-Disposition: form-data; name="video"; filename="large.mp4"\r\nContent-Type: video/mp4\r\n\r\n`,
  );
  const chunk = Buffer.alloc(1024 * 1024);
  MP4.copy(chunk);
  const body = new ReadableStream({
    pull(controller) {
      if (part === 0) controller.enqueue(header);
      else if (part <= 101) controller.enqueue(chunk);
      else {
        controller.enqueue(Buffer.from(`\r\n--${boundary}--\r\n`));
        controller.close();
      }
      part++;
    },
  });
  const res = await fetch(`${f.raw()}/matches/${m.id}/video`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${f.aa[0].token}`,
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
    },
    body,
    duplex: "half",
  });
  assert.equal(res.status, 413);
  assert.match((await res.json()).error, /100MB/);
  assert.deepEqual(readdirSync(join(f.dir, "uploads")), []);
});

test("native/dev CORS, malformed input, and sensitive Box proof visibility are constrained", async (t) => {
  const f = await fixture(t);
  for (const origin of [
    "https://localhost",
    "http://localhost",
    "http://127.0.0.1:5173",
  ]) {
    const response = await fetch(f.raw() + "/health", {
      method: "OPTIONS",
      headers: { Origin: origin, "Access-Control-Request-Method": "GET" },
    });
    assert.equal(response.status, 204);
    assert.equal(response.headers.get("access-control-allow-origin"), origin);
  }
  const bad = await fetch(f.raw() + "/health", {
    method: "OPTIONS",
    headers: { Origin: "https://untrusted.example" },
  });
  assert.equal(bad.status, 403);
  assert.equal(bad.headers.get("access-control-allow-origin"), null);
  await f.req("/auth/login", null, {}, 400);
  await f.req("/auth/login", null, [], 400);
  const outsider = await f.req("/state", f.outsider);
  assert.ok(
    outsider.boxes.every((b) => !b.verification && !b.checkCoordinates),
  );
  assert.equal(outsider.metrics, null);
  const owner = await f.req("/state", f.aa[0]);
  assert.ok(owner.boxes.find((b) => b.id === f.a.id).verification);
  assert.equal(
    owner.boxes.find((b) => b.id === f.b.id).verification,
    undefined,
  );
});

test("disputes hold all rewards, disallow cancellation and require independent operator", async (t) => {
  const f = await fixture(t);
  const m = await f.match({ rosterA: [f.aa[1]] });
  await f.submit(m, f.aa[0], f.a);
  await f.submit(m, f.bb[0], f.b, 120);
  const disputed = await f.req(`/matches/${m.id}/review`, f.bb[0], {
    approved: false,
    reason: "버피 반복 확인 필요",
  });
  assert.equal(disputed.status, "disputed");
  await f.req(`/matches/${m.id}/cancel`, f.aa[0], { reason: "취소" }, 409);
  await f.req(`/matches/${m.id}/finalize`, f.aa[0], {}, 409);
  assert.equal((await f.req("/state", f.aa[0])).ledger.length, 0);
  await f.req(
    `/matches/${m.id}/resolve`,
    f.aa[0],
    { action: "finalize", reason: "셀프 판정" },
    403,
  );
  await f.add(f.a, f.aa[0], f.operator);
  await f.req(
    `/matches/${m.id}/resolve`,
    f.operator,
    { action: "finalize", reason: "소속 경기 판정" },
    403,
  );
  // Move operator to a neutral box through consent; historical athlete snapshots still enforce conflict checks.
  const neutral = await f.box(f.outsider, "Neutral");
  await f.add(neutral, f.outsider, f.operator);
  const resolved = await f.req(`/matches/${m.id}/resolve`, f.operator, {
    action: "finalize",
    reason: "영상 시점 10초 검토 결과 정상 수행",
  });
  assert.equal(resolved.status, "finalized");
  assert.equal(
    (await f.req("/state", f.aa[0])).ledger.filter(
      (l) => l.kind === "points",
    )[0].amount,
    20,
  );
});

test("historical corrections replay later Elo and reverse rewards including spent point debt", async (t) => {
  const f = await fixture(t);
  const first = await f.completed();
  const second = await f.completed();
  let state = await f.req("/state", f.aa[0]);
  assert.equal(
    state.ledger.filter((l) => l.kind === "points").at(-1).balance,
    40,
  );
  const before = (await f.req("/rankings", f.aa[0])).rankings.find(
    (r) => r.boxId === f.a.id,
  ).rating;
  assert.ok(before > 1023 && before < 1024);
  await f.req(`/boxes/${f.a.id}/decorate`, f.aa[0], {});
  await f.req(`/boxes/${f.a.id}/decorate`, f.aa[0], {}, 409);
  assert.equal(
    (await f.req("/rankings", f.aa[0])).rankings.find((r) => r.boxId === f.a.id)
      .rating,
    before,
  );
  const correction = {
    action: "void",
    reason: "원본 영상 재검토로 첫 경기 무효",
  };
  const corrected = await f.req(
    `/matches/${first.id}/correct`,
    f.operator,
    correction,
  );
  assert.equal(corrected.history.at(-1).previous.result.winnerId, f.a.id);
  let ranking = (await f.req("/rankings", f.aa[0])).rankings.find(
    (r) => r.boxId === f.a.id,
  );
  assert.equal(ranking.rating, 1012);
  assert.equal(ranking.games, 1);
  state = await f.req("/state", f.aa[0]);
  assert.equal(
    state.ledger.filter((l) => l.kind === "points").at(-1).balance,
    -10,
  );
  const len = state.ledger.length;
  await f.req(`/matches/${first.id}/correct`, f.operator, correction);
  assert.equal((await f.req("/state", f.aa[0])).ledger.length, len);
  await f.req(`/matches/${second.id}/correct`, f.operator, {
    action: "result",
    winnerId: f.b.id,
    reason: "두 번째 경기 결과 정정",
  });
  ranking = (await f.req("/rankings", f.aa[0])).rankings.find(
    (r) => r.boxId === f.a.id,
  );
  assert.equal(ranking.rating, 988);
  await f.restart();
  assert.equal(
    (await f.req("/rankings", f.aa[0])).rankings.find((r) => r.boxId === f.a.id)
      .rating,
    988,
  );
});

test("team AMRAP draw uses separate division and same-day pair earns only once", async (t) => {
  const f = await fixture(t);
  const m1 = await f.match({
    format: "team3",
    templateId: "engine-scaled",
    venue: "together",
  });
  const m2 = await f.match({ format: "team3", templateId: "engine-scaled" });
  for (const m of [m1, m2]) {
    await f.submit(m, f.aa[0], f.a, 100, 50);
    await f.submit(m, f.bb[0], f.b, 100, 50);
    await f.req(`/matches/${m.id}/review`, f.aa[0], { approved: true });
    await f.req(`/matches/${m.id}/review`, f.bb[0], { approved: true });
  }
  await f.advance(48 * 3600000);
  for (const m of [m1, m2]) {
    const result = await f.req(`/matches/${m.id}/finalize`, f.aa[0], {});
    assert.equal(result.result.winnerId, null);
  }
  assert.equal(
    (await f.req("/state", f.aa[0])).ledger.filter((l) => l.kind === "points")
      .length,
    1,
  );
  const rows = (await f.req("/rankings?format=team3&level=Scaled", f.aa[0]))
    .rankings;
  assert.deepEqual(
    rows.map((r) => [r.rating, r.games, r.rank]),
    [
      [1000, 1, 1],
      [1000, 1, 1],
    ],
  );
  assert.deepEqual(
    (await f.req("/rankings?format=individual&level=Rx", f.aa[0])).rankings.map(
      (r) => r.games,
    ),
    [0, 0],
  );
  // If first eligible match is voided, second same-day result takes its place without double rewards.
  await f.req(`/matches/${m1.id}/correct`, f.operator, {
    action: "void",
    reason: "첫 경기 무효",
  });
  const state = await f.req("/state", f.aa[0]);
  assert.equal(
    state.ledger.filter((l) => l.kind === "points").at(-1).balance,
    20,
  );
});

test("membership changes preserve locked athlete snapshots and deactivate former Box", async (t) => {
  const f = await fixture(t);
  const m = await f.match({ rosterA: [f.aa[1]] });
  await f.add(f.b, f.bb[0], f.aa[1]);
  const state = await f.req("/state", f.aa[1]);
  assert.equal(state.user.boxId, f.b.id);
  const old = state.boxes.find((b) => b.id === f.a.id);
  assert.equal(old.active, false);
  assert.equal(old.checks.length, 2);
  const historical = state.matches.find((x) => x.id === m.id);
  assert.deepEqual(historical.rosters[f.a.id], [f.aa[1].user.id]);
  assert.equal(historical.membershipSnapshot[f.a.id][0].boxId, f.a.id);
  await f.upload(m, f.aa[1]);
  await f.submit(m, f.aa[0], f.a);
  await f.req("/matches", f.aa[0], {}, 409);
});

test("no submission or response requires deadline and documented operator void; no false win", async (t) => {
  const f = await fixture(t);
  const m = await f.match();
  await f.req(
    `/matches/${m.id}/resolve`,
    f.operator,
    { action: "void", reason: "조기 종료" },
    409,
  );
  await f.advance(48 * 3600000);
  await f.req(
    `/matches/${m.id}/resolve`,
    f.operator,
    { action: "finalize", reason: "미제출 승리" },
    409,
  );
  const voided = await f.req(`/matches/${m.id}/resolve`, f.operator, {
    action: "void",
    reason: "양측 미제출로 경기 무효",
  });
  assert.equal(voided.status, "void");
  await f.req(
    `/matches/${m.id}/correct`,
    f.operator,
    { action: "result", winnerId: f.a.id, reason: "증거 없는 정정" },
    409,
  );
  assert.equal((await f.req("/state", f.aa[0])).ledger.length, 0);
  assert.equal((await f.req("/state", f.operator)).metrics.overdue, 0);
});
