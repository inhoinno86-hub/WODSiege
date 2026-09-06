import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from "@playwright/test";

const PASSWORD = "browser-test-password-123";
const START = Date.parse("2026-09-06T00:00:00Z");
const fixtureHeaders = { "x-wodsiege-e2e": "wodsiege-loopback-e2e-only" };
type Account = {
  token: string;
  user: { id: string; name: string; email: string };
};
type Box = {
  id: string;
  name: string;
  active: boolean;
  operatorVerified: boolean;
};

async function api(
  request: APIRequestContext,
  path: string,
  account?: Account,
  data?: unknown,
) {
  const response = await request.fetch(`/api${path}`, {
    method: data === undefined ? "GET" : "POST",
    data,
    headers: account ? { Authorization: `Bearer ${account.token}` } : {},
  });
  const result = await response.json();
  expect(response.ok(), `${path}: ${JSON.stringify(result)}`).toBeTruthy();
  return result;
}
async function clock(
  request: APIRequestContext,
  now: number,
  pages: Page[] = [],
) {
  const response = await request.post("/__e2e/clock", {
    headers: fixtureHeaders,
    data: { now },
  });
  expect(response.ok()).toBeTruthy();
  for (const page of pages) await page.clock.setFixedTime(now);
}
async function register(
  request: APIRequestContext,
  name: string,
): Promise<Account> {
  return api(request, "/auth/register", undefined, {
    name,
    email: `user-${Array.from(name)
      .map((char) => char.codePointAt(0)!.toString(16))
      .join("")}@e2e.local`,
    password: PASSWORD,
  });
}
async function seed(request: APIRequestContext) {
  const operator = await api(request, "/auth/login", undefined, {
    email: "operator@e2e.local",
    password: PASSWORD,
  });
  const sides: { box: Box; members: Account[] }[] = [];
  for (const name of ["성수", "서울숲"]) {
    const members = [];
    for (let i = 1; i <= 3; i++)
      members.push(await register(request, `${name}선수${i}`));
    const box = await api(request, "/boxes", members[0], {
      name: `${name} 테스트 Box`,
      address: `서울 성동구 ${name}로 12`,
      dong: "성수동",
      district: "성동구",
      lat: 37.5445,
      lng: 127.0557,
      description: "브라우저 테스트 전용 Box",
    });
    for (const member of members.slice(1)) {
      await api(request, `/boxes/${box.id}/join`, member, {});
      await api(request, `/boxes/${box.id}/approve-member`, members[0], {
        userId: member.user.id,
      });
    }
    for (const member of members)
      await api(request, `/boxes/${box.id}/check-in`, member, {
        lat: 37.5445,
        lng: 127.0557,
        accuracy: 10,
        timestamp: START,
        consent: true,
      });
    const approved = await api(request, `/boxes/${box.id}/verify`, operator, {
      approved: true,
      reason: "테스트 전용 운영 증빙을 확인했습니다.",
    });
    expect(approved.active && approved.operatorVerified).toBeTruthy();
    sides.push({ box: approved, members });
  }
  return sides;
}
async function login(page: Page, account: Account, hash = "home") {
  await page.goto(`/#${hash}`);
  await page.getByLabel("이메일", { exact: true }).fill(account.user.email);
  await page.getByLabel("비밀번호", { exact: true }).fill(PASSWORD);
  await page
    .locator("form")
    .getByRole("button", { name: "로그인", exact: true })
    .click();
  await expect(page.locator("#main-content")).toBeVisible();
}
async function refresh(page: Page) {
  const done = page.waitForResponse(
    (r) => r.url().endsWith("/api/state") && r.request().method() === "GET",
  );
  await page.getByRole("button", { name: "새로고침", exact: true }).click();
  await done;
}
async function noOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    viewport: innerWidth,
    document: document.documentElement.scrollWidth,
    dialogs: [...document.querySelectorAll("dialog[open]")].map((d) => ({
      width: d.clientWidth,
      scroll: d.scrollWidth,
    })),
  }));
  expect(dimensions.document, JSON.stringify(dimensions)).toBeLessThanOrEqual(
    dimensions.viewport + 1,
  );
  for (const dialog of dimensions.dialogs)
    expect(dialog.scroll).toBeLessThanOrEqual(dialog.width + 1);
}
function errors(page: Page) {
  const found: string[] = [];
  page.on("pageerror", (error) => found.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") found.push(message.text());
  });
  return found;
}

