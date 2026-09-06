import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  Bell,
  Building2,
  ChevronRight,
  Compass,
  LogOut,
  RefreshCw,
  Settings2,
  Shield,
  Swords,
  Trophy,
  UserRound,
  X,
} from "lucide-react";
import { api, saveServerUrl, serverUrl, setToken, token } from "./api";
import { Context } from "./context";
import { BoxMark, Field, Form, Modal, Busy, date } from "./components";
import type { Snapshot, User } from "./types";
import { Home, Matches } from "./screens/Matches";
import { Boxes } from "./screens/Boxes";
import { Profile, Rankings, Operations } from "./screens/Activity";

function Connection({ close }: { close: () => void }) {
  return (
    <Modal title="서버 연결 설정" close={close}>
      <p className="muted">
        USB 연결 시 서버 주소는 http://localhost:8787을 사용하세요. 서버 변경
        후에는 다시 로그인합니다.
      </p>
      <Form
        label="연결 주소 저장"
        onSubmit={async (data) => {
          saveServerUrl(String(data.get("url")));
          location.reload();
        }}
      >
        <Field
          label="API 서버 주소"
          hint="브라우저 개발 환경에서는 비워 두면 같은 서버를 사용합니다."
        >
          <input
            name="url"
            type="url"
            defaultValue={serverUrl()}
            placeholder="http://localhost:8787"
          />
        </Field>
      </Form>
    </Modal>
  );
}
function Auth({ onLogin }: { onLogin: () => Promise<void> }) {
  const [register, setRegister] = useState(false);
  const [settings, setSettings] = useState(false);
  return (
    <div className="auth-layout">
      <section className="auth-story">
        <a className="brand" href="#">
          <span className="brand-icon">
            <Shield size={21} />
          </span>{" "}
          WODSIEGE<span className="pilot-tag">PILOT</span>
        </a>
        <div className="auth-copy">
          <span className="eyebrow">YOUR BOX. YOUR NEXT CHALLENGE.</span>
          <h1>
            혼자 쌓은 기록,
            <br />
            <em>함께 만드는 승부.</em>
          </h1>
          <p>
            같은 WOD로 도전하고, 기록으로 증명하세요.
            <br />
            우리 Box의 다음 이야기가 시작됩니다.
          </p>
          <div className="arena-art" aria-hidden="true">
            <div className="arena-side">
              <Shield />
              <span>DEFEND</span>
            </div>
            <span className="arena-vs">VS</span>
            <div className="arena-side attack">
              <Swords />
              <span>CHALLENGE</span>
            </div>
            <div className="arena-line" />
          </div>
          <div className="auth-values">
            <span>
              <Swords size={17} /> Box 대 Box
            </span>
            <span>
              <Activity size={17} /> 같은 WOD
            </span>
            <span>
              <Shield size={17} /> 근거 있는 결과
            </span>
          </div>
        </div>
        <p className="fine-print">
          한국어 · Android 파일럿 · 운영 정책 검토 중
        </p>
      </section>
      <section className="auth-panel">
        <div className="auth-form">
          <span className="eyebrow">JOIN THE SIEGE</span>
          <h2>{register ? "다음 도전을 시작해요." : "다시 만나 반가워요."}</h2>
          <p className="muted">
            {register
              ? "운동자 계정을 만들고 우리 Box를 찾아보세요."
              : "로그인하고 우리 Box의 도전을 이어가세요."}
          </p>
          <div className="segmented">
            <button
              className={!register ? "active" : ""}
              onClick={() => setRegister(false)}
            >
              로그인
            </button>
            <button
              className={register ? "active" : ""}
              onClick={() => setRegister(true)}
            >
              회원가입
            </button>
          </div>
          <Form
            key={String(register)}
            label={register ? "계정 만들기" : "로그인"}
            onSubmit={async (data) => {
              const response = await api<{ token: string; user: User }>(
                `/auth/${register ? "register" : "login"}`,
                Object.fromEntries(data),
              );
              setToken(response.token);
              await onLogin();
            }}
          >
            {register && (
              <Field label="이름">
                <input
                  name="name"
                  required
                  minLength={2}
                  maxLength={40}
                  autoComplete="name"
                  placeholder="경기에서 사용할 이름"
                />
              </Field>
            )}
            <Field label="이메일">
              <input
                name="email"
                type="email"
                required
                autoComplete="username"
                placeholder="you@yourbox.kr"
              />
            </Field>
            <Field
              label="비밀번호"
              hint={register ? "10자 이상으로 입력해 주세요." : undefined}
            >
              <input
                name="password"
                type="password"
                required
                minLength={register ? 10 : 1}
                autoComplete={register ? "new-password" : "current-password"}
                placeholder="비밀번호 입력"
              />
            </Field>
            {register && (
              <label className="check-label">
                <input type="checkbox" required />
                개발 파일럿임을 확인했습니다. 테스트 계정을 사용하며 실제 민감
                정보는 입력하지 않습니다.
              </label>
            )}
          </Form>
          <button
            className="text-button connection-link"
            onClick={() => setSettings(true)}
          >
            <Settings2 size={16} /> 서버 연결 설정
          </button>
          <div className="auth-note">
            <Shield size={20} />
            <p>
              운영자 확인과 경기 검증을 분리해
              <br />
              믿을 수 있는 대결을 준비합니다.
            </p>
          </div>
        </div>
      </section>
      {settings && <Connection close={() => setSettings(false)} />}
    </div>
  );
}