// Generate an actual playable video in Chromium, without external files or codecs.
async function evidence(page: Page) {
  const result = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const drawing = canvas.getContext("2d")!;
    drawing.fillStyle = "#a3e635";
    drawing.fillRect(0, 0, 64, 64);
    const stream = canvas.captureStream(10);
    const mime = ["video/mp4;codecs=avc1.42001E", "video/webm;codecs=vp8"].find(
      (type) => MediaRecorder.isTypeSupported(type),
    )!;
    const recorder = new MediaRecorder(stream, { mimeType: mime });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size) chunks.push(event.data);
    };
    const stopped = new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
    });
    recorder.start();
    await new Promise((resolve) => setTimeout(resolve, 250));
    drawing.fillStyle = "#171a20";
    drawing.fillRect(10, 10, 30, 30);
    await new Promise((resolve) => setTimeout(resolve, 250));
    recorder.stop();
    await stopped;
    stream.getTracks().forEach((track) => track.stop());
    const blob = new Blob(chunks, { type: mime.split(";")[0] });
    return {
      bytes: Array.from(new Uint8Array(await blob.arrayBuffer())),
      mime: blob.type,
    };
  });
  expect(result.bytes.length).toBeGreaterThan(100);
  return {
    name:
      result.mime === "video/mp4"
        ? "fixture-evidence.mp4"
        : "fixture-evidence.webm",
    mimeType: result.mime,
    buffer: Buffer.from(result.bytes),
  };
}

test.beforeEach(async ({ request, page }) => {
  const response = await request.post("/__e2e/reset", {
    headers: fixtureHeaders,
  });
  expect(response.ok()).toBeTruthy();
  await page.clock.setFixedTime(START);
});

for (const width of [360, 412, 840])
  test(`${width}px: 로그인·주요 화면과 작성 중 펼침/접힘 상태 유지`, async ({
    page,
    request,
  }, testInfo) => {
    const [a] = await seed(request);
    const failures = errors(page);
    await page.setViewportSize({ width, height: 915 });
    await page.goto("/");
    await noOverflow(page);
    await login(page, a.members[0]);
    await noOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath(`home-${width}.png`),
      fullPage: true,
    });
    for (const route of ["boxes", "rankings", "profile", "matches"]) {
      await page.goto(`/#${route}`);
      await expect(page.locator("#main-content h1")).toBeVisible();
      await noOverflow(page);
    }
    await page
      .getByRole("button", { name: "도전장 열기", exact: true })
      .click();
    await page
      .getByLabel("도전장 제목", { exact: true })
      .fill("접어도 유지되는 우리 Box 도전장");
    await page
      .getByLabel("장소 / 장비 합의", { exact: true })
      .fill("동일 규격 장비");
    for (const resized of [840, 360, width]) {
      await page.setViewportSize({ width: resized, height: 915 });
      await expect(page.getByLabel("도전장 제목", { exact: true })).toHaveValue(
        "접어도 유지되는 우리 Box 도전장",
      );
      await expect(
        page.getByLabel("장소 / 장비 합의", { exact: true }),
      ).toHaveValue("동일 규격 장비");
      await noOverflow(page);
    }
    await page.screenshot({
      path: testInfo.outputPath(`draft-${width}.png`),
      fullPage: true,
    });
    expect(failures).toEqual([]);
  });

test("브라우저 회원가입 → Box 등록 → 다른 계정 가입 신청 → 관리자 승인", async ({
  page,
  request,
}) => {
  const failures = errors(page);
  await page.goto("/");
  await page.getByRole("button", { name: "회원가입", exact: true }).click();
  await page.getByLabel("이름", { exact: true }).fill("브라우저관리자");
  await page
    .getByLabel("이메일", { exact: true })
    .fill("browser-owner@e2e.local");
  await page.getByLabel("비밀번호").fill(PASSWORD);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "계정 만들기" }).click();
  await expect(page.locator("#main-content")).toBeVisible();
  await page.goto("/#boxes");
  await page.getByRole("button", { name: "Box 등록", exact: true }).click();
  for (const [label, value] of Object.entries({
    "Box 이름": "브라우저 등록 Box",
    "도로명 주소": "서울 성동구 성수로 12",
    "시·군·구": "성동구",
    동: "성수동",
    "Box 위도": "37.5445",
    "Box 경도": "127.0557",
    "Box 소개": "브라우저에서 직접 만든 테스트 Box",
  }))
    await page.getByLabel(label, { exact: true }).fill(value);
  await page
    .getByRole("button", { name: "Box 등록 신청", exact: true })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  const owner = await api(request, "/auth/login", undefined, {
    email: "browser-owner@e2e.local",
    password: PASSWORD,
  });
  const state = await api(request, "/state", owner);
  expect(state.boxes[0].name).toBe("브라우저 등록 Box");
  expect(state.boxes[0].operatorVerified).toBe(false);
  const member = await register(request, "가입테스트선수");
  const other = await page.context().browser()!.newPage();
  try {
    await login(other, member, "boxes");
    await other
      .locator(".box-list-item")
      .filter({ hasText: "브라우저 등록 Box" })
      .click();
    await other
      .getByRole("button", { name: "이 Box에 가입 신청", exact: true })
      .click();
    await expect(
      other.getByRole("button", { name: "가입 승인 대기 중" }),
    ).toBeDisabled();
    await refresh(page);
    await page
      .locator(".box-list-item")
      .filter({ hasText: "브라우저 등록 Box" })
      .click();
    await page.getByRole("button", { name: "소속 승인", exact: true }).click();
    await expect(
      page.getByText("가입테스트선수", { exact: true }),
    ).toBeVisible();
    expect((await api(request, "/state", member)).user.boxId).toBe(
      state.boxes[0].id,
    );
  } finally {
    await other.close();
  }
  expect(failures).toEqual([]);
});