const navigation = [
  { id: "home", label: "홈", icon: Compass },
  { id: "matches", label: "대결", icon: Swords },
  { id: "boxes", label: "Box", icon: Building2 },
  { id: "rankings", label: "순위", icon: Trophy },
  { id: "profile", label: "내 활동", icon: UserRound },
];
export default function App() {
  const [state, setState] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(!!token());
  const [page, setPage] = useState(location.hash.slice(1) || "home");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [settings, setSettings] = useState(false);
  const [notifications, setNotifications] = useState(false);
  const actionLock = useRef(false);
  const refresh = useCallback(async () => {
    const requestedToken = token();
    try {
      if (!requestedToken) {
        setState(null);
        return;
      }
      const value = await api<Snapshot>("/state");
      if (requestedToken !== token()) return;
      value.boxes = value.boxes.map((box) => ({
        ...box,
        active: box.active && box.operatorVerified,
      }));
      setState(value);
      setError("");
    } catch (e) {
      if (!token()) setState(null);
      setError((e as Error).message);
      throw e;
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    if (token()) void refresh().catch(() => undefined);
    const handler = () => setPage(location.hash.slice(1) || "home");
    window.addEventListener("hashchange", handler);
    return () => window.removeEventListener("hashchange", handler);
  }, [refresh]);
  useEffect(() => {
    if (!state) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible")
        void refresh().catch(() => undefined);
    }, 30000);
    return () => clearInterval(timer);
  }, [!!state, refresh]);
  useEffect(() => {
    if (!notice) return;
    const timeout = setTimeout(() => setNotice(""), 5000);
    return () => clearTimeout(timeout);
  }, [notice]);
  const go = (value: string) => {
    location.hash = value;
    setPage(value);
    setError("");
    window.scrollTo({ top: 0 });
  };
  async function mutate(path: string, body: unknown = {}) {
    await api(path, body);
    await refresh();
  }
  async function run(
    path: string,
    body: unknown = {},
    message = "변경 사항을 저장했습니다.",
  ) {
    if (actionLock.current) return;
    actionLock.current = true;
    try {
      await mutate(path, body);
      setNotice(message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      actionLock.current = false;
    }
  }
  if (loading)
    return (
      <div className="app-loading">
        <Shield size={40} />
        <h1>WODSIEGE</h1>
        <Busy />
      </div>
    );
  if (!state)
    return (
      <>
        <Auth onLogin={refresh} />
        {error && token() && (
          <div role="alert" className="connection-error">
            <p>{error}</p>
            <button onClick={() => void refresh().catch(() => undefined)}>
              연결 다시 시도
            </button>
            <button
              onClick={() => {
                setToken();
                setError("");
              }}
            >
              로그인으로 돌아가기
            </button>
          </div>
        )}
      </>
    );
  const section = page.split("/")[0];
  const myBox = state.boxes.find((b) => b.id === state.user.boxId);
  return (
    <Context.Provider
      value={{ state, refresh, mutate, run, go, toast: setNotice }}
    >
      <div className="app-shell">
        <aside className="sidebar">
          <a className="brand" href="#home">
            <span className="brand-icon">
              <Shield size={21} />
            </span>
            WODSIEGE
          </a>
          <span className="pilot-label">BOX BATTLE CLUB · PILOT</span>
          <nav aria-label="주 메뉴">
            {navigation.map((item) => (
              <button
                key={item.id}
                aria-label={item.label}
                onClick={() => go(item.id)}
                className={section === item.id ? "active" : ""}
                aria-current={section === item.id ? "page" : undefined}
              >
                <item.icon size={21} />
                <span>{item.label}</span>
                {section === item.id && (
                  <ChevronRight className="nav-chevron" size={16} />
                )}
              </button>
            ))}
            {state.user.role === "operator" && (
              <button
                aria-label="운영 관리"
                className={section === "operations" ? "active" : ""}
                onClick={() => go("operations")}
              >
                <Shield size={21} />
                <span>운영 관리</span>
              </button>
            )}
          </nav>
          <div className="sidebar-bottom">
            <div className="mini-profile">
              <BoxMark box={myBox} small />
              <div>
                <strong>{state.user.name}</strong>
                <span>{myBox?.name || "소속 Box를 찾아보세요"}</span>
              </div>
            </div>
            <button className="text-button" onClick={() => setSettings(true)}>
              <Settings2 size={16} /> 연결 설정
            </button>
            <button
              className="text-button"
              onClick={async () => {
                try {
                  await api("/auth/logout", {});
                } catch {
                  /* local logout remains available offline */
                }
                setToken();
                setState(null);
                go("home");
              }}
            >
              <LogOut size={16} /> 로그아웃
            </button>
          </div>
        </aside>
        <div className="workspace">
          <header className="topbar">
            <a className="mobile-brand" href="#home">
              <Shield size={20} /> WODSIEGE
            </a>
            <span className="topbar-location">
              {myBox
                ? `${myBox.district} / ${myBox.dong}`
                : "우리 Box의 다음 도전"}
              <span className="pilot-tag">PILOT</span>
            </span>
            <div className="topbar-actions">
              <button
                className="icon-button"
                aria-label="새로고침"
                onClick={() => void refresh().catch(() => undefined)}
              >
                <RefreshCw size={18} />
              </button>
              <button
                className="icon-button notification-button"
                aria-label="알림"
                onClick={() => setNotifications(true)}
              >
                <Bell size={20} />
                {state.notifications.length > 0 && <i />}
              </button>
              <button
                className="avatar"
                aria-label="내 활동 보기"
                onClick={() => go("profile")}
              >
                {state.user.name.slice(0, 1)}
              </button>
            </div>
          </header>
          <main id="main-content">
            {error && (
              <div className="error global-error" role="alert">
                <span>{error}</span>
                <button
                  className="icon-button"
                  aria-label="오류 닫기"
                  onClick={() => setError("")}
                >
                  <X size={18} />
                </button>
              </div>
            )}
            {section === "home" ? (
              <Home />
            ) : section === "matches" ? (
              <Matches selectedId={page.split("/")[1]} />
            ) : section === "boxes" ? (
              <Boxes />
            ) : section === "rankings" ? (
              <Rankings />
            ) : section === "operations" && state.user.role === "operator" ? (
              <Operations />
            ) : (
              <Profile
                settings={() => setSettings(true)}
                logout={async () => {
                  try {
                    await api("/auth/logout", {});
                  } catch {}
                  setToken();
                  setState(null);
                  go("home");
                }}
              />
            )}
          </main>
          <footer className="page-footer">
            <span>WODSIEGE · 기록으로 증명하는 우리 Box</span>
            <span>개발용 정책 pilot-v1 · {date(state.updatedAt)} 갱신</span>
          </footer>
        </div>
        <nav className="bottom-nav" aria-label="모바일 메뉴">
          {navigation.map((item) => (
            <button
              key={item.id}
              onClick={() => go(item.id)}
              className={section === item.id ? "active" : ""}
              aria-current={section === item.id ? "page" : undefined}
            >
              <item.icon size={21} />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
      </div>
      {notice && (
        <div className="toast" role="status">
          {notice}
        </div>
      )}
      {settings && <Connection close={() => setSettings(false)} />}
      {notifications && (
        <Modal title="우리 Box의 알림" close={() => setNotifications(false)}>
          <div className="notification-list">
            {state.notifications.length ? (
              state.notifications.map((n) => (
                <button
                  key={n.id}
                  onClick={() => {
                    if (n.matchId) go(`matches/${n.matchId}`);
                    setNotifications(false);
                  }}
                >
                  <strong>{n.title}</strong>
                  <p>{n.body}</p>
                </button>
              ))
            ) : (
              <p className="muted">
                새로운 알림이 없습니다. 경기 일정과 검토할 기록이 생기면
                이곳에서 확인하세요.
              </p>
            )}
          </div>
        </Modal>
      )}
    </Context.Provider>
  );
}