for (const scenario of [
  { format: "individual", venue: "together", count: 1 },
  { format: "team3", venue: "separate", count: 3 },
])
  test(`${scenario.format}/${scenario.venue}: 생성부터 양측 영상 검토·확정·원장까지`, async ({
    page,
    request,
  }, testInfo) => {
    const [a, b] = await seed(request);
    const failures = errors(page);
    const other = await page
      .context()
      .browser()!
      .newPage({
        viewport: { width: 412, height: 915 },
        timezoneId: "Asia/Seoul",
      });
    const otherFailures = errors(other);
    await other.clock.setFixedTime(START);
    try {
      await login(page, a.members[0], "matches");
      await page
        .getByRole("button", { name: "도전장 열기", exact: true })
        .click();
      await page
        .getByLabel("도전장 제목", { exact: true })
        .fill(`검증 대결 ${scenario.format}`);
      await page
        .getByLabel("WOD · 부문", { exact: true })
        .selectOption("sprint-rx");
      await page
        .getByLabel("경기 구성", { exact: true })
        .selectOption(scenario.format);
      await page
        .getByLabel("개최 방식", { exact: true })
        .selectOption(scenario.venue);
      await page.getByLabel("경기 일시").fill("2026-09-06T09:10");
      await page
        .getByLabel("장소 / 장비 합의", { exact: true })
        .fill("같은 규격 장비로 수행");
      await page
        .getByRole("button", { name: "도전장 공개", exact: true })
        .click();
      await expect(page.locator(".match-detail")).toBeVisible();
      const matchId = new URL(page.url()).hash.split("/")[1];
      await login(other, b.members[0], `matches/${matchId}`);
      await other
        .getByRole("button", { name: "우리 Box로 도전 신청", exact: true })
        .click();
      await expect(
        other.getByText("방어 Box의 수락을 기다리고 있어요.", { exact: true }),
      ).toBeVisible();
      await refresh(page);
      await page
        .getByRole("button", { name: "도전 수락", exact: true })
        .click();
      for (const member of a.members.slice(0, scenario.count))
        await page
          .getByRole("checkbox", { name: member.user.name, exact: true })
          .check();
      await page
        .getByRole("button", { name: "명단과 경기 조건에 동의", exact: true })
        .click();
      await expect(
        page.getByText("우리 Box 동의 완료 · 상대 동의 대기", { exact: false }),
      ).toBeVisible();
      await refresh(other);
      for (const member of b.members.slice(0, scenario.count))
        await other
          .getByRole("checkbox", { name: member.user.name, exact: true })
          .check();
      await other
        .getByRole("button", { name: "명단과 경기 조건에 동의", exact: true })
        .click();
      await expect(
        other.getByRole("button", { name: "경기 시작", exact: true }),
      ).toBeDisabled();
      await clock(request, START + 10 * 60000, [page, other]);
      await refresh(page);
      await page
        .getByRole("button", { name: "경기 시작", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "영상과 기록 제출", exact: true }),
      ).toBeVisible();
      const video = await evidence(page);
      for (const [current, seconds] of [
        [page, "100"],
        [other, "120"],
      ] as const) {
        if (current === other) await refresh(other);
        await current.getByLabel("경기 증빙 영상").setInputFiles(video);
        for (const input of await current.getByLabel("완료 시간 (초)").all())
          await input.fill(seconds);
        await current
          .getByRole("checkbox", {
            name: "영상 속 참여자의 촬영·검증용 열람 동의를 확인했습니다.",
          })
          .check();
        await current
          .getByRole("button", { name: "영상과 기록 제출", exact: true })
          .click();
        if (current === page) {
          await expect(
            page.getByText("우리 기록 제출 완료 · 상대 제출을 기다려 주세요.", {
              exact: false,
            }),
          ).toBeVisible();
          const blind = (
            await api(request, "/state", b.members[0])
          ).matches.find((m: { id: string }) => m.id === matchId);
          expect(blind.submissions).toEqual({});
          expect(blind.submissionBoxes).toEqual([a.box.id]);
        }
      }
      await expect(
        other.getByRole("button", { name: "상대 기록 확인", exact: true }),
      ).toBeVisible();
      await other
        .getByRole("button", { name: "상대 기록 확인", exact: true })
        .click();
      await expect(
        other.getByText("우리 Box 검토 완료", { exact: false }),
      ).toBeVisible();
      await refresh(page);
      await page
        .getByRole("button", { name: "증빙 영상 보기", exact: true })
        .last()
        .click();
      await expect(page.locator("video")).toBeVisible();
      await expect
        .poll(() =>
          page
            .locator("video")
            .evaluate((video: HTMLVideoElement) => video.readyState),
        )
        .toBeGreaterThanOrEqual(1);
      await page
        .getByRole("button", { name: "상대 기록 확인", exact: true })
        .click();
      await expect(
        page.getByRole("button", {
          name: "검토 기한 종료 후 결과 확정",
          exact: true,
        }),
      ).toBeDisabled();
      await noOverflow(page);
      // Sign out before the artificial 48h jump, so background polling does not
      // generate an expected expiry response inside the no-console-error check.
      for (const current of [page, other]) {
        await current.goto("/#profile");
        await current
          .getByRole("button", { name: "로그아웃", exact: true })
          .last()
          .click();
        await expect(current.locator(".auth-layout")).toBeVisible();
      }
      await clock(request, START + 10 * 60000 + 48 * 3600000 + 1000, [
        page,
        other,
      ]);
      // Sessions intentionally expire after 24 hours; use normal browser login again.
      await login(page, a.members[0], `matches/${matchId}`);
      await page
        .getByRole("button", {
          name: "검토 기한 종료 후 결과 확정",
          exact: true,
        })
        .click();
      await expect(
        page.getByRole("heading", {
          name: `${a.box.name} 도장 지키기 성공`,
          exact: true,
        }),
      ).toBeVisible();
      await noOverflow(page);
      await page.screenshot({
        path: testInfo.outputPath(`finalized-${scenario.format}.png`),
        fullPage: true,
      });
      const session = await api(request, "/auth/login", undefined, {
        email: a.members[0].user.email,
        password: PASSWORD,
      });
      const state = await api(request, "/state", session);
      expect(
        state.matches.find((m: { id: string }) => m.id === matchId).status,
      ).toBe("finalized");
      expect(
        state.ledger.filter(
          (l: { matchId: string; kind: string }) =>
            l.matchId === matchId && l.kind === "points",
        ),
      ).toHaveLength(1);
      await page.goto("/#rankings");
      await page
        .getByLabel("경기 구성", { exact: true })
        .selectOption(scenario.format);
      await expect(
        page.locator(".ranking-row").filter({ hasText: a.box.name }),
      ).toContainText("1012");
      expect(failures).toEqual([]);
      expect(otherFailures).toEqual([]);
    } finally {
      await other.close();
    }
  });

test("fixture 제어 경로는 보호되며 연결 실패는 한국어 안내와 재시도로 복구", async ({
  page,
  request,
}) => {
  expect((await request.post("/__e2e/reset")).status()).toBe(403);
  expect(
    (
      await request.post("/__e2e/reset", {
        headers: { ...fixtureHeaders, origin: "https://external.invalid" },
      })
    ).status(),
  ).toBe(403);
  const [a] = await seed(request);
  await login(page, a.members[0]);
  await page.route("**/api/state", (route) => route.abort());
  await page.getByRole("button", { name: "새로고침", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "서버에 연결할 수 없습니다",
  );
  await page.unroute("**/api/state");
  await refresh(page);
  await expect(page.getByRole("alert")).not.toBeVisible();
});

test("이의 접수 → 독립 운영자 판정 → 무효 정정이 UI와 원장에 반영", async ({
  page,
  request,
}) => {
  const [a, b] = await seed(request);
  const failures = errors(page);
  let match = await api(request, "/matches", a.members[0], {
    title: "영상 근거 판정 대결",
    templateId: "sprint-rx",
    format: "individual",
    venue: "separate",
    location: "각자의 테스트 Box",
    scheduledAt: new Date(START + 1000).toISOString(),
  });
  await api(request, `/matches/${match.id}/apply`, b.members[0], {});
  await api(request, `/matches/${match.id}/accept`, a.members[0], {});
  for (const side of [a, b])
    await api(request, `/matches/${match.id}/agree`, side.members[0], {
      roster: [side.members[0].user.id],
    });
  await clock(request, START + 1000, [page]);
  match = await api(request, `/matches/${match.id}/start`, a.members[0], {});
  await login(page, a.members[0], `matches/${match.id}`);
  const clip = await evidence(page);
  for (const [side, seconds] of [
    [a, 100],
    [b, 120],
  ] as const) {
    const response = await request.post(`/api/matches/${match.id}/video`, {
      headers: { Authorization: `Bearer ${side.members[0].token}` },
      multipart: { consent: "true", video: clip },
    });
    expect(response.ok()).toBeTruthy();
    await api(request, `/matches/${match.id}/submit`, side.members[0], {
      videoId: (await response.json()).videoId,
      records: [
        {
          userId: side.members[0].user.id,
          completed: true,
          seconds,
          reps: 90,
          noReps: 0,
          note: "10초 시점 확인",
          videoSecond: 10,
        },
      ],
    });
  }
  await refresh(page);
  await page.getByRole("button", { name: "이의 제기", exact: true }).click();
  await page
    .getByLabel("사유", { exact: true })
    .fill("영상 10초의 반복 동작 확인을 요청합니다.");
  await page.getByRole("button", { name: "이의 접수", exact: true }).click();
  await expect(
    page.getByText("판정 전에는 점수가 반영되지 않아요.", { exact: false }),
  ).toBeVisible();
  expect((await api(request, "/state", a.members[0])).ledger).toHaveLength(0);
  const operator = await api(request, "/auth/login", undefined, {
    email: "operator@e2e.local",
    password: PASSWORD,
  });
  const operations = await page
    .context()
    .browser()!
    .newPage({ baseURL: "http://127.0.0.1:4173" });
  try {
    await login(operations, operator, "operations");
    await operations.getByRole("button", { name: "판정", exact: true }).click();
    await operations
      .getByLabel("판정", { exact: true })
      .selectOption("finalize");
    await operations
      .getByLabel("확인 근거 / 판정 사유", { exact: true })
      .fill("제출 영상의 10초 동작을 확인하고 원기록을 인정합니다.");
    await operations.getByRole("dialog").getByRole("checkbox").check();
    await operations
      .getByRole("button", { name: "근거와 결정 저장", exact: true })
      .click();
    await expect(operations.getByRole("dialog")).not.toBeVisible();
    await operations
      .getByRole("button", { name: "정정 검토", exact: true })
      .click();
    await operations.getByLabel("판정", { exact: true }).selectOption("void");
    await operations
      .getByLabel("확인 근거 / 판정 사유", { exact: true })
      .fill("후속 증거에서 영상 재사용이 확인되어 무효로 정정합니다.");
    await operations.getByRole("dialog").getByRole("checkbox").check();
    await operations
      .getByRole("button", { name: "근거와 결정 저장", exact: true })
      .click();
    await expect(operations.getByRole("dialog")).not.toBeVisible();
    await refresh(page);
    await expect(
      page.getByRole("heading", { name: "무효 경기", exact: true }),
    ).toBeVisible();
    const snapshot = await api(request, "/state", a.members[0]);
    expect(
      snapshot.ledger
        .filter((l: { kind: string }) => l.kind === "points")
        .reduce((sum: number, l: { amount: number }) => sum + l.amount, 0),
    ).toBe(0);
    expect(
      snapshot.matches[0].history.some(
        (event: { type: string }) => event.type === "corrected",
      ),
    ).toBeTruthy();
  } finally {
    await operations.close();
  }
  expect(failures).toEqual([]);
});
